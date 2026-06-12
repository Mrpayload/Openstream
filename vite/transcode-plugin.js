// vite/transcode-plugin.js
// Vite dev plugin that exposes the Openstream transcoder under
// /api/transcode/* in the dev server. The plugin is a thin wrapper
// over `server/transcode-core.js` — the same core is used by the
// standalone production server in `server/transcode.js`.
//
// Endpoints (dev only):
//   GET /api/transcode/health
//   GET /api/transcode/stream?url=<encoded>&hls=1
//   GET /api/transcode/manifest/<jobId>
//   GET /api/transcode/segment/<jobId>/<filename>
//   POST /api/transcode/stop/<jobId>      (optional)
//
// The frontend simply requests /api/transcode/stream?url=… and the
// response body is the rewritten HLS manifest text; segment URLs in
// that manifest point at /api/transcode/segment/<jobId>/<filename>.

import {
  checkFfmpeg,
  getConfig,
  listJobs,
  readJobManifest,
  resolveSegmentPath,
  startTranscodeJob,
  stopJob,
  touchJob,
} from "../server/transcode-core.js";

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

const sendNotFound = (res) => sendText(res, 404, "Not Found");

/**
 * Extract the request headers we want to forward to ffmpeg.
 * We only forward a small allowlist to avoid leaking auth cookies
 * or other sensitive headers that ffmpeg does not need.
 */
function extractForwardedHeaders(req) {
  const allow = new Set([
    "user-agent",
    "referer",
    "origin",
    "authorization",
    "cookie",
  ]);
  /** @type {Record<string,string>} */
  const out = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (allow.has(k.toLowerCase()) && typeof v === "string") {
      out[k.split("-").map((s) => s[0].toUpperCase() + s.slice(1).toLowerCase()).join("-")] = v;
    }
  }
  return out;
}

export default function transcodePlugin() {
  return {
    name: "openstream-transcode-plugin",
    configureServer(server) {
      // ── /api/transcode/health ─────────────────────────────────────────
      server.middlewares.use("/api/transcode/health", async (_req, res) => {
        try {
          const ffmpeg = await checkFfmpeg();
          sendJson(res, 200, {
            ok: ffmpeg.available,
            ffmpeg: ffmpeg.version,
            activeJobs: listJobs().length,
            config: getConfig(),
          });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err?.message || String(err) });
        }
      });

      // ── /api/transcode/stream ─────────────────────────────────────────
      server.middlewares.use("/api/transcode/stream", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const encoded = url.searchParams.get("url");
          if (!encoded) {
            sendJson(res, 400, { error: "Missing ?url=" });
            return;
          }
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
        } catch (err) {
          console.warn("[transcode-plugin] stream error:", err?.message || err);
          sendJson(res, 502, { error: err?.message || "Transcode failed" });
        }
      });

      // ── /api/transcode/manifest/<jobId> ──────────────────────────────
      // The StreamPicker NeoPlayer flow never actually hits this; it
      // gets the manifest body directly from /stream. This endpoint is
      // here for debugging and for tools that want to poll.
      server.middlewares.use("/api/transcode/manifest/", async (req, res) => {
        try {
          const jobId = decodeURIComponent(req.url.split("?")[0].replace(/^\/+/, ""));
          if (!jobId) { sendNotFound(res); return; }
          const job = touchJob(jobId);
          if (!job) { sendJson(res, 404, { error: "Job not found or expired" }); return; }
          const segmentBase = `/api/transcode/segment/${job.id}`;
          const manifest = await readJobManifest(job, segmentBase);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(manifest);
        } catch (err) {
          console.warn("[transcode-plugin] manifest error:", err?.message || err);
          sendJson(res, 502, { error: err?.message || "Manifest read failed" });
        }
      });

      // ── /api/transcode/segment/<jobId>/<filename> ─────────────────────
      server.middlewares.use("/api/transcode/segment/", async (req, res) => {
        try {
          const parts = req.url.split("?")[0].split("/").filter(Boolean);
          // parts: ["api", "transcode", "segment", "<jobId>", "<filename>..."]
          if (parts.length < 4) { sendNotFound(res); return; }
          const jobId = decodeURIComponent(parts[2]);
          const filename = parts.slice(3).join("/");
          const job = touchJob(jobId);
          if (!job) { sendJson(res, 404, { error: "Job not found or expired" }); return; }
          const absPath = resolveSegmentPath(job, filename);
          if (!absPath) { sendJson(res, 400, { error: "Invalid segment filename" }); return; }

          const { stat, createReadStream } = await import("node:fs");
          let s;
          try { s = await stat(absPath); }
          catch { sendJson(res, 404, { error: "Segment not found" }); return; }

          res.statusCode = 200;
          res.setHeader("Content-Type", "video/mp2t");
          res.setHeader("Content-Length", String(s.size));
          res.setHeader("Cache-Control", "public, max-age=60");
          res.setHeader("Access-Control-Allow-Origin", "*");
          createReadStream(absPath).pipe(res);
        } catch (err) {
          console.warn("[transcode-plugin] segment error:", err?.message || err);
          sendJson(res, 502, { error: err?.message || "Segment read failed" });
        }
      });

      // ── /api/transcode/stop/<jobId> ───────────────────────────────────
      server.middlewares.use("/api/transcode/stop/", (req, res) => {
        const jobId = decodeURIComponent(req.url.split("?")[0].split("/").filter(Boolean).pop() || "");
        const ok = jobId ? stopJob(jobId) : false;
        sendJson(res, ok ? 200 : 404, { ok });
      });
    },
  };
}
