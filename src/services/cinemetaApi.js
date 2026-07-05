import { getAbsoluteApiUrl } from "../utils/apiConfig";

const getCinemetaUrl = (path) => {
  return getAbsoluteApiUrl(`/api/cinemeta?path=${encodeURIComponent(path)}`);
};

const normalizeGenres = (genres) => {
  if (Array.isArray(genres)) return genres.slice(0, 3);
  if (typeof genres === "string") return [genres];
  return ["Drama"];
};

const pickVibe = (genres) => {
  if (!Array.isArray(genres)) return "Chill";
  if (genres.some((genre) => ["Horror", "Thriller", "Mystery"].includes(genre))) return "Spooky";
  if (genres.some((genre) => ["Action", "Adventure", "Animation"].includes(genre))) return "Hype";
  if (genres.some((genre) => ["Science Fiction", "Sci-Fi", "Fantasy"].includes(genre))) return "Brainy";
  if (genres.some((genre) => ["Romance", "Music"].includes(genre))) return "Romantic";
  return "Chill";
};

export const normalizeCinemetaSearchResult = (result, type) => {
  const normalizedType = type === "series" || type === "tv" ? "series" : "movie";
  const genres = normalizeGenres(result.genres || result.genre);

  return {
    id: `cinemeta-${normalizedType}-${result.id}`,
    title: result.name || "Untitled",
    type: normalizedType,
    streamType: normalizedType,
    imdbId: result.id || result.imdb_id,
    tmdbId: result.moviedb_id || null,
    rating: result.imdbRating ? Number(Number(result.imdbRating).toFixed(1)) : 0,
    year: result.releaseInfo || result.year || "----",
    genres,
    vibe: pickVibe(genres),
    description: result.description || result.overview || "No description available yet.",
    creator: Array.isArray(result.director) ? result.director.join(", ") : result.director || "Cinemeta",
    cast: result.cast || [],
    posterUrl: result.poster || null,
    backdropUrl: result.background || null,
    isSearchResult: true,
    seasons: normalizedType === "series" ? [] : undefined,
    needsSeasonHydration: normalizedType === "series"
  };
};

export const convertCinemetaVideosToSeasons = (videos) => {
  if (!Array.isArray(videos)) return [];
  const seasonsMap = new Map();

  for (const video of videos) {
    // Stremio videos list usually has season and number/episode
    const sNum = typeof video.season === "number" ? video.season : null;
    if (sNum === null || sNum === 0) continue; // Skip specials (season 0) or nulls

    if (!seasonsMap.has(sNum)) {
      seasonsMap.set(sNum, {
        seasonNumber: sNum,
        episodes: []
      });
    }

    seasonsMap.get(sNum).episodes.push({
      episodeNumber: video.number || video.episode,
      title: video.name || video.title || `Episode ${video.number || video.episode}`,
      duration: video.runtime ? `${video.runtime}m` : null,
      overview: video.overview || video.description || null,
      videoUrl: null,
      streamType: "series",
      streamId: null
    });
  }

  const seasons = Array.from(seasonsMap.values()).sort((a, b) => a.seasonNumber - b.seasonNumber);
  for (const s of seasons) {
    s.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
    s.episodeCount = s.episodes.length;
  }

  return seasons;
};

export async function searchCinemeta(query, signal) {
  if (!query?.trim()) return [];

  const trimmed = query.trim();

  const [movieRes, tvRes] = await Promise.allSettled([
    fetch(getCinemetaUrl(`/catalog/movie/top/search=${encodeURIComponent(trimmed)}.json`), { signal }),
    fetch(getCinemetaUrl(`/catalog/series/top/search=${encodeURIComponent(trimmed)}.json`), { signal })
  ]);

  const results = [];

  if (movieRes.status === "fulfilled" && movieRes.value.ok) {
    const data = await movieRes.value.json().catch(() => ({}));
    if (Array.isArray(data.metas)) {
      data.metas.forEach((r) => results.push(normalizeCinemetaSearchResult(r, "movie")));
    }
  }

  if (tvRes.status === "fulfilled" && tvRes.value.ok) {
    const data = await tvRes.value.json().catch(() => ({}));
    if (Array.isArray(data.metas)) {
      data.metas.forEach((r) => results.push(normalizeCinemetaSearchResult(r, "series")));
    }
  }

  return results.sort((a, b) => b.rating - a.rating).slice(0, 20);
}

export async function fetchCinemetaCatalog(type, genre, signal) {
  const normalizedType = type === "series" || type === "tv" ? "series" : "movie";
  const genrePath = genre ? `/genre=${encodeURIComponent(genre)}` : "";
  const url = getCinemetaUrl(`/catalog/${normalizedType}/top${genrePath}.json`);

  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data?.metas)) return [];

    return data.metas.map((r) => normalizeCinemetaSearchResult(r, normalizedType));
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn(`Cinemeta catalog request failed for ${url}:`, error);
    }
    return [];
  }
}

export async function fetchCinemetaDetails(type, imdbId, signal) {
  if (!imdbId) return null;

  const normalizedType = type === "series" ? "series" : "movie";
  try {
    const response = await fetch(getCinemetaUrl(`/meta/${normalizedType}/${encodeURIComponent(imdbId)}.json`), { signal });
    if (!response.ok) return null;

    const data = await response.json();
    return data.meta || null;
  } catch (error) {
    console.warn(`Cinemeta details request failed for ${imdbId}:`, error);
    return null;
  }
}
