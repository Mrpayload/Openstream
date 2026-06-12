import { createRequire } from "module";
import { getRequestUrl, sendJson } from "../_lib/http.js";

export const config = { maxDuration: 30 };

const require = createRequire(import.meta.url);
const FlixHQ = require("flixhq-api");

let flixhqInstance = null;
const getFlixHQ = () => {
  if (!flixhqInstance) {
    flixhqInstance = new FlixHQ();
  }
  return flixhqInstance;
};

const pickSearchResult = (results, type) => {
  if (!Array.isArray(results) || results.length === 0) return null;

  const normalized = type === "series" || type === "tv"
    ? results.filter((r) => /tv|series|show/i.test(`${r.type || ""} ${r.id || ""}`))
    : results.filter((r) => /movie|film/i.test(`${r.type || ""}`) || !/tv|series/i.test(`${r.id || ""}`));

  return normalized[0] || results[0];
};

const resolveEpisodeId = async (title, season, episode) => {
  const flixhq = getFlixHQ();
  const searchResults = await flixhq.search(title);
  const show = pickSearchResult(searchResults, "series");
  if (!show?.id) throw new Error(`FlixHQ: show not found for "${title}"`);

  const seasons = await flixhq.getSeasons(show.id);
  if (!Array.isArray(seasons) || seasons.length === 0) {
    throw new Error(`FlixHQ: no seasons found for "${title}"`);
  }

  const targetSeason = seasons.find((s) => String(s.season ?? s.number ?? s.seasonNumber) === String(season))
    || seasons.find((s) => Number(s.season ?? s.number ?? s.seasonNumber) === Number(season));

  if (!targetSeason?.id) throw new Error(`FlixHQ: season ${season} not found`);

  const episodes = await flixhq.getEpisodes(targetSeason.id);
  const targetEpisode = episodes.find((e) => String(e.episode ?? e.number ?? e.episodeNumber) === String(episode))
    || episodes.find((e) => Number(e.episode ?? e.number ?? e.episodeNumber) === Number(episode));

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
          encrypted: Boolean(result.encrypted),
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("FlixHQ: no server produced a playable source");
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const url = getRequestUrl(req);
    const title = url.searchParams.get("title")?.trim();
    const type = url.searchParams.get("type") || "movie";
    const season = url.searchParams.get("season");
    const episode = url.searchParams.get("episode");

    if (!title) {
      sendJson(res, 400, { error: "Missing required parameter: title" });
      return;
    }

    const contentId = type === "series" || type === "tv"
      ? await resolveEpisodeId(title, season, episode)
      : await resolveMovieId(title);

    const source = await resolveSource(contentId, type);
    sendJson(res, 200, { ...source, title, type });
  } catch (error) {
    console.warn("[flixhq-api]", error?.message || error);
    sendJson(res, 502, { error: error?.message || "FlixHQ lookup failed" });
  }
}
