// vite/flixhq-plugin.js
// Server-side Vite plugin that wraps the flixhq-api Node library
// (https://www.npmjs.com/package/flixhq-api) and exposes a single
// /api/flixhq/source endpoint that the React app can call to get
// a real m3u8 URL for a given title + (optional) season/episode.
//
// The plugin is dev-only (configureServer) so production builds are
// unaffected. flixhq-api uses CommonJS, so we use createRequire here.

// Lazy-loaded FlixHQ class — deferred until the plugin is actually used
// (not at import time) so that production builds never touch this CJS dep.
let FlixHQClass = null;
const loadFlixHQClass = () => {
  if (!FlixHQClass) {
    const { createRequire } = require("module");
    const req = createRequire(import.meta.url);
    FlixHQClass = req("flixhq-api");
  }
  return FlixHQClass;
};

// Cache the FlixHQ instance for the lifetime of the dev server.
let flixhqInstance = null;
const getFlixHQ = () => {
  if (!flixhqInstance) {
    const FlixHQ = loadFlixHQClass();
    flixhqInstance = new FlixHQ();
  }
  return flixhqInstance;
};

// Pick the most likely result from a search. Search returns mixed
// movie/series results; we filter by the requested media type.
const pickSearchResult = (results, type) => {
  if (!Array.isArray(results) || results.length === 0) return null;

  const normalized = type === "series" || type === "tv"
    ? results.filter((r) => /tv|series|show/i.test(`${r.type || ""} ${r.id || ""}`))
    : results.filter((r) => /movie|film/i.test(`${r.type || ""}`) || !/tv|series/i.test(`${r.id || ""}`));

  return normalized[0] || results[0];
};

// Walk the FlixHQ flow for a TV episode: search → details → seasons → episodes
const resolveEpisodeId = async (title, season, episode) => {
  const flixhq = getFlixHQ();
  const searchResults = await flixhq.search(title);
  const show = pickSearchResult(searchResults, "series");
  if (!show?.id) throw new Error(`FlixHQ: show not found for "${title}"`);

  const seasons = await flixhq.getSeasons(show.id);
  if (!Array.isArray(seasons) || seasons.length === 0) {
    throw new Error(`FlixHQ: no seasons found for "${title}"`);
  }

  const targetSeason = seasons.find((s) =>
    String(s.season ?? s.number ?? s.seasonNumber) === String(season)
  ) || seasons.find((s) => Number(s.season ?? s.number ?? s.seasonNumber) === Number(season));

  if (!targetSeason?.id) throw new Error(`FlixHQ: season ${season} not found`);

  const episodes = await flixhq.getEpisodes(targetSeason.id);
  const targetEpisode = episodes.find((e) =>
    String(e.episode ?? e.number ?? e.episodeNumber) === String(episode)
  ) || episodes.find((e) => Number(e.episode ?? e.number ?? e.episodeNumber) === Number(episode));

  if (!targetEpisode?.id) throw new Error(`FlixHQ: episode ${episode} not found`);
  return targetEpisode.id;
};

const resolveMovieId = async (title) => {
  const flixhq = getFlixHQ();
  const searchResults = await flixhq.search(title);
  const movie = pickSearchResult(searchResults, "movie");
  if (!movie?.id) throw new Error(`FlixHQ: movie not found for "${title}"`);
  return movie.id;
};

// Try every available server until one returns a playable source.
const resolveSource = async (contentId, type) => {
  const flixhq = getFlixHQ();
  const serverType = type === "series" || type === "tv" ? "tv" : "movie";
  const servers = await flixhq.getServers(contentId, serverType);
  if (!Array.isArray(servers) || servers.length === 0) {
    throw new Error("FlixHQ: no servers returned for this title");
  }

  let lastError = null;
  for (const server of servers) {
    if (!server?.id) continue;
    try {
      const result = await flixhq.fetchSource(server.id);
      if (result?.source) {
        return {
          url: result.source,
          type: result.type || "hls",
          serverName: server.name || server.id,
          encrypted: Boolean(result.encrypted)
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("FlixHQ: no server produced a playable source");
};

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
};

export default function flixhqApiPlugin() {
  return {
    name: "flixhq-api-plugin",
    configureServer(server) {
      server.middlewares.use("/api/flixhq/source", async (req, res) => {
        try {
          const url = new URL(req.url, "http://localhost");
          const title = url.searchParams.get("title")?.trim();
          const type = url.searchParams.get("type") || "movie";
          const season = url.searchParams.get("season");
          const episode = url.searchParams.get("episode");

          if (!title) {
            sendJson(res, 400, { error: "Missing required parameter: title" });
            return;
          }

          const contentId = (type === "series" || type === "tv")
            ? await resolveEpisodeId(title, season, episode)
            : await resolveMovieId(title);

          const source = await resolveSource(contentId, type);
          sendJson(res, 200, { ...source, title, type });
        } catch (error) {
          console.warn("[flixhq-plugin]", error?.message || error);
          sendJson(res, 502, { error: error?.message || "FlixHQ lookup failed" });
        }
      });

      // Tiny health check for the plugin endpoint
      server.middlewares.use("/api/flixhq/health", (_req, res) => {
        sendJson(res, 200, { ok: true, plugin: "flixhq-api" });
      });
    }
  };
}
