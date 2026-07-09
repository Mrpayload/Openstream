import { useEffect, useState } from "react";
import {
  discoverBollywood,
  discoverMollywood,
  hasTmdbCredentials
} from "../services/tmdbApi";
import { fetchCinemetaCatalog } from "../services/cinemetaApi";
const CATEGORY_TTL_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = "openstream_category_cache_v1";

const CATEGORY_KEYS = ["bollywood", "mollywood", "anime", "mostPopular", "topRated", "newReleases", "comingSoon"];

const getStoredCache = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed.updatedAt !== 'number' || Date.now() - parsed.updatedAt > CATEGORY_TTL_MS) return null;
    const hasData = CATEGORY_KEYS.every(k => Array.isArray(parsed[k]) && parsed[k].length > 0);
    if (!hasData) return null;
    return parsed;
  } catch {
    return null;
  }
};

const saveToCache = (key, data) => {
  try {
    const cache = getStoredCache() || {};
    cache[key] = data;
    cache.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full — skip caching
  }
};

export function useLandingData() {
  const cached = getStoredCache();
  const [bollywood, setBollywood] = useState(() => Array.isArray(cached?.bollywood) ? cached.bollywood : []);
  const [mollywood, setMollywood] = useState(() => Array.isArray(cached?.mollywood) ? cached.mollywood : []);
  const [anime, setAnime] = useState(() => Array.isArray(cached?.anime) ? cached.anime : []);
  const [mostPopular, setMostPopular] = useState(() => Array.isArray(cached?.mostPopular) ? cached.mostPopular : []);
  const [topRatedList, setTopRatedList] = useState(() => Array.isArray(cached?.topRated) ? cached.topRated : []);
  const [newReleases, setNewReleases] = useState(() => Array.isArray(cached?.newReleases) ? cached.newReleases : []);
  const [comingSoon, setComingSoon] = useState(() => Array.isArray(cached?.comingSoon) ? cached.comingSoon : []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (cached) return;

    const controller = new AbortController();
    let cancelled = false;

    queueMicrotask(async () => {
      try {
        const [cinemetaRes, tmdbRes] = await Promise.all([
          Promise.allSettled([
            fetchCinemetaCatalog("movie", null, controller.signal),
            fetchCinemetaCatalog("series", null, controller.signal),
            fetchCinemetaCatalog("series", "Animation", controller.signal),
            fetchCinemetaCatalog("movie", "Animation", controller.signal),
          ]),
          hasTmdbCredentials ? Promise.allSettled([
            discoverBollywood(12),
            discoverMollywood(12)
          ]) : Promise.resolve([])
        ]);

        if (cancelled) return;

        const cTopMovies = cinemetaRes[0].status === "fulfilled" ? cinemetaRes[0].value : [];
        const cTopSeries = cinemetaRes[1].status === "fulfilled" ? cinemetaRes[1].value : [];
        const cAnimeSeries = cinemetaRes[2].status === "fulfilled" ? cinemetaRes[2].value : [];
        const cAnimeMovies = cinemetaRes[3].status === "fulfilled" ? cinemetaRes[3].value : [];

        const bolly = tmdbRes[0]?.status === "fulfilled" ? tmdbRes[0].value : [];
        const molly = tmdbRes[1]?.status === "fulfilled" ? tmdbRes[1].value : [];

        const popular = [];
        const maxLen = Math.max(cTopMovies.length, cTopSeries.length);
        for (let i = 0; i < maxLen; i++) {
          if (cTopMovies[i]) popular.push(cTopMovies[i]);
          if (cTopSeries[i]) popular.push(cTopSeries[i]);
        }

        const top = [...cTopMovies, ...cTopSeries].sort((a, b) => b.rating - a.rating).slice(0, 24);

        const currentYear = new Date().getFullYear();
        const newRel = [...cTopMovies, ...cTopSeries].filter((item) => {
          const y = parseInt(item.year);
          return !isNaN(y) && y >= currentYear - 1;
        }).slice(0, 24);

        const coming = [...cTopMovies, ...cTopSeries].filter((item) => {
          const y = parseInt(item.year);
          return !isNaN(y) && y >= currentYear;
        }).slice(0, 24);

        const anim = [];
        const maxAnimeLen = Math.max(cAnimeMovies.length, cAnimeSeries.length);
        for (let i = 0; i < maxAnimeLen; i++) {
          if (cAnimeSeries[i]) anim.push(cAnimeSeries[i]);
          if (cAnimeMovies[i]) anim.push(cAnimeMovies[i]);
        }

        setBollywood(bolly);
        setMollywood(molly);
        setAnime(anim.slice(0, 24));
        setMostPopular(popular.slice(0, 24));
        setTopRatedList(top.slice(0, 24));
        setNewReleases(newRel.slice(0, 24));
        setComingSoon(coming.slice(0, 24));

        const saveIfNonEmpty = (key, data) => {
          if (Array.isArray(data) && data.length > 0) saveToCache(key, data);
        };

        saveIfNonEmpty("bollywood", bolly);
        saveIfNonEmpty("mollywood", molly);
        saveIfNonEmpty("anime", anim.slice(0, 24));
        saveIfNonEmpty("mostPopular", popular.slice(0, 24));
        saveIfNonEmpty("topRated", top);
        saveIfNonEmpty("newReleases", newRel);
        saveIfNonEmpty("comingSoon", coming);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cached]);

  return { bollywood, mollywood, anime, mostPopular, topRated: topRatedList, newReleases, comingSoon, loading, error };
}

