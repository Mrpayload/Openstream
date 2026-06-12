import { Buffer } from "node:buffer";
import { hasUnsupportedAudioCodecs, rewriteManifest } from "../../vite/hls-manifest.js";
import { getRequestUrl, sendText } from "../_lib/http.js";

export const config = { maxDuration: 30 };

async function fetchUrl(targetUrl, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${targetUrl}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  try {
    const url = getRequestUrl(req);
    const encodedStreamUrl = url.searchParams.get("url");

    if (!encodedStreamUrl) {
      sendText(res, 400, "Missing ?url= parameter");
      return;
    }

    let streamUrl;
    try {
      streamUrl = decodeURIComponent(encodedStreamUrl);
    } catch {
      sendText(res, 400, "Invalid URL encoding");
      return;
    }

    if (!streamUrl.startsWith("http://") && !streamUrl.startsWith("https://")) {
      sendText(res, 400, "Only http/https URLs are supported");
      return;
    }

    if (!streamUrl.toLowerCase().includes(".m3u8")) {
      sendText(res, 400, "Only HLS (.m3u8) streams are supported by the sidecar");
      return;
    }

    const response = await fetchUrl(streamUrl);
    const manifestText = Buffer.from(await response.arrayBuffer()).toString("utf8");

    if (!hasUnsupportedAudioCodecs(manifestText)) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Sidecar-Original", "true");
      res.end(manifestText);
      return;
    }

    const baseUrl = new URL(streamUrl);
    const proxySegmentUrl = (encodedSegUrl) =>
      `/api/sidecar/segment?url=${encodedSegUrl}&base=${encodeURIComponent(baseUrl.origin + baseUrl.pathname.replace(/\/[^/]*$/, "/"))}`;

    const rewritten = rewriteManifest(manifestText, baseUrl.origin, proxySegmentUrl);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Sidecar-Rewritten", "true");
    res.end(rewritten);
  } catch (error) {
    console.warn("[sidecar] stream error:", error?.message || error);
    sendText(res, 502, `Sidecar error: ${error?.message || "Unknown error"}`);
  }
}
