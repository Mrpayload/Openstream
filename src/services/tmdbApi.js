import { getAbsoluteApiUrl } from "../utils/apiConfig";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const SAMPLE_MOVIE_URL = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4";

const apiKey = import.meta.env.VITE_TMDB_API_KEY;
const accessToken = import.meta.env.VITE_TMDB_ACCESS_TOKEN;

const getImageUrl = (path, size) => path ? `${TMDB_IMAGE_BASE}/${size}${path}` : undefined;

const getHeaders = () => {
  if (!accessToken) return {};
  return {
    Authorization: `Bearer ${accessToken}`
  };
};

const buildUrl = (pathWithParams) => {
  const separator = pathWithParams.includes("?") ? "&" : "?";
  let finalPath = `${pathWithParams}${separator}language=en-US`;
  
  if (apiKey && !accessToken) {
    finalPath += `&api_key=${apiKey}`;
  }

  const proxyBase = getAbsoluteApiUrl("/api/tmdb");
  const proxySeparator = proxyBase.includes("?") ? "&" : "?";
  return `${proxyBase}${proxySeparator}path=${encodeURIComponent(finalPath)}`;
};

const slugify = (value) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const normalizeGenres = (genreNames) => {
  if (!Array.isArray(genreNames) || genreNames.length === 0) return ["Drama"];
  return genreNames.filter(Boolean).slice(0, 3);
};

const pickVibe = (genres) => {
  if (genres.some((genre) => ["Horror", "Thriller", "Mystery"].includes(genre))) return "Spooky";
  if (genres.some((genre) => ["Action", "Adventure", "Animation"].includes(genre))) return "Hype";
  if (genres.some((genre) => ["Science Fiction", "Sci-Fi", "Fantasy"].includes(genre))) return "Brainy";
  if (genres.some((genre) => ["Romance", "Music"].includes(genre))) return "Romantic";
  return "Chill";
};

const buildStreamId = (type, tmdbId, seasonNumber = 1, episodeNumber = 1) => {
  if (type === "series") return `tmdb:${tmdbId}:${seasonNumber}:${episodeNumber}`;
  return `tmdb:${tmdbId}`;
};

export const hasTmdbCredentials = Boolean(apiKey || accessToken);

export async function fetchTmdbDetails(item) {
  if (!hasTmdbCredentials || !item.tmdbId || !item.tmdbMediaType) {
    return item;
  }

  const response = await fetch(buildUrl(`/${item.tmdbMediaType}/${item.tmdbId}`), {
    headers: getHeaders()
  });

  if (!response.ok) {
    throw new Error(`TMDB request failed for ${item.title}: ${response.status}`);
  }

  const details = await response.json();
  const title = details.title || details.name || item.title;
  const releaseDate = details.release_date || details.first_air_date || "";
  const genres = details.genres?.map((genre) => genre.name).filter(Boolean);

  const base = {
    ...item,
    title,
    rating: details.vote_average ? Number(details.vote_average.toFixed(1)) : item.rating,
    year: releaseDate ? releaseDate.slice(0, 4) : item.year,
    genres: genres?.length ? genres : item.genres,
    description: details.overview || item.description,
    posterUrl: getImageUrl(details.poster_path, "w500") || item.posterUrl,
    backdropUrl: getImageUrl(details.backdrop_path, "w1280") || item.backdropUrl,
    tagline: details.tagline || item.tagline || undefined,
    voteCount: details.vote_count || item.voteCount || undefined,
    originalLanguage: details.original_language || item.originalLanguage || undefined,
  };

  if (item.tmdbMediaType === "tv") {
    const runtime = details.episode_run_time?.[0];
    return {
      ...base,
      duration: runtime ? `${runtime} min` : item.duration,
      status: details.status || item.status || undefined,
      network: details.networks?.[0]?.name || item.network || undefined,
      totalSeasons: details.number_of_seasons || item.totalSeasons || undefined,
      totalEpisodes: details.number_of_episodes || item.totalEpisodes || undefined,
      lastAirDate: details.last_air_date || item.lastAirDate || undefined,
      inProduction: details.in_production ?? item.inProduction ?? undefined,
      creator: details.created_by?.map((c) => c.name).filter(Boolean).join(", ") || item.creator,
      originCountry: details.origin_country?.join(", ") || item.originCountry || undefined,
    };
  }

  return {
    ...base,
    duration: details.runtime ? `${Math.floor(details.runtime / 60)}h ${details.runtime % 60}m` : item.duration,
  };
}

export async function hydrateCatalogFromTmdb(items) {
  if (!hasTmdbCredentials) {
    return items;
  }

  const settled = await Promise.allSettled(items.map(fetchTmdbDetails));

  return settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;

    console.warn(result.reason);
    return items[index];
  });
}

export async function fetchTmdbList(path) {
  if (!hasTmdbCredentials) return [];

  const response = await fetch(buildUrl(path), {
    headers: getHeaders()
  });

  if (!response.ok) {
    throw new Error(`TMDB list request failed: ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

export async function fetchTrendingCatalogCandidates(limit = 12) {
  if (!hasTmdbCredentials) return [];

  const [movies, tvShows] = await Promise.all([
    fetchTmdbList("/trending/movie/week"),
    fetchTmdbList("/trending/tv/week")
  ]);

  return [...movies, ...tvShows]
    .filter((item) => item.id && (item.media_type === "movie" || item.media_type === "tv" || item.title || item.name))
    .slice(0, limit);
}

export async function normalizeTmdbCandidate(candidate) {
  const mediaType = candidate.media_type === "tv" || candidate.name ? "tv" : "movie";
  const baseItem = {
    id: `tmdb-${mediaType}-${candidate.id}`,
    title: candidate.title || candidate.name || "Untitled",
    type: mediaType === "tv" ? "series" : "movie",
    tmdbId: candidate.id,
    tmdbMediaType: mediaType,
    rating: candidate.vote_average ? Number(candidate.vote_average.toFixed(1)) : 0,
    year: (candidate.release_date || candidate.first_air_date || "").slice(0, 4) || "----",
    genres: ["Drama"],
    vibe: "Chill",
    description: candidate.overview || "No description available yet.",
    creator: "TMDB",
    cast: [],
    posterUrl: getImageUrl(candidate.poster_path, "w500"),
    backdropUrl: getImageUrl(candidate.backdrop_path, "w1280"),
    isAutoAdded: true,
    addedAt: new Date().toISOString()
  };

  const detailed = await fetchTmdbDetails(baseItem);
  const normalizedType = detailed.type;

  return {
    ...detailed,
    id: detailed.id || `${slugify(detailed.title)}-${detailed.tmdbId}`,
    type: normalizedType,
    streamType: normalizedType,
    streamId: normalizedType === "movie" ? buildStreamId(normalizedType, detailed.tmdbId) : undefined,
    videoUrl: normalizedType === "movie" ? SAMPLE_MOVIE_URL : undefined,
    seasons: normalizedType === "series" ? [] : undefined,
    needsSeasonHydration: normalizedType === "series",
    tagline: detailed.tagline || undefined,
    status: detailed.status || undefined,
    network: detailed.network || undefined,
    totalSeasons: detailed.totalSeasons || undefined,
    totalEpisodes: detailed.totalEpisodes || undefined,
    lastAirDate: detailed.lastAirDate || undefined,
    inProduction: detailed.inProduction ?? undefined,
    originCountry: detailed.originCountry || undefined,
  };
}

const normalizeSearchResult = (result, mediaType) => {
  const genres = normalizeGenres(result.genre_ids?.length
    ? lookupGenreNames(result.genre_ids)
    : ["Drama"]
  );

  const normalizedType = mediaType === "tv" ? "series" : "movie";

  return {
    id: `tmdb-search-${mediaType}-${result.id}`,
    title: result.title || result.name || "Untitled",
    type: normalizedType,
    streamType: normalizedType,
    tmdbId: result.id,
    tmdbMediaType: mediaType,
    rating: result.vote_average ? Number(Number(result.vote_average.toFixed(1))) : 0,
    year: (result.release_date || result.first_air_date || "").slice(0, 4) || "----",
    genres,
    vibe: pickVibe(genres),
    description: result.overview || "No description available yet.",
    creator: "TMDB",
    cast: [],
    posterUrl: getImageUrl(result.poster_path, "w500"),
    backdropUrl: getImageUrl(result.backdrop_path, "w1280"),
    isSearchResult: true,
    seasons: normalizedType === "series" ? [] : undefined,
    needsSeasonHydration: normalizedType === "series"
  };
};

const genreIdMap = [
  { id: 28, name: "Action" }, { id: 12, name: "Adventure" }, { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" }, { id: 80, name: "Crime" }, { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" }, { id: 10751, name: "Family" }, { id: 14, name: "Fantasy" },
  { id: 36, name: "History" }, { id: 27, name: "Horror" }, { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" }, { id: 10749, name: "Romance" }, { id: 878, name: "Science Fiction" },
  { id: 10770, name: "TV Movie" }, { id: 53, name: "Thriller" }, { id: 10752, name: "War" },
  { id: 37, name: "Western" }
];

const lookupGenreNames = (ids) => {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => genreIdMap.find((g) => g.id === id)?.name).filter(Boolean);
};

export async function searchTmdb(query, signal) {
  if (!hasTmdbCredentials || !query?.trim()) return [];

  const trimmed = query.trim();

  const [movieRes, tvRes] = await Promise.allSettled([
    fetch(buildUrl(`/search/movie?query=${encodeURIComponent(trimmed)}`), { headers: getHeaders(), signal }),
    fetch(buildUrl(`/search/tv?query=${encodeURIComponent(trimmed)}`), { headers: getHeaders(), signal })
  ]);

  const results = [];

  if (movieRes.status === "fulfilled" && movieRes.value.ok) {
    const data = await movieRes.value.json();
    if (Array.isArray(data.results)) {
      data.results.forEach((r) => results.push(normalizeSearchResult(r, "movie")));
    }
  }

  if (tvRes.status === "fulfilled" && tvRes.value.ok) {
    const data = await tvRes.value.json();
    if (Array.isArray(data.results)) {
      data.results.forEach((r) => results.push(normalizeSearchResult(r, "tv")));
    }
  }

  return results.sort((a, b) => b.rating - a.rating).slice(0, 20);
}

export async function fetchTmdbSeasons(tmdbId) {
  if (!hasTmdbCredentials || !tmdbId) return null;

  try {
    const response = await fetch(buildUrl(`/tv/${tmdbId}?append_to_response=seasons`), {
      headers: getHeaders()
    });

    if (!response.ok) {
      console.warn(`TMDB seasons request failed for ${tmdbId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.warn(`TMDB seasons fetch error for ${tmdbId}:`, error);
    return null;
  }
}

export async function fetchTmdbSeasonEpisodes(tmdbId, seasonNumber) {
  if (!hasTmdbCredentials || !tmdbId || !seasonNumber) return null;

  try {
    const response = await fetch(buildUrl(`/tv/${tmdbId}/season/${seasonNumber}`), {
      headers: getHeaders()
    });

    if (!response.ok) {
      console.warn(`TMDB season ${seasonNumber} request failed for ${tmdbId}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.warn(`TMDB season ${seasonNumber} fetch error for ${tmdbId}:`, error);
    return null;
  }
}

export async function discoverTmdbCatalogItems(existingItems, limit = 12) {
  if (!hasTmdbCredentials) return [];

  const existingKeys = new Set(existingItems.map((item) => `${item.tmdbMediaType}:${item.tmdbId}`));
  const candidates = await fetchTrendingCatalogCandidates(limit * 2);
  const uniqueCandidates = candidates.filter((candidate) => {
    const mediaType = candidate.media_type === "tv" || candidate.name ? "tv" : "movie";
    return !existingKeys.has(`${mediaType}:${candidate.id}`);
  }).slice(0, limit);

  const settled = await Promise.allSettled(uniqueCandidates.map(normalizeTmdbCandidate));

  return settled.flatMap((result) => {
    if (result.status === "fulfilled" && result.value.tmdbId) return [result.value];
    if (result.status === "rejected") console.warn(result.reason);
    return [];
  });
}

const normalizeDiscoverResult = (result, mediaType) => {
  const genres = normalizeGenres(result.genre_ids?.length
    ? lookupGenreNames(result.genre_ids)
    : ["Drama"]
  );
  const normalizedType = mediaType === "tv" ? "series" : "movie";

  return {
    id: `tmdb-discover-${mediaType}-${result.id}`,
    title: result.title || result.name || "Untitled",
    type: normalizedType,
    streamType: normalizedType,
    tmdbId: result.id,
    tmdbMediaType: mediaType,
    rating: result.vote_average ? Number(result.vote_average.toFixed(1)) : 0,
    year: (result.release_date || result.first_air_date || "").slice(0, 4) || "----",
    genres,
    vibe: pickVibe(genres),
    description: result.overview || "No description available yet.",
    creator: "TMDB",
    cast: [],
    posterUrl: getImageUrl(result.poster_path, "w500"),
    backdropUrl: getImageUrl(result.backdrop_path, "w1280"),
    isAutoAdded: true,
    addedAt: new Date().toISOString(),
    seasons: normalizedType === "series" ? [] : undefined,
    needsSeasonHydration: normalizedType === "series"
  };
};

export async function discoverByCategory(params, limit = 12) {
  if (!hasTmdbCredentials) return [];

  try {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      searchParams.set(key, value);
    }
    searchParams.set("sort_by", "popularity.desc");
    searchParams.set("page", "1");

    const response = await fetch(buildUrl(`/discover/movie?${searchParams.toString()}`), { headers: getHeaders() });
    if (!response.ok) return [];

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results.slice(0, limit).map((r) => normalizeDiscoverResult(r, "movie"));
  } catch (error) {
    console.warn("Category discover failed:", error);
    return [];
  }
}

export async function discoverBollywood(limit = 12) {
  return discoverByCategory({ with_original_language: "hi" }, limit);
}

export async function discoverMollywood(limit = 12) {
  return discoverByCategory({ with_original_language: "ml" }, limit);
}

export async function discoverAnime(limit = 12) {
  return discoverByCategory({ with_genres: "16" }, limit);
}

export async function discoverMostPopular(limit = 12) {
  if (!hasTmdbCredentials) return [];

  try {
    const searchParams = new URLSearchParams();
    searchParams.set("page", "1");

    const response = await fetch(buildUrl(`/movie/popular?${searchParams.toString()}`), { headers: getHeaders() });
    if (!response.ok) return [];

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results.slice(0, limit).map((r) => normalizeDiscoverResult(r, "movie"));
  } catch (error) {
    console.warn("Most Popular discover failed:", error);
    return [];
  }
}

export async function discoverTopRated(limit = 12) {
  if (!hasTmdbCredentials) return [];

  try {
    const searchParams = new URLSearchParams();
    searchParams.set("page", "1");

    const response = await fetch(buildUrl(`/movie/top_rated?${searchParams.toString()}`), { headers: getHeaders() });
    if (!response.ok) return [];

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];
    return results.slice(0, limit).map((r) => normalizeDiscoverResult(r, "movie"));
  } catch (error) {
    console.warn("Top Rated discover failed:", error);
    return [];
  }
}

export async function discoverNewReleases(limit = 12) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

  return discoverByCategory({ "primary_release_date.gte": dateStr }, limit);
}

export async function discoverComingSoon(limit = 12) {
  const today = new Date().toISOString().split("T")[0];

  return discoverByCategory({ "primary_release_date.gte": today }, limit);
}

export const IMDB_ID_REGEX = /^tt\d{7,10}$/i;
export const isImdbId = (val) => typeof val === "string" && IMDB_ID_REGEX.test(val.trim());

