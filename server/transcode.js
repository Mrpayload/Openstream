// server/transcode.js
// Standalone Node.js production server that exposes the same
// /api/transcode/* endpoints as the Vite dev plugin. Run with:
//
//   node server/transcode.js
//   PORT=8787 FFMPEG_PATH=/usr/bin/ffmpeg node server/transcode.js
//
// Or via the npm script:
//   npm run transcode
//
// Environment variables:
//   PORT                         (default 8787)
//   HOST                         (default 0.0.0.0)
//   FFMPEG_PATH                  (default "ffmpeg")
//   TRANSCODER_MAX_CONCURRENT    (default 2)
//   TRANSCODER_TIMEOUT_MS        (default 4h)
//   TRANSCODER_STARTUP_TIMEOUT_MS(default 30s)
//   TRANSCODER_IDLE_TTL_MS       (default 60s)
//   TRANSCODER_TMP_DIR           (default ./.transcode-tmp)
//   TRANSCODER_HLS_SEGMENT_TIME  (default 4)
//   TRANSCODER_AUDIO_BITRATE     (default 192k)
//
// The frontend can be pointed at this server by setting
// `VITE_TRANSCODE_BASE` to e.g. "http://localhost:8787" so the
// /api/transcode/* URLs are absolute in production.

import http from "node:http";
import { stat, createReadStream } from "node:fs";
import {
  checkFfmpeg,
  getConfig,
  listJobs,
  readJobManifest,
  resolveSegmentPath,
  startTranscodeJob,
  stopJob,
  stopAllJobs,
  touchJob,
} from "./transcode-core.js";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

// ── tiny response helpers ────────────────────────────────────────────────

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const sendText = (res, status, text, contentType = "text/plain; charset=utf-8") => {
  res.statusCode = status;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
};

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers", "X-Transcode-Job, X-Transcode-State, Content-Length, Content-Type");
};

const extractForwardedHeaders = (req) => {
  const allow = new Set(["user-agent", "referer", "origin", "authorization", "cookie"]);
  const out = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (allow.has(k.toLowerCase()) && typeof v === "string") {
      const norm = k.split("-").map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase()).join("-");
      out[norm] = v;
    }
  }
  return out;
};

// ── request handler ──────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    cors(res);
    res.statusCode = 204;
    res.end();
    return;
  }
  cors(res);

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  try {
    // ── /api/transcode/health ────────────────────────────────────────
    if (pathname === "/api/transcode/health" && req.method === "GET") {
      const ffmpeg = await checkFfmpeg();
      sendJson(res, 200, {
        ok: ffmpeg.available,
        ffmpeg: ffmpeg.version,
        activeJobs: listJobs().length,
        config: getConfig(),
      });
      return;
    }

    // ── /api/transcode/stream?url=... ────────────────────────────────
    if (pathname === "/api/transcode/stream" && req.method === "GET") {
      const encoded = url.searchParams.get("url");
      if (!encoded) { sendJson(res, 400, { error: "Missing ?url=" }); return; }
      let inputUrl;
      try { inputUrl = decodeURIComponent(encoded); }
      catch { sendJson(res, 400, { error: "Invalid url encoding" }); return; }
      if (!/^https?:\/\//i.test(inputUrl)) {
        sendJson(res, 400, { error: "Only http(s) URLs are supported" });
        return;
      }
      const explicitHls = url.searchParams.get("hls");
      const inputIsHls = explicitHls === null
        ? /\.m3u8(\?|$)/i.test(inputUrl)
        : explicitHls === "1" || explicitHls === "true";

      const job = await startTranscodeJob({
        inputUrl,
        inputHeaders: extractForwardedHeaders(req),
        inputIsHls,
      });

      const segmentBase = `/api/transcode/segment/${job.id}`;
      const manifest = await readJobManifest(job, segmentBase);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Transcode-Job", job.id);
      res.setHeader("X-Transcode-State", job.state);
      res.end(manifest);
      return;
    }

    // ── /api/transcode/manifest/<jobId> ──────────────────────────────
    if (pathname.startsWith("/api/transcode/manifest/") && req.method === "GET") {
      const jobId = decodeURIComponent(pathname.replace("/api/transcode/manifest/", ""));
      const job = touchJob(jobId);
      if (!job) { sendJson(res, 404, { error: "Job not found or expired" }); return; }
      const manifest = await readJobManifest(job, `/api/transcode/segment/${job.id}`);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(manifest);
      return;
    }

    // ── /api/transcode/segment/<jobId>/<filename> ────────────────────
    if (pathname.startsWith("/api/transcode/segment/") && req.method === "GET") {
      const rest = pathname.replace("/api/transcode/segment/", "");
      const slash = rest.indexOf("/");
      if (slash < 0) { sendText(res, 404, "Not Found"); return; }
      const jobId = decodeURIComponent(rest.slice(0, slash));
      const filename = rest.slice(slash + 1);
      const job = touchJob(jobId);
      if (!job) { sendJson(res, 404, { error: "Job not found or expired" }); return; }
      const absPath = resolveSegmentPath(job, filename);
      if (!absPath) { sendJson(res, 400, { error: "Invalid segment filename" }); return; }
      let s;
      try { s = await stat(absPath); }
      catch { sendJson(res, 404, { error: "Segment not found" }); return; }
      res.statusCode = 200;
      res.setHeader("Content-Type", "video/mp2t");
      res.setHeader("Content-Length", String(s.size));
      res.setHeader("Cache-Control", "public, max-age=60");
      createReadStream(absPath).pipe(res);
      return;
    }

    // ── /api/transcode/stop/<jobId> ──────────────────────────────────
    if (pathname.startsWith("/api/transcode/stop/") && (req.method === "GET" || req.method === "POST")) {
      const jobId = decodeURIComponent(pathname.replace("/api/transcode/stop/", ""));
      const ok = jobId ? stopJob(jobId) : false;
      sendJson(res, ok ? 200 : 404, { ok });
      return;
    }

    // ── / (root info) ────────────────────────────────────────────────
    if (pathname === "/" || pathname === "/api" || pathname === "/api/transcode") {
      const ffmpeg = await checkFfmpeg();
      sendJson(res, 200, {
        service: "openstream-transcoder",
        ffmpeg: ffmpeg.available ? ffmpeg.version : "unavailable",
        endpoints: [
          "GET  /api/transcode/health",
          "GET  /api/transcode/stream?url=<encoded>&hls=1",
          "GET  /api/transcode/manifest/<jobId>",
          "GET  /api/transcode/segment/<jobId>/<filename>",
          "POST /api/transcode/stop/<jobId>",
        ],
      });
      return;
    }

    sendText(res, 404, "Not Found");
  } catch (err) {
    console.warn(`[transcode] ${req.method} ${pathname}: ${err?.message || err}`);
    sendJson(res, 500, { error: err?.message || "Internal error" });
  }
});

// ── startup / shutdown ──────────────────────────────────────────────────

const ffmpegInfo = await checkFfmpeg();
console.log(`[transcode] ffmpeg: ${ffmpegInfo.available ? ffmpegInfo.version : "UNAVAILABLE"}`);
console.log(`[transcode] config: ${JSON.stringify(getConfig())}`);

server.listen(PORT, HOST, () => {
  console.log(`[transcode] listening on http://${HOST}:${PORT}`);
});

const shutdown = (signal) => {
  console.log(`[transcode] received ${signal}, stopping…`);
  stopAllJobs();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
