import { getRequestUrl, sendJson } from "../_lib/http.js";

export const config = { maxDuration: 30 };

const VIDLINK_BASE = "https://vidlink.pro";
const VIDLINK_TIMEOUT_MS = 12_000;

const buildVidlinkUrl = (tmdbId, type, season, episode) => {
  const id = String(tmdbId || "").replace(/^tmdb:/, "");
  const autoplay = "autoplay=true&nextbutton=true";
  if (type === "tv" || type === "series") {
    return `${VIDLINK_BASE}/tv/${id}/${season}/${episode}?${autoplay}`;
  }
  return `${VIDLINK_BASE}/movie/${id}?${autoplay}`;
};

const extractM3u8Url = (html) => {
  const match = html.match(/<source\s+src="([^"]+\.m3u8[^"]*)"\s+type="application\/x-mpegurl"/i);
  return match?.[1] || null;
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const url = getRequestUrl(req);
    const tmdbId = url.searchParams.get("tmdbId");
    const type = url.searchParams.get("type") || "movie";
    const season = url.searchParams.get("season");
    const episode = url.searchParams.get("episode");

    if (!tmdbId) {
      sendJson(res, 400, { error: "Missing required parameter: tmdbId" });
      return;
    }

    if ((type === "tv" || type === "series") && (!season || !episode)) {
      sendJson(res, 400, { error: "Season and episode required for TV shows" });
      return;
    }

    const embedUrl = buildVidlinkUrl(tmdbId, type, season, episode);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIDLINK_TIMEOUT_MS);

    try {
      const response = await fetch(embedUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        console.warn(`[vidlink-extract] embed ${response.status}`);
        sendJson(res, 502, { error: `VidLink returned ${response.status}`, embedUrl });
        return;
      }

      const html = await response.text();
      const m3u8 = extractM3u8Url(html);

      if (m3u8) {
        sendJson(res, 200, { url: m3u8, isHls: true, name: "VidLink Direct", embedUrl });
      } else {
        sendJson(res, 200, { url: null, isHls: false, name: "VidLink Direct", embedUrl });
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      sendJson(res, 504, { error: "VidLink request timed out" });
    } else {
      console.warn("[vidlink-extract] error:", error?.message || error);
      sendJson(res, 502, { error: error?.message || "VidLink extraction failed" });
    }
  }
}
