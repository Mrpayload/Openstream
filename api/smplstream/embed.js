import { getRequestUrl, sendJson } from "../_lib/http.js";

export const config = { maxDuration: 30 };

const SMPLSTREAM_BASE = "https://embed.smashystream.com";
const SMPLSTREAM_TIMEOUT_MS = 15_000;

const SMASHY_B64_PARTS = [
  "U0ZML2RVN0IvRGx4",
  "MGNhL0JWb0kvTlM5",
  "Ym94LzJTSS9aU0Zj",
  "SGJ0L1dGakIvN0dX",
  "eE52L1QwOC96N0Yz",
];

const decodeSmashyStream = (encoded) => {
  if (!encoded || typeof encoded !== "string") return null;
  try {
    let formattedB64 = encoded.slice(2);
    for (let i = SMASHY_B64_PARTS.length - 1; i >= 0; i--) {
      formattedB64 = formattedB64.replace(`//${SMASHY_B64_PARTS[i]}`, "");
    }
    return Buffer.from(formattedB64, "base64").toString("utf8");
  } catch {
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed", servers: [] });
    return;
  }

  try {
    const url = getRequestUrl(req);
    const tmdbId = url.searchParams.get("tmdbId");
    const type = url.searchParams.get("type") || "movie";
    const season = url.searchParams.get("season");
    const episode = url.searchParams.get("episode");

    if (!tmdbId) {
      sendJson(res, 400, { error: "Missing required parameter: tmdbId", servers: [] });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SMPLSTREAM_TIMEOUT_MS);

    try {
      const initResponse = await fetch(`${SMPLSTREAM_BASE}/getplayer.php`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: SMPLSTREAM_BASE,
          Referer: `${SMPLSTREAM_BASE}/`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
        body: "g-recaptcha-response=",
      });

      if (!initResponse.ok) {
        console.warn(`[smplstream] init ${initResponse.status}`);
        sendJson(res, 502, { error: `SmashyStream init failed: ${initResponse.status}`, servers: [] });
        return;
      }

      const cookies = initResponse.headers.getSetCookie?.() || [];
      const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

      const playerParams = new URLSearchParams({
        player: "f",
        tmdb: String(tmdbId),
      });
      if ((type === "tv" || type === "series") && season && episode) {
        playerParams.set("season", String(season));
        playerParams.set("episode", String(episode));
      }

      const playerResponse = await fetch(`${SMPLSTREAM_BASE}/getplayer.php?${playerParams.toString()}`, {
        signal: controller.signal,
        headers: {
          Cookie: cookieHeader,
          Referer: `${SMPLSTREAM_BASE}/`,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      });

      if (!playerResponse.ok) {
        console.warn(`[smplstream] player ${playerResponse.status}`);
        sendJson(res, 502, { error: `SmashyStream player failed: ${playerResponse.status}`, servers: [] });
        return;
      }

      const playerData = await playerResponse.json();
      const servers = [];
      if (Array.isArray(playerData.sourceUrls)) {
        for (const encoded of playerData.sourceUrls) {
          const decoded = decodeSmashyStream(encoded);
          if (decoded) {
            servers.push({
              src: decoded,
              name: "SmashyStream",
              type: decoded.includes(".m3u8") ? "hls" : "mp4",
            });
          }
        }
      }

      sendJson(res, 200, { servers });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      sendJson(res, 504, { error: "SmashyStream request timed out", servers: [] });
    } else {
      console.warn("[smplstream] error:", error?.message || error);
      sendJson(res, 502, { error: error?.message || "SmashyStream proxy failed", servers: [] });
    }
  }
}
