import { useEffect, useState } from "react";
import {
  discoverBollywood,
  discoverMollywood,
  discoverAnime,
  discoverMostPopular,
  discoverTopRated,
  discoverNewReleases,
  discoverComingSoon,
  hasTmdbCredentials
} from "../services/tmdbApi";

const CATEGORY_TTL_MS = 6 * 60 * 60 * 1000;
const STORAGE_KEY = "openstream_category_cache_v1";

const CATEGORY_KEYS = ["bollywood", "mollywood", "anime", "mostPopular", "topRated", "newReleases", "comingSoon"];

const getStoredCache = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.updatedAt > CATEGORY_TTL_MS) return null;
    const hasData = CATEGORY_KEYS.some(k => Array.isArray(parsed[k]) && parsed[k].length > 0);
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
  const [bollywood, setBollywood] = useState(cached?.bollywood || []);
  const [mollywood, setMollywood] = useState(cached?.mollywood || []);
  const [anime, setAnime] = useState(cached?.anime || []);
  const [mostPopular, setMostPopular] = useState(cached?.mostPopular || []);
  const [topRatedList, setTopRatedList] = useState(cached?.topRated || []);
  const [newReleases, setNewReleases] = useState(cached?.newReleases || []);
  const [comingSoon, setComingSoon] = useState(cached?.comingSoon || []);
  const [loading, setLoading] = useState(hasTmdbCredentials && !cached);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!hasTmdbCredentials || cached) return;

    let cancelled = false;

    queueMicrotask(async () => {
      try {
        const results = await Promise.allSettled([
          discoverBollywood(12),
          discoverMollywood(12),
          discoverAnime(12),
          discoverMostPopular(12),
          discoverTopRated(12),
          discoverNewReleases(12),
          discoverComingSoon(12)
        ]);

        if (cancelled) return;

        const bolly = results[0].status === "fulfilled" ? results[0].value : [];
        const molly = results[1].status === "fulfilled" ? results[1].value : [];
        const anim = results[2].status === "fulfilled" ? results[2].value : [];
        const popular = results[3].status === "fulfilled" ? results[3].value : [];
        const top = results[4].status === "fulfilled" ? results[4].value : [];
        const newRel = results[5].status === "fulfilled" ? results[5].value : [];
        const coming = results[6].status === "fulfilled" ? results[6].value : [];

        setBollywood(bolly);
        setMollywood(molly);
        setAnime(anim);
        setMostPopular(popular);
        setTopRatedList(top);
        setNewReleases(newRel);
        setComingSoon(coming);

        const saveIfNonEmpty = (key, data) => {
          if (Array.isArray(data) && data.length > 0) saveToCache(key, data);
        };

        saveIfNonEmpty("bollywood", bolly);
        saveIfNonEmpty("mollywood", molly);
        saveIfNonEmpty("anime", anim);
        saveIfNonEmpty("mostPopular", popular);
        saveIfNonEmpty("topRated", top);
        saveIfNonEmpty("newReleases", newRel);
        saveIfNonEmpty("comingSoon", coming);
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => { cancelled = true; };
    // `cached` is intentionally a dep so the effect re-fetches if the
    // category cache is cleared during the component's lifetime. In practice
    // it never changes after mount, so this is effectively run-once.
  }, [cached]);

  return { bollywood, mollywood, anime, mostPopular, topRated: topRatedList, newReleases, comingSoon, loading, error };
}
