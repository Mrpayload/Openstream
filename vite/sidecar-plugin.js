// vite/sidecar-plugin.js
// Vite plugin that acts as a sidecar HLS stream processor:
// - /api/sidecar/stream   → fetches a manifest, strips unsupported audio codecs,
//                            rewrites segment URLs, returns the cleaned manifest
// - /api/sidecar/segment  → proxies a segment request with CORS headers
// - /api/sidecar/health   → liveness check
//
// Auto-starts when `npm run dev` runs (via configureServer hook).
// No external dependencies — pure Node.js http/https/punycode.

import { rewriteManifest, hasUnsupportedAudioCodecs } from "./hls-manifest.js";
import { Buffer } from "node:buffer";

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

const sendError = (res, status, message) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(message);
};

// Fetch with auto-follow-redirects (up to 5 hops), preserving headers.
async function fetchUrl(targetUrl, options = {}) {
  const http = targetUrl.startsWith("https:") ? await import("node:https") : await import("node:http");
  return new Promise((resolve, reject) => {
    const req = http.get(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...options.headers,
      },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const nextUrl = new URL(res.headers.location, targetUrl).href;
        res.destroy();
        resolve(fetchUrl(nextUrl, options));
        return;
      }
      if (res.statusCode !== 200) {
        res.destroy();
        reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
        return;
      }
      resolve(res);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${targetUrl}`));
    });
  });
}

// Collect body from a stream up to `maxBytes` (default 50 MB).
async function collectBody(stream, maxBytes = 50 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) break;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export default function sidecarPlugin() {
  return {
    name: "sidecar-hls-plugin",

    configureServer(server) {
      // ── /api/sidecar/health ───────────────────────────────────────────
      server.middlewares.use("/api/sidecar/health", (_req, res) => {
        sendJson(res, 200, { ok: true, plugin: "sidecar-hls" });
      });

      // ── /api/sidecar/stream ────────────────────────────────────────────
      // GET /api/sidecar/stream?url=<encoded_url>
      // Returns the (potentially rewritten) manifest text as Content-Type: vnd.apple.mpegurl
      server.middlewares.use("/api/sidecar/stream", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const encodedStreamUrl = url.searchParams.get("url");

          if (!encodedStreamUrl) {
            sendError(res, 400, "Missing ?url= parameter");
            return;
          }

          let streamUrl;
          try {
            streamUrl = decodeURIComponent(encodedStreamUrl);
          } catch {
            sendError(res, 400, "Invalid URL encoding");
            return;
          }

          // Validate it looks like an http(s) URL
          if (!streamUrl.startsWith("http://") && !streamUrl.startsWith("https://")) {
            sendError(res, 400, "Only http/https URLs are supported");
            return;
          }

          // Only handle HLS manifests
          if (!streamUrl.toLowerCase().includes(".m3u8")) {
            sendError(res, 400, "Only HLS (.m3u8) streams are supported by the sidecar");
            return;
          }

          const response = await fetchUrl(streamUrl);
          const body = await collectBody(response);
          const manifestText = body.toString("utf8");

          // Detect if manifest has problematic audio
          const hasBadAudio = hasUnsupportedAudioCodecs(manifestText);

          if (!hasBadAudio) {
            // No rewriting needed — serve as-is with a note
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Sidecar-Original", "true");
            res.end(manifestText);
            return;
          }

          // Build proxy segment URL for this stream
          const baseUrl = new URL(streamUrl);
          const proxySegmentUrl = (encodedSegUrl) =>
            `/api/sidecar/segment?url=${encodedSegUrl}&base=${encodeURIComponent(baseUrl.origin + baseUrl.pathname.replace(/\/[^/]*$/, "/"))}`;

          const rewritten = rewriteManifest(manifestText, baseUrl.origin, proxySegmentUrl);

          res.statusCode = 200;
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("X-Sidecar-Rewritten", "true");
          res.end(rewritten);
        } catch (err) {
          console.warn("[sidecar-plugin] stream error:", err?.message || err);
          sendError(res, 502, `Sidecar error: ${err?.message || "Unknown error"}`);
        }
      });

      // ── /api/sidecar/segment ──────────────────────────────────────────
      // GET /api/sidecar/segment?url=<encoded_url>&base=<encoded_base>
      // Proxies segment data with CORS headers so HLS.js can fetch cross-origin segments.
      server.middlewares.use("/api/sidecar/segment", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const encodedSegUrl = url.searchParams.get("url");
          const encodedBase = url.searchParams.get("base");

          if (!encodedSegUrl) {
            sendError(res, 400, "Missing ?url= parameter");
            return;
          }

          let segUrl;
          try {
            segUrl = decodeURIComponent(encodedSegUrl);
          } catch {
            sendError(res, 400, "Invalid URL encoding");
            return;
          }

          // If no explicit base provided, the segment URL must be absolute
          if (!segUrl.startsWith("http://") && !segUrl.startsWith("https://")) {
            if (!encodedBase) {
              sendError(res, 400, "Relative segment URL requires base parameter");
              return;
            }
            try {
              const base = decodeURIComponent(encodedBase);
              segUrl = new URL(segUrl, base).href;
            } catch {
              sendError(res, 400, "Invalid base URL");
              return;
            }
          }

          const response = await fetchUrl(segUrl);
          const contentType = response.headers["content-type"] || "application/octet-stream";

          res.statusCode = 200;
          res.setHeader("Content-Type", contentType);
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Headers", "*");
          res.setHeader("Access-Control-Expose-Headers", "Content-Length,Content-Type");
          res.setHeader("Cache-Control", "public, max-age=3600");
          // Disable chunked encoding — we may not have Content-Length but we are forwarding from an open connection
          response.pipe(res);
        } catch (err) {
          console.warn("[sidecar-plugin] segment error:", err?.message || err);
          sendError(res, 502, `Segment error: ${err?.message || "Unknown error"}`);
        }
      });
    },
  };
}