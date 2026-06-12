import { Buffer } from "node:buffer";
import { getRequestUrl, sendText } from "../_lib/http.js";

export const config = { maxDuration: 30 };

async function fetchUrl(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
    const encodedSegUrl = url.searchParams.get("url");
    const encodedBase = url.searchParams.get("base");

    if (!encodedSegUrl) {
      sendText(res, 400, "Missing ?url= parameter");
      return;
    }

    let segUrl;
    try {
      segUrl = decodeURIComponent(encodedSegUrl);
    } catch {
      sendText(res, 400, "Invalid URL encoding");
      return;
    }

    if (!segUrl.startsWith("http://") && !segUrl.startsWith("https://")) {
      if (!encodedBase) {
        sendText(res, 400, "Relative segment URL requires base parameter");
        return;
      }
      try {
        const base = decodeURIComponent(encodedBase);
        segUrl = new URL(segUrl, base).href;
      } catch {
        sendText(res, 400, "Invalid base URL");
        return;
      }
    }

    const response = await fetchUrl(segUrl);
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await response.arrayBuffer());

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length,Content-Type");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(body);
  } catch (error) {
    console.warn("[sidecar] segment error:", error?.message || error);
    sendText(res, 502, `Segment error: ${error?.message || "Unknown error"}`);
  }
}
