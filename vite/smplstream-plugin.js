// vite/smplstream-plugin.js
// Server-side Vite plugin that proxies requests to SmashyStream
// (embed.smashystream.com) and returns decoded stream URLs.
//
// SmashyStream API flow:
//   1. POST to /getplayer.php with empty recaptcha to init session
//   2. GET /getplayer.php?player=f&tmdb={id}&season={s}&episode={e}
//   3. Decode base64 sourceUrls from response
//
// API:
//   GET /api/smplstream/embed?tmdbId={id}&type=movie
//   GET /api/smplstream/embed?tmdbId={id}&type=tv&season={s}&episode={e}
//
// Response: { servers: [{ src, name, type }] }

const SMPLSTREAM_BASE = "https://embed.smashystream.com";
const SMPLSTREAM_TIMEOUT_MS = 15_000;

// SmashyStream obfuscated base64 decoding
// Path segments used in URL construction (reversed order for decoding)
const SMASHY_B64_PARTS = [
  "U0ZML2RVN0IvRGx4",
  "MGNhL0JWb0kvTlM5",
  "Ym94LzJTSS9aU0Zj",
  "SGJ0L1dGakIvN0dX",
  "eE52L1QwOC96N0Yz"
];

const decodeSmashyStream = (encoded) => {
  if (!encoded || typeof encoded !== "string") return null;
  try {
    // Remove the first 2 characters (version/type prefix)
    let formattedB64 = encoded.slice(2);
    // Remove obfuscated path segments in reverse order
    for (let i = SMASHY_B64_PARTS.length - 1; i >= 0; i--) {
      formattedB64 = formattedB64.replace(`//${SMASHY_B64_PARTS[i]}`, "");
    }
    return atob(formattedB64);
  } catch {
    return null;
  }
};

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

export default function smplStreamPlugin() {
  return {
    name: "smplstream-plugin",
    configureServer(server) {
      server.middlewares.use("/api/smplstream/embed", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const tmdbId = url.searchParams.get("tmdbId");
          const imdbId = url.searchParams.get("imdbId");
          const type = url.searchParams.get("type") || "movie";
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");

          if (!tmdbId && !imdbId) {
            sendJson(res, 400, { error: "Missing required parameter: tmdbId or imdbId", servers: [] });
            return;
          }

          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), SMPLSTREAM_TIMEOUT_MS);

          try {
            // Step 1: Initialize session with empty recaptcha
            const initResponse = await fetch(`${SMPLSTREAM_BASE}/getplayer.php`, {
              method: "POST",
              signal: controller.signal,
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": SMPLSTREAM_BASE,
                "Referer": `${SMPLSTREAM_BASE}/`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
              },
              body: "g-recaptcha-response="
            });

            if (!initResponse.ok) {
              console.warn(`[smplstream] init ${initResponse.status}`);
              sendJson(res, 200, { servers: [] });
              return;
            }

            // Extract cookies from init response for session
            const cookies = initResponse.headers.getSetCookie?.() || [];
            const cookieHeader = cookies
              .map((c) => c.split(";")[0])
              .join("; ");

            // Step 2: Fetch player data
            const playerParams = new URLSearchParams({
              player: "f",
            });
            if (imdbId) {
              playerParams.set("imdb", String(imdbId));
            } else {
              playerParams.set("tmdb", String(tmdbId));
            }
            if ((type === "tv" || type === "series") && season && episode) {
              playerParams.set("season", String(season));
              playerParams.set("episode", String(episode));
            }

            const playerResponse = await fetch(`${SMPLSTREAM_BASE}/getplayer.php?${playerParams.toString()}`, {
              signal: controller.signal,
              headers: {
                "Cookie": cookieHeader,
                "Referer": `${SMPLSTREAM_BASE}/`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
              }
            });

            if (!playerResponse.ok) {
              console.warn(`[smplstream] player ${playerResponse.status}`);
              sendJson(res, 200, { servers: [] });
              return;
            }

            const playerContentType = playerResponse.headers.get("content-type") || "";
            if (!playerContentType.includes("json")) {
              console.warn(`[smplstream] Upstream returned ${playerContentType.split(";")[0]} — API may have changed`);
              sendJson(res, 200, { servers: [] });
              return;
            }

            const playerData = await playerResponse.json();

            // Step 3: Decode source URLs
            const servers = [];
            if (Array.isArray(playerData.sourceUrls)) {
              for (const encoded of playerData.sourceUrls) {
                const decoded = decodeSmashyStream(encoded);
                if (decoded) {
                  servers.push({
                    src: decoded,
                    name: "SmashyStream",
                    type: decoded.includes(".m3u8") ? "hls" : "mp4"
                  });
                }
              }
            }

            sendJson(res, 200, { servers });
          } finally {
            clearTimeout(timer);
          }
        } catch (error) {
          if (error?.name !== "AbortError") {
            console.warn("[smplstream] error:", error?.message || error);
          }
          sendJson(res, 200, { servers: [] });
        }
      });
    }
  };
}
