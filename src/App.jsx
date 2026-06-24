import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Calendar, CheckCircle2, ChevronDown, ChevronUp, Film, Heart, Info, Loader2, Play, RefreshCw, Search, SlidersHorizontal, Star, X } from "lucide-react";
import { genresList, movies as fallbackMovies } from "./data/movies";
import { fetchEzvidapiStream, fetchFlixhqStream, fetchMediafusionStream, fetchSmplstreamStream, fetchStreams, fetchTorrentioStream, fetchVidlinkStream } from "./services/streamApi";
import { discoverTmdbCatalogItems, fetchTmdbSeasonEpisodes, fetchTmdbSeasons, hasTmdbCredentials, hydrateCatalogFromTmdb, searchTmdb } from "./services/tmdbApi";
import { getStreamLabel, hasProxyHeaders, isBrowserPlayableStream, isMagnetUrl } from "./utils/streamUtils";
import { useLandingData } from "./hooks/useLandingData";
import { useSwipeDownDismiss } from "./hooks/useSwipeDownDismiss";
import ErrorBoundary from "./components/ErrorBoundary";

import NeoPlayer from "./components/NeoPlayer";
import AdBlocker from "./components/AdBlocker";
import HeroBranding from "./components/HeroBranding";
import LoadingScreen from "./components/LoadingScreen";
import { motion, AnimatePresence } from "framer-motion";
const StreamPicker = lazy(() => import("./components/StreamPicker"));
import { buildFallbackStreamList } from "./utils/fallbackStreams";

const TOAST_TTL_MS = 3200;

// Catalog refresh cadence. A 30-minute poll was noisy: it kept the tab
// doing background network whenever TMDB creds were present, and ran a
// full fetch on every tab focus. The new policy is: hydrate once on mount,
// and only re-hydrate on tab focus if the catalog is older than 6 hours.
const CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CATALOG_REFRESH_MIN_AGE_MS = 6 * 60 * 60 * 1000;

let soundCtx = null;

const closeSoundContext = () => {
  if (!soundCtx) return;

  const ctx = soundCtx;
  soundCtx = null;
  if (ctx.state !== "closed") {
    void ctx.close().catch(() => {});
  }
};

const playSound = (type) => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (soundCtx?.state === "closed") soundCtx = null;

    if (!soundCtx) {
      soundCtx = new AudioCtx();
    }

    if (soundCtx.state === "suspended") {
      soundCtx.resume();
    }

    if (type === "pop") {
      const osc = soundCtx.createOscillator();
      const gain = soundCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, soundCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, soundCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.1, soundCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, soundCtx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(soundCtx.destination);
      osc.start();
      osc.stop(soundCtx.currentTime + 0.1);
    }
  } catch {
    // AudioContext may not be available (no-op)
  }
};

const getStoredWatchList = () => {
  const list = localStorage.getItem("openstream_watchlist_v3");
  if (!list) return [];

  try {
    return JSON.parse(list);
  } catch {
    return [];
  }
};

const getStoredRecentSearches = () => {
  const searches = localStorage.getItem("openstream_recent_searches_v1");
  if (!searches) return [];

  try {
    const parsed = JSON.parse(searches);
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch {
    return [];
  }
};

const getStoredCatalogUpdatedAt = () => localStorage.getItem("openstream_catalog_updated_at_v1");



const SEASONS_CACHE_KEY = "openstream_seasons_cache_v1";
const SEASONS_CACHE_TTL_MS = 60 * 60 * 1000;

const getStoredSeasonsCache = () => {
  try {
    const raw = localStorage.getItem(SEASONS_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const saveToSeasonsCache = (tmdbId, seasons) => {
  try {
    const cache = getStoredSeasonsCache();
    cache[String(tmdbId)] = { seasons, updatedAt: Date.now() };
    localStorage.setItem(SEASONS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable — skip caching
  }
};

const getFromSeasonsCache = (tmdbId) => {
  const cache = getStoredSeasonsCache();
  const entry = cache[String(tmdbId)];
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > SEASONS_CACHE_TTL_MS) return null;
  return entry.seasons;
};

const mapTmdbEpisodes = (data) => {
  if (!data?.episodes?.length) return [];
  return data.episodes.map((ep) => ({
    episodeNumber: ep.episode_number,
    title: ep.name || `Episode ${ep.episode_number}`,
    duration: ep.runtime ? `${ep.runtime}m` : null,
    overview: ep.overview || null,
    videoUrl: null,
    streamType: "series",
    streamId: null
  }));
};

const fetchEpisodesForSeason = async (tmdbId, seasonNumber) => {
  if (!hasTmdbCredentials || !tmdbId) return [];
  const data = await fetchTmdbSeasonEpisodes(tmdbId, seasonNumber);
  return mapTmdbEpisodes(data);
};

const hydrateSeasonsForItem = async (item) => {
  if (item.type !== "series" || !item.tmdbId) return item;
  if (!hasTmdbCredentials) return item;

  const cached = getFromSeasonsCache(item.tmdbId);
  if (cached && cached.length > 0) {
    const hasEpisodes = cached.some((s) => s.episodes && s.episodes.length > 0);
    if (hasEpisodes) {
      return { ...item, seasons: cached, needsSeasonHydration: false };
    }
  }

  const tmdbData = await fetchTmdbSeasons(item.tmdbId);
  if (!tmdbData?.seasons?.length) return item;

  const seasons = tmdbData.seasons
    .filter((s) => s.season_number > 0 && s.episode_count > 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      episodeCount: s.episode_count,
      episodes: []
    }));

  if (seasons.length === 0) return item;

  try {
    const firstEpisodes = await fetchEpisodesForSeason(item.tmdbId, seasons[0].seasonNumber);
    seasons[0] = { ...seasons[0], episodes: firstEpisodes };
  } catch {
    // Episode fetch failed, leave empty — will retry on tab click
  }

  saveToSeasonsCache(item.tmdbId, seasons);

  // Merge additional series metadata from the TMDB TV detail response
  const meta = {
    status: tmdbData.status || item.status || undefined,
    network: tmdbData.networks?.[0]?.name || item.network || undefined,
    totalSeasons: tmdbData.number_of_seasons || item.totalSeasons || seasons.length,
    totalEpisodes: tmdbData.number_of_episodes || item.totalEpisodes || undefined,
    lastAirDate: tmdbData.last_air_date || item.lastAirDate || undefined,
    inProduction: tmdbData.in_production ?? item.inProduction ?? undefined,
    originCountry: tmdbData.origin_country?.join(", ") || item.originCountry || undefined,
    creator: tmdbData.created_by?.map((c) => c.name).filter(Boolean).join(", ") || item.creator,
    tagline: tmdbData.tagline || item.tagline || undefined,
  };

  return { ...item, ...meta, seasons, needsSeasonHydration: false };
};

const IMAGE_FALLBACK = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 750'%3E%3Crect width='500' height='750' fill='%230C0C0C'/%3E%3Ccircle cx='250' cy='290' r='78' fill='%23222222' opacity='.72'/%3E%3Cpath d='M222 254v72l72-36z' fill='%23FFFFFF'/%3E%3Ctext x='250' y='430' text-anchor='middle' fill='%23888888' font-family='Arial,sans-serif' font-size='28' font-weight='700'%3EPoster unavailable%3C/text%3E%3C/svg%3E";

const handleImageError = (event) => {
  event.currentTarget.src = IMAGE_FALLBACK;
};

const getDefaultPlayable = (movie) => {
  if (movie.type === "series") {
    const season = movie.seasons?.[0];
    const episode = season?.episodes?.[0];
    if (!season || !episode) return null;

    return {
      videoUrl: episode.videoUrl,
      title: movie.title,
      subtitle: `S${season.seasonNumber} E${episode.episodeNumber} · ${episode.title}`,
      tmdbId: movie.tmdbId,
      tmdbMediaType: movie.tmdbMediaType,
      streamType: episode.streamType,
      streamId: episode.streamId,
      seasonNumber: season.seasonNumber,
      episodeNumber: episode.episodeNumber
    };
  }

  return {
    videoUrl: movie.videoUrl,
    title: movie.title,
    subtitle: "Full Stream",
    tmdbId: movie.tmdbId,
    tmdbMediaType: movie.tmdbMediaType,
    streamType: movie.streamType,
    streamId: movie.streamId
  };
};

const typeLabel = (type) => type === "series" ? "TV Show" : "Movie";

const handleCardKeyDown = (event, onActivate) => {
  if (event.currentTarget !== event.target) return;
  if (event.key !== "Enter" && event.key !== " ") return;

  event.preventDefault();
  onActivate();
};

const getPlaybackKey = (playable) => {
  if (!playable?.tmdbId) return null;
  if (playable.streamType === "series") {
    return `tv:${playable.tmdbId}:${playable.seasonNumber}:${playable.episodeNumber}`;
  }
  return `movie:${playable.tmdbId}`;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pickStreamTorrentFile = (files, preferredIndex) => {
  if (!Array.isArray(files) || files.length === 0) return null;
  const preferred = Number.isInteger(preferredIndex)
    ? files.find((file) => file.index === preferredIndex && file.isMedia)
    : null;
  if (preferred) return preferred;
  return files
    .filter((file) => file.isMedia)
    .sort((a, b) => (b.length || 0) - (a.length || 0))[0] || null;
};

const waitForStreamTorrentFile = async (infoHash, preferredIndex) => {
  const deadline = Date.now() + 45_000;
  let lastError = "Torrent metadata is not ready yet";
  while (Date.now() < deadline) {
    const response = await fetch(`/api/stream/${encodeURIComponent(infoHash)}/status`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      lastError = body.error || `Torrent status failed (${response.status})`;
    } else {
      const file = pickStreamTorrentFile(body.files, preferredIndex);
      if (body.ready && file) return { status: body, file };
      if (body.metadataTimedOut) lastError = "Torrent metadata lookup timed out";
    }
    await wait(1000);
  }
  throw new Error(lastError);
};

const prepareStreamTorrentPlayback = async (stream) => {
  const magnet = stream.originalMagnet || stream.url;
  if (!magnet?.startsWith("magnet:?")) {
    throw new Error("Stream Torrent row is missing the original magnet link");
  }

  const response = await fetch("/api/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ magnet })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Could not start server torrent");
  if (!body.infoHash) throw new Error("Torrent server did not return an infoHash");

  const preferredIndex = Number.isInteger(stream.fileIdx) ? stream.fileIdx : null;
  const { file } = await waitForStreamTorrentFile(body.infoHash, preferredIndex);
  const params = new URLSearchParams();
  if (stream.isHls) params.set("transcode", "1");
  const query = params.toString();

  return {
    ...stream,
    url: `/api/stream/${encodeURIComponent(body.infoHash)}/${file.index}${query ? `?${query}` : ""}`,
    streamTorrentInfoHash: body.infoHash,
    streamTorrentFileIndex: file.index,
    activeTorrentFileName: file.name,
    isMagnet: false,
  };
};

const getStoredPlaybackPosition = (playbackKey) => {
  if (!playbackKey) return 0;
  const value = Number(localStorage.getItem(`openstream_position_${playbackKey}`));
  return Number.isFinite(value) ? value : 0;
};

const buildEpisodePlayable = (movie, season, episode) => ({
  videoUrl: episode.videoUrl,
  title: movie.title,
  subtitle: `S${season.seasonNumber} E${episode.episodeNumber} · ${episode.title}`,
  tmdbId: movie.tmdbId,
  tmdbMediaType: movie.tmdbMediaType,
  streamType: episode.streamType,
  streamId: episode.streamId,
  seasonNumber: season.seasonNumber,
  episodeNumber: episode.episodeNumber
});

const PosterCard = memo(function PosterCard({ movie, rank, isFavorite, onOpenDetails, onToggleFavorite }) {
  return (
    <article
      className="poster-card clickable"
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${movie.title}`}
      onClick={onOpenDetails}
      onKeyDown={(event) => handleCardKeyDown(event, onOpenDetails)}
    >
      <img src={movie.posterUrl || IMAGE_FALLBACK} alt={`${movie.title} poster`} loading="lazy" decoding="async" onError={handleImageError} />
      <div className="poster-gradient" />
      {rank && <span className="rank-badge">Top{String(rank).padStart(2, "0")}</span>}
      <button className="card-heart clickable" onClick={onToggleFavorite} aria-label="Toggle favorite">
        <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
      </button>
      <div className="poster-copy">
        <h3>{movie.title}</h3>
        <p>{movie.rating || "--"} · {movie.year} · {typeLabel(movie.type)}</p>
      </div>
    </article>
  );
});

function SkeletonRow({ title = "Loading titles" }) {
  return (
    <section className="media-section fade-in" aria-label={title}>
      <div className="section-heading">
        <span className="skeleton-line wide" />
        <span className="skeleton-line small" />
      </div>
      <div className="poster-row">
        {Array.from({ length: 8 }, (_, index) => (
          <div className="poster-card skeleton-card" key={index} />
        ))}
      </div>
    </section>
  );
}

function MediaRow({ title, items, watchList, onOpenDetails, onToggleFavorite }) {
  return (
    <section className="media-section fade-in">
      <div className="section-heading">
        <h2>{title}</h2>
        <span>{items.length} titles</span>
      </div>
      <div className="poster-row">
        {items.map((movie, index) => (
          <PosterCard
            key={`${title}-${movie.id}`}
            movie={movie}
            rank={title.includes("Top") ? index + 1 : undefined}
            isFavorite={watchList.includes(movie.id)}
            onOpenDetails={() => onOpenDetails(movie)}
            onToggleFavorite={(e) => onToggleFavorite(movie.id, e)}
          />
        ))}
      </div>
    </section>
  );
}

const SearchResultCard = memo(function SearchResultCard({ movie, isFavorite, onOpenDetails, onToggleFavorite }) {
  return (
    <article
      className="search-result-card fade-in clickable"
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${movie.title}`}
      onClick={onOpenDetails}
      onKeyDown={(event) => handleCardKeyDown(event, onOpenDetails)}
    >
      <img src={movie.posterUrl || IMAGE_FALLBACK} alt={`${movie.title} poster`} loading="lazy" decoding="async" onError={handleImageError} />
      <div className="search-result-copy">
        <span className="eyebrow subtle">{typeLabel(movie.type)}</span>
        <h3>{movie.title}</h3>
        <div className="meta-line compact-meta">
          <span><Star size={13} fill="currentColor" /> {movie.rating || "--"}</span>
          <span>{movie.year}</span>
          <span>{movie.genres.slice(0, 2).join(" / ")}</span>
        </div>
        <p>{movie.description}</p>
        <div className="search-result-actions">
          <button className="primary-btn clickable" onClick={(event) => { event.stopPropagation(); onOpenDetails(); }}>
            <Play size={16} fill="currentColor" /> Details
          </button>
          <button className="ghost-btn clickable" onClick={onToggleFavorite}>
            <Heart size={16} fill={isFavorite ? "currentColor" : "none"} />
            {isFavorite ? "Saved" : "My List"}
          </button>
        </div>
      </div>
    </article>
  );
});

function DetailModal({ movie, isFavorite, onClose, onPlay, onToggleFavorite, seasonsLoading, episodesLoadingSeason, selectedSeasonIndex, onSelectSeason }) {
  const seasons = movie.seasons || [];
  const activeSeason = seasons[selectedSeasonIndex] || seasons[0];
  const activeEpisodes = activeSeason?.episodes || [];

  // Swipe-down-to-dismiss on mobile. The grab handle at the top of the
  // panel is the touch target; dragging it down past the threshold
  // (or doing a quick downward flick) calls onClose.
  const { dragY, isDragging, handlers } = useSwipeDownDismiss({ onDismiss: onClose });
  const dragOpacity = Math.max(0, 1 - Math.abs(dragY) / 400);

  return (
    <motion.div
      className="detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${movie.title} details`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: "linear" }}
    >
      <motion.section
        className="detail-panel"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98, y: 80 }}
        transition={{ duration: 0.15, ease: "linear" }}
        style={{
          y: dragY,
          opacity: dragOpacity,
          // Disable the CSS transition while the user is actively dragging
          // so the panel follows the finger 1:1; re-enable for the snap-back
          // and exit animations.
          transition: isDragging ? "none" : undefined,
        }}
      >
        {/* Swipe-down grab handle — touch target for dismiss gesture.
            Hidden on desktop via @media (hover: hover). */}
        <div
          className="swipe-grab-handle"
          aria-hidden="true"
          {...handlers}
        />
        <img className="detail-backdrop-img" src={movie.backdropUrl || IMAGE_FALLBACK} alt="" aria-hidden="true" decoding="async" onError={handleImageError} />
        <div className="detail-vignette" />
        <button className="detail-close clickable" onClick={onClose} aria-label="Close details">
          <X size={20} />
        </button>

        <div className="detail-content">
          <img className="detail-poster" src={movie.posterUrl || IMAGE_FALLBACK} alt={`${movie.title} poster`} loading="lazy" decoding="async" onError={handleImageError} />
          <div className="detail-copy">
            <span className="eyebrow">{typeLabel(movie.type)}</span>
            <h2>{movie.title}</h2>
            <div className="meta-line">
              <span><Star size={14} fill="currentColor" /> {movie.rating || "--"}</span>
              <span><Calendar size={14} /> {movie.year}</span>
              <span>{movie.genres.slice(0, 3).join(" / ")}</span>
            </div>
            <div className="hero-actions">
              <button className="primary-btn clickable" onClick={() => onPlay()}>
                <Play size={18} fill="currentColor" />
                {getStoredPlaybackPosition(getPlaybackKey(getDefaultPlayable(movie))) > 30 ? "Resume" : "Play"}
              </button>
              <button className="secondary-btn clickable" onClick={onToggleFavorite}>
                <Heart size={18} fill={isFavorite ? "currentColor" : "none"} />
                {isFavorite ? "Saved" : "My List"}
              </button>
            </div>
            <p>{movie.description}</p>
            <div className="detail-meta-grid">
              <span>Creator</span>
              <strong>{movie.creator || "Unknown"}</strong>
              <span>Cast</span>
              <strong>{movie.cast?.slice(0, 4).join(", ") || "Not listed"}</strong>
            </div>
          </div>
        </div>

        {movie.type === "series" && (
          <div className="episode-panel">
            <div className="section-heading compact">
              <h3>Episodes</h3>
              <span>{seasonsLoading ? "Loading seasons..." : seasons.length > 0 ? `${seasons.length} season${seasons.length === 1 ? "" : "s"}` : "No episodes available"}</span>
            </div>

            {seasonsLoading && (
              <div className="seasons-loading">
                <div className="seasons-loading-bar" />
                <p>Fetching episode data from TMDB...</p>
              </div>
            )}

            {!seasonsLoading && seasons.length > 1 && (
              <div className="season-tabs" role="tablist">
                {seasons.map((season, index) => {
                  const isLoading = episodesLoadingSeason === index;
                  return (
                    <button
                      key={season.seasonNumber}
                      className={`season-tab clickable ${index === selectedSeasonIndex ? "active" : ""} ${isLoading ? "loading" : ""}`}
                      role="tab"
                      aria-selected={index === selectedSeasonIndex}
                      disabled={isLoading}
                      onClick={() => onSelectSeason(index)}
                    >
                      {isLoading ? "Loading…" : `Season ${season.seasonNumber}`}
                    </button>
                  );
                })}
              </div>
            )}

            {!seasonsLoading && activeSeason && activeEpisodes.length > 0 && (
              <div className="episode-list">
                {activeEpisodes.map((episode) => (
                  <button
                    className="episode-card clickable"
                    key={`${activeSeason.seasonNumber}-${episode.episodeNumber}`}
                    onClick={() => onPlay(buildEpisodePlayable(movie, activeSeason, episode))}
                  >
                    <div className="episode-card-play-overlay">
                      <Play size={16} fill="currentColor" style={{ marginLeft: "2px" }} />
                    </div>
                    <span>S{activeSeason.seasonNumber} E{episode.episodeNumber}</span>
                    <strong>{episode.title}</strong>
                    <small>
                      {getStoredPlaybackPosition(getPlaybackKey(buildEpisodePlayable(movie, activeSeason, episode))) > 30 ? "Resume available" : episode.duration || "Runtime unavailable"}
                    </small>
                  </button>
                ))}
              </div>
            )}

            {!seasonsLoading && activeSeason && activeEpisodes.length === 0 && episodesLoadingSeason === selectedSeasonIndex && (
              <div className="episodes-fetching">
                <div className="seasons-loading-bar" />
                <p>Fetching episodes from TMDB…</p>
              </div>
            )}

            {!seasonsLoading && activeSeason && activeEpisodes.length === 0 && episodesLoadingSeason !== selectedSeasonIndex && seasons.length > 0 && (
              <div className="episodes-fetching">
                <p>Select a season to load episodes.</p>
              </div>
            )}
          </div>
        )}
      </motion.section>
    </motion.div>
  );
}

const PlayerEpisodeCard = memo(function PlayerEpisodeCard({ activeSeason, episode, isCurrent, onPlay }) {
  const handleClick = useCallback(() => {
    onPlay({ season: activeSeason, episode });
  }, [activeSeason, episode, onPlay]);

  return (
    <button
      className={`episode-card clickable ${isCurrent ? "episode-current" : ""}`}
      onClick={handleClick}
    >
      <div className="episode-card-play-overlay">
        {isCurrent ? (
          <span className="now-playing-badge">Now Playing</span>
        ) : (
          <Play size={16} fill="currentColor" style={{ marginLeft: "2px" }} />
        )}
      </div>
      <span>S{activeSeason.seasonNumber} E{episode.episodeNumber}</span>
      <strong>{episode.title}</strong>
      <small>{episode.duration || "Runtime unavailable"}</small>
    </button>
  );
});

export default function App() {
  const { bollywood, mollywood, anime, mostPopular, topRated, newReleases, comingSoon, loading: categoriesLoading } = useLandingData();
  const [catalog, setCatalog] = useState(fallbackMovies);
  const [isTmdbLoading, setIsTmdbLoading] = useState(hasTmdbCredentials);
  const [catalogStatus, setCatalogStatus] = useState(hasTmdbCredentials ? "refreshing" : "fallback");
  const catalogRefreshRef = useRef(Promise.resolve(fallbackMovies));
  const searchInputRef = useRef(null);
  const searchResultsRef = useRef(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("All");
  const [selectedType, setSelectedType] = useState("all");
  const [selectedYearRange, setSelectedYearRange] = useState("all");
  const [selectedRating, setSelectedRating] = useState("all");
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState(getStoredRecentSearches);
  const [watchList, setWatchList] = useState(getStoredWatchList);
  const [activeTab, setActiveTab] = useState("browse");
  const [heroIndex, setHeroIndex] = useState(0);
  const [isHeroPaused, setIsHeroPaused] = useState(false);
  const [tmdbResults, setTmdbResults] = useState([]);
  const [isTmdbSearching, setIsTmdbSearching] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState(null);
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [episodesLoadingSeason, setEpisodesLoadingSeason] = useState(null);
  const [selectedSeasonIndex, setSelectedSeasonIndex] = useState(0);
  const [hydratedMovie, setHydratedMovie] = useState(null);
  const [currentlyPlaying, setCurrentlyPlaying] = useState(null);
  const [sourceMovieRef, setSourceMovieRef] = useState(null);
  const [streamRequest, setStreamRequest] = useState(null);
  const [currentStreams, setCurrentStreams] = useState([]);
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState(null);
  // Per-section resolution state so the picker can stop spinning on a tab
  // once the corresponding API call has returned (even with 0 results).
  const [sectionsResolved, setSectionsResolved] = useState({ webstreamer: false, torrentio: false });
  const [toast, setToast] = useState(null);
  const [showLoadingScreen, setShowLoadingScreen] = useState(true);
  const toastTimerRef = useRef(null);

  const showToast = useCallback((message, variant = "info") => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ id: Date.now(), message, variant });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, TOAST_TTL_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const refreshCatalog = async ({ expand = true } = {}) => {
    if (!hasTmdbCredentials) {
      setCatalogStatus("fallback");
      setIsTmdbLoading(false);
      return fallbackMovies;
    }

    const request = catalogRefreshRef.current.then(async () => {
      setCatalogStatus("refreshing");
      setIsTmdbLoading(true);

      try {
        const hydrated = await hydrateCatalogFromTmdb(fallbackMovies);
        const discovered = expand ? await discoverTmdbCatalogItems(hydrated, 12) : [];
        const seen = new Set();
        const nextCatalog = [...hydrated, ...discovered].filter((item) => {
          const key = `${item.tmdbMediaType}:${item.tmdbId}`;
          if (!item.tmdbId || seen.has(key)) return false;
          seen.add(key);
          return true;
        }).map((item) => {
          if (item.type === "series" && !item.needsSeasonHydration) {
            return { ...item, needsSeasonHydration: true };
          }
          return item;
        });
        const updatedAt = new Date().toISOString();

        setCatalog((prevCatalog) => {
          const prevSeasonsMap = new Map();
          for (const item of prevCatalog) {
            if (item.seasons?.some((s) => s.episodes?.length > 0)) {
              prevSeasonsMap.set(item.tmdbId, item.seasons);
            }
          }
          return nextCatalog.map((item) => {
            const hydratedSeasons = prevSeasonsMap.get(item.tmdbId);
            return hydratedSeasons ? { ...item, seasons: hydratedSeasons } : item;
          });
        });
        setCatalogStatus("refreshed");
        localStorage.setItem("openstream_catalog_updated_at_v1", updatedAt);

        return nextCatalog;
      } catch (error) {
        console.warn(error);
        setCatalogStatus("failed");
        setCatalog(fallbackMovies);
        return fallbackMovies;
      } finally {
        setIsTmdbLoading(false);
      }
    });

    catalogRefreshRef.current = request.catch(() => fallbackMovies);
    return request;
  };

  useEffect(() => {
    queueMicrotask(() => refreshCatalog());
  }, []);

  // Keep the latest refreshCatalog in a ref so the visibility-change and
  // interval effects (which have empty deps by design — they should not
  // re-bind on every render) always call the most recent closure. The
  // catalogRefreshRef chain inside refreshCatalog already serialises
  // concurrent calls, so the ref only needs to forward the call.
  const refreshCatalogRef = useRef(() => Promise.resolve(fallbackMovies));
  useEffect(() => {
    refreshCatalogRef.current = refreshCatalog;
  });

  useEffect(() => {
    if (!hasTmdbCredentials) return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // Skip the refresh if the cached catalog is still fresh.
      const lastUpdated = getStoredCatalogUpdatedAt();
      if (lastUpdated && Date.now() - Date.parse(lastUpdated) < CATALOG_REFRESH_MIN_AGE_MS) {
        return;
      }
      void refreshCatalogRef.current({ expand: false });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (!hasTmdbCredentials) return undefined;

    const intervalId = window.setInterval(() => {
      void refreshCatalogRef.current({ expand: false });
    }, CATALOG_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    if (!searchTerm) return;
    const node = searchResultsRef.current;
    if (!node) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      node.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block: "start",
      });
    });
  }, [searchTerm]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const isShortcut = event.key === "/" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k");
      if (!isShortcut) return;

      const activeTag = document.activeElement?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;

      event.preventDefault();
      searchInputRef.current?.focus();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (catalog.length < 2 || isHeroPaused) return undefined;

    const intervalId = window.setInterval(() => {
      setHeroIndex((index) => (index + 1) % catalog.length);
    }, 9000);

    return () => window.clearInterval(intervalId);
  }, [catalog.length, isHeroPaused]);

  useEffect(() => {
    if (!hasTmdbCredentials || !searchTerm.trim()) return undefined;

    const controller = new AbortController();
    let cancelled = false;

    queueMicrotask(async () => {
      if (cancelled) return;
      setIsTmdbSearching(true);

      try {
        const results = await searchTmdb(searchTerm, controller.signal);
        if (!cancelled) {
          setTmdbResults(results);
          setIsTmdbSearching(false);
        }
      } catch (error) {
        if (!cancelled && error.name !== "AbortError") {
          setTmdbResults([]);
          setIsTmdbSearching(false);
        }
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [searchTerm]);

  const featured = catalog[heroIndex % Math.max(catalog.length, 1)];

  const filteredMovies = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return catalog.filter((movie) => {
      const year = Number(movie.year);
      const matchesSearch = !query ||
        movie.title.toLowerCase().includes(query) ||
        movie.year.includes(query) ||
        typeLabel(movie.type).toLowerCase().includes(query) ||
        movie.description.toLowerCase().includes(query) ||
        movie.creator?.toLowerCase().includes(query) ||
        movie.cast?.some((name) => name.toLowerCase().includes(query)) ||
        movie.genres.some((genre) => genre.toLowerCase().includes(query));
      const matchesGenre = selectedGenre === "All" || movie.genres.includes(selectedGenre);
      const matchesType = selectedType === "all" || movie.type === selectedType;
      const matchesYear = selectedYearRange === "all" ||
        (selectedYearRange === "2020s" && year >= 2020) ||
        (selectedYearRange === "2010s" && year >= 2010 && year <= 2019) ||
        (selectedYearRange === "older" && year < 2010);
      const matchesRating = selectedRating === "all" || movie.rating >= Number(selectedRating);
      return matchesSearch && matchesGenre && matchesType && matchesYear && matchesRating;
    });
  }, [catalog, searchTerm, selectedGenre, selectedRating, selectedType, selectedYearRange]);

  const combinedResults = useMemo(() => {
    if (!searchTerm.trim() || !hasTmdbCredentials || tmdbResults.length === 0) {
      return filteredMovies;
    }

    const seen = new Set();
    const merged = [];

    const addItem = (item) => {
      const key = item.tmdbId ? `${item.tmdbMediaType}:${item.tmdbId}` : item.id;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(item);
      }
    };

    filteredMovies.forEach(addItem);
    tmdbResults.forEach(addItem);

    return merged;
  }, [filteredMovies, tmdbResults, searchTerm]);

  const filterActiveCount = (selectedGenre !== "All" ? 1 : 0) + (selectedType !== "all" ? 1 : 0) + (selectedYearRange !== "all" ? 1 : 0) + (selectedRating !== "all" ? 1 : 0);

  const favorites = useMemo(() => catalog.filter((movie) => watchList.includes(movie.id)), [catalog, watchList]);

  const currentEpisodeNavigation = useMemo(() => {
    if (!currentlyPlaying || currentlyPlaying.streamType !== "series") {
      return { previous: null, next: null, movie: null };
    }

    const movie = catalog.find((item) => item.tmdbId === currentlyPlaying.tmdbId && item.type === "series")
      || sourceMovieRef;
    const episodes = movie?.seasons?.flatMap((season) => season.episodes.map((episode) => ({ season, episode }))) || [];
    const index = episodes.findIndex(({ season, episode }) => (
      season.seasonNumber === currentlyPlaying.seasonNumber && episode.episodeNumber === currentlyPlaying.episodeNumber
    ));

    return {
      previous: index > 0 ? episodes[index - 1] : null,
      next: index >= 0 && index < episodes.length - 1 ? episodes[index + 1] : null,
      episodes,
      currentIndex: index,
      movie
    };
  }, [catalog, currentlyPlaying, sourceMovieRef]);

  const isInitialCatalogReady = catalogStatus !== "refreshing" && !isTmdbLoading && !categoriesLoading && catalog.length > 0;

  const toggleWatchList = (movieId, e) => {
    if (e) e.stopPropagation();
    playSound("pop");

    const updated = watchList.includes(movieId)
      ? watchList.filter((id) => id !== movieId)
      : [...watchList, movieId];

    setWatchList(updated);
    localStorage.setItem("openstream_watchlist_v3", JSON.stringify(updated));
  };

  const saveRecentSearch = (term) => {
    const trimmed = term.trim();
    if (!trimmed) return;

    const updated = [trimmed, ...recentSearches.filter((search) => search.toLowerCase() !== trimmed.toLowerCase())].slice(0, 6);
    setRecentSearches(updated);
    localStorage.setItem("openstream_recent_searches_v1", JSON.stringify(updated));
  };

  const clearSearch = () => {
    setSearchInput("");
    setSearchTerm("");
  };

  const resetAllFilters = () => {
    clearSearch();
    setSelectedGenre("All");
    setSelectedType("all");
    setSelectedYearRange("all");
    setSelectedRating("all");
  };

  const applyRecentSearch = (term) => {
    setSearchInput(term);
    setSearchTerm(term);
    searchInputRef.current?.focus();
  };

  const loadStreamsForPlayable = async (playable) => {
    setIsStreamLoading(true);
    setStreamError(null);
    setCurrentStreams([]);
    setSectionsResolved({ webstreamer: false, torrentio: false });

    // Show fallback streams immediately so the user always sees playable options.
    // The fallback list is defined in src/utils/fallbackStreams.js so every UI
    // surface (App.jsx, StreamPicker, NeoPlayer) can share the same source of truth.
    const fallbackStreams = buildFallbackStreamList(playable);
    if (fallbackStreams.length > 0) {
      setCurrentStreams(fallbackStreams);
      setIsStreamLoading(false);
    }

    // Fetch API streams in the background and merge them in as they arrive.
    // Uses allSettled so a single slow/hanging API doesn't block the others.
    try {
      const [webStreamResult, flixhqResult, ezvidResult, smplResult, mediafusionResult, torrentioResult, vidlinkExtractResult] = await Promise.allSettled([
        fetchStreams(
          playable.streamType,
          playable.tmdbId,
          playable.seasonNumber,
          playable.episodeNumber
        ),
        fetchFlixhqStream(playable),
        fetchEzvidapiStream(playable),
        fetchSmplstreamStream(playable),
        fetchMediafusionStream(playable),
        fetchTorrentioStream(playable),
        fetchVidlinkStream(playable)
      ]);

      const unwrap = (result) => result.status === "fulfilled" ? result.value : null;

      const data = unwrap(webStreamResult) || { streams: [] };

      if (data.streams && data.streams.length > 0) {
        showToast("Webstreamer loading...", "loading");
      }

      const flixhqStream = unwrap(flixhqResult);
      const ezvidapiStreams = unwrap(ezvidResult);
      const smplstreamStreams = unwrap(smplResult);
      const mediafusionStreams = unwrap(mediafusionResult);
      const torrentioStreamsRaw = unwrap(torrentioResult);

      const flixhqStreams = flixhqStream ? [flixhqStream] : [];
      const ezvidStreams = Array.isArray(ezvidapiStreams) ? ezvidapiStreams : ezvidapiStreams ? [ezvidapiStreams] : [];
      const smplStreams = Array.isArray(smplstreamStreams) ? smplstreamStreams : smplstreamStreams ? [smplstreamStreams] : [];
      const mfStreams = Array.isArray(mediafusionStreams) ? mediafusionStreams : [];
      const torrentioStreams = Array.isArray(torrentioStreamsRaw) ? torrentioStreamsRaw : [];
      const vidlinkDirectStream = unwrap(vidlinkExtractResult);
      const apiStreams = [...(vidlinkDirectStream ? [vidlinkDirectStream] : []), ...flixhqStreams, ...ezvidStreams, ...smplStreams, ...mfStreams, ...(data.streams || [])];

      if (torrentioStreams.length > 0) {
        showToast(`Torrentio · ${torrentioStreams.length} magnet${torrentioStreams.length === 1 ? "" : "s"} ready`, "info");
      }

      // Merge API results before fallback streams
      if (apiStreams.length > 0 || torrentioStreams.length > 0) {
        setCurrentStreams([...apiStreams, ...torrentioStreams, ...fallbackStreams]);
      }
    } catch (error) {
      console.warn("Stream fetch error, fallback embed players already shown:", error);
      if (fallbackStreams.length === 0) {
        setStreamError(error instanceof Error ? error.message : "Unable to fetch streams");
      }
    } finally {
      setIsStreamLoading(false);
      // Mark every async section as resolved so the picker stops spinning
      // on a tab even if its API returned an empty array.
      setSectionsResolved({ webstreamer: true, torrentio: true });
    }
  };

  const startPlayback = (movie, playableOverride) => {
    const playable = playableOverride || getDefaultPlayable(movie);
    if (!playable) return;

    playSound("pop");
    setSourceMovieRef(movie);
    setSelectedMovie(null);
    setStreamRequest(playable);
    loadStreamsForPlayable(playable);
  };

  const openDetails = async (movie) => {
    playSound("pop");
    setSelectedMovie(movie);
    setSelectedSeasonIndex(0);
    setHydratedMovie(movie);

    if (movie.type === "series" && movie.needsSeasonHydration && hasTmdbCredentials) {
      setSeasonsLoading(true);
      try {
        const hydrated = await hydrateSeasonsForItem(movie);
        setHydratedMovie(hydrated);
        setSelectedMovie(hydrated);
        setCatalog((prev) => prev.map((item) =>
          item.tmdbId === movie.tmdbId ? { ...item, seasons: hydrated.seasons } : item
        ));
      } catch (error) {
        console.warn("Season hydration failed:", error);
      } finally {
        setSeasonsLoading(false);
      }
    }
  };

  const handleSelectSeason = async (index) => {
    setSelectedSeasonIndex(index);
    const movie = hydratedMovie || selectedMovie;
    if (!movie?.tmdbId || !movie?.seasons?.[index]) return;

    const season = movie.seasons[index];
    if (season.episodes && season.episodes.length > 0) return;

    setEpisodesLoadingSeason(index);
    try {
      const episodes = await fetchEpisodesForSeason(movie.tmdbId, season.seasonNumber);
      const updatedSeasons = [...movie.seasons];
      updatedSeasons[index] = { ...updatedSeasons[index], episodes };
      const updated = { ...movie, seasons: updatedSeasons };
      setHydratedMovie(updated);
      setSelectedMovie(updated);
      saveToSeasonsCache(movie.tmdbId, updatedSeasons);
      setCatalog((prev) => prev.map((item) =>
        item.tmdbId === movie.tmdbId ? { ...item, seasons: updatedSeasons } : item
      ));
    } catch (err) {
      console.warn(`Failed to fetch episodes for season ${season.seasonNumber}:`, err);
    } finally {
      setEpisodesLoadingSeason(null);
    }
  };

  const retryStreamLookup = () => {
    if (!streamRequest) return;
    loadStreamsForPlayable(streamRequest);
  };

  const closeStreamPicker = () => {
    setStreamRequest(null);
    setCurrentStreams([]);
    setStreamError(null);
    setIsStreamLoading(false);
    setSectionsResolved({ webstreamer: false, torrentio: false });
  };

  const selectStream = async (stream) => {
    if (!streamRequest) return;

    if (!stream.url) {
      setStreamError("Selected stream does not include a playable URL");
      return;
    }

    if (hasProxyHeaders(stream)) {
      setStreamError("This source requires custom proxy headers, which a browser video element cannot send directly. Choose another source.");
      return;
    }

    const selectedStreamIndex = currentStreams.findIndex((candidate) => candidate === stream);
    let selectedStream = stream;

    if (stream.serverTorrent || stream.source === "stream-torrent" || stream.isMagnet || isMagnetUrl(stream.url)) {
      setIsStreamLoading(true);
      setStreamError(null);
      showToast("Starting server-backed torrent...", "loading");
      try {
        const needsTranscode = stream.behaviorHints?.notWebReady || stream.isNotWebReady;
        if (needsTranscode && !stream.isHls) {
          stream.isHls = true;
        }
        if (!stream.originalMagnet) {
          stream.originalMagnet = stream.url;
        }
        selectedStream = await prepareStreamTorrentPlayback(stream);
        showToast("Server-backed torrent ready", "success");
      } catch (error) {
        setStreamError(error instanceof Error ? error.message : "Could not start server-backed torrent playback");
        showToast("Server-backed torrent failed", "error");
        setIsStreamLoading(false);
        return;
      }
    }
    const playbackStreams = selectedStreamIndex >= 0
      ? currentStreams.map((candidate, index) => index === selectedStreamIndex ? selectedStream : candidate)
      : currentStreams;

    setCurrentlyPlaying({
      ...streamRequest,
      videoUrl: selectedStream.url,
      subtitle: `${streamRequest.subtitle} · ${getStreamLabel(selectedStream)}`,
      stream: selectedStream,
      streamIndex: selectedStreamIndex,
      streams: playbackStreams,
      playbackKey: getPlaybackKey(streamRequest)
    });
    closeStreamPicker();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const switchPlayerStream = useCallback((stream, index) => {
    if (!stream?.url || hasProxyHeaders(stream)) return false;
    const selectedStream = stream.serverTorrent && stream.serverUrl
      ? { ...stream, url: stream.serverUrl }
      : stream;

    setCurrentlyPlaying((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        videoUrl: selectedStream.url,
        stream: selectedStream,
        streamIndex: index,
        subtitle: `${prev.subtitle.split(" · ")[0]} · ${getStreamLabel(selectedStream)}`
      };
    });

    return true;
  }, []);

  const playFallbackStream = useCallback(() => {
    if (!currentlyPlaying?.streams?.length) return false;

    const nextIndex = currentlyPlaying.streams.findIndex((stream, index) => (
      index > currentlyPlaying.streamIndex && isBrowserPlayableStream(stream)
    ));

    if (nextIndex === -1) return false;
    return switchPlayerStream(currentlyPlaying.streams[nextIndex], nextIndex);
  }, [currentlyPlaying, switchPlayerStream]);

  const playAdjacentEpisode = (direction) => {
    const target = direction === "next" ? currentEpisodeNavigation.next : currentEpisodeNavigation.previous;
    if (!target || !currentEpisodeNavigation.movie) return;

    startPlayback(
      currentEpisodeNavigation.movie,
      buildEpisodePlayable(currentEpisodeNavigation.movie, target.season, target.episode)
    );
  };

  const playEpisodeFromPlayer = (episodeEntry) => {
    if (!episodeEntry || !currentEpisodeNavigation.movie) return;

    startPlayback(
      currentEpisodeNavigation.movie,
      buildEpisodePlayable(currentEpisodeNavigation.movie, episodeEntry.season, episodeEntry.episode)
    );
  };

  return (
    <>
      <AnimatePresence>
        {showLoadingScreen && (
          <LoadingScreen
            isCatalogReady={isInitialCatalogReady}
            onFinish={() => setShowLoadingScreen(false)}
          />
        )}
      </AnimatePresence>
      <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="site-header">
          <button className="brand clickable" onClick={() => setActiveTab("browse")}>
          <HeroBranding header immediate layoutId={null} />
          <span className="brand-text-wrap">
            <span className="brand-title-line" aria-label="Openstream">
              {"O p e n s t r e a m".split("").map((char, index) => (
                <span className="brand-char" key={`${char}-${index}`}>{char}</span>
              ))}
              <span className="header-brand-cursor">_</span>
            </span>
            <span className="brand-subtitle">Your freedom to stream free</span>
          </span>
        </button>

        <nav className="header-nav">
          <button className={activeTab === "favorites" ? "active" : ""} onClick={() => setActiveTab("favorites")} aria-label="My List">
            <Heart size={16} aria-hidden="true" />
            <span>My List</span>
          </button>
        </nav>

        <button
          className={`refresh-btn clickable ${catalogStatus === "refreshing" ? "loading" : ""}`}
          onClick={() => refreshCatalog()}
          disabled={catalogStatus === "refreshing"}
          title={hasTmdbCredentials ? "Refresh catalog from TMDB" : "Add TMDB credentials to enable live refresh"}
        >
          <RefreshCw size={16} />
          <span>{catalogStatus === "refreshing" ? "Refreshing" : "Refresh"}</span>
        </button>

        <label className="search-shell">
          <Search size={17} />
            <input
              ref={searchInputRef}
              id="openstream-search"
              name="search"
              type="text"
              placeholder="Search title, cast, genre, year..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRecentSearch(searchInput);
                if (e.key === "Escape") clearSearch();
              }}
            />
          <span className="search-hint">/</span>
          {searchInput && (
            <button className={`search-clear clickable ${searchInput ? "visible" : ""}`} onClick={clearSearch} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </label>
      </header>

      <AdBlocker />

      <main className="stream-shell" id="main-content">
        <AnimatePresence>
          {streamRequest && (
            <Suspense fallback={<div className="stream-picker-backdrop"><div className="stream-picker-state"><h3>Loading stream picker...</h3></div></div>}>
              <StreamPicker
                title={streamRequest.title}
                streams={currentStreams}
                isLoading={isStreamLoading}
                error={streamError}
                sectionsResolved={sectionsResolved}
                onSelect={selectStream}
                onRetry={retryStreamLookup}
                onClose={closeStreamPicker}
                onNotify={showToast}
              />
            </Suspense>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedMovie && (
            <DetailModal
              movie={selectedMovie}
              isFavorite={watchList.includes(selectedMovie.id)}
              onClose={() => { setSelectedMovie(null); setHydratedMovie(null); }}
              onPlay={(playableOverride) => startPlayback(selectedMovie, playableOverride)}
              onToggleFavorite={(e) => toggleWatchList(selectedMovie.id, e)}
              seasonsLoading={seasonsLoading}
              episodesLoadingSeason={episodesLoadingSeason}
              selectedSeasonIndex={selectedSeasonIndex}
              onSelectSeason={handleSelectSeason}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {currentlyPlaying && (
            <motion.section
              className="player-wrap"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <NeoPlayer
                videoUrl={currentlyPlaying.videoUrl}
                title={currentlyPlaying.title}
                subtitle={currentlyPlaying.subtitle}
                onClose={() => { setCurrentlyPlaying(null); setSourceMovieRef(null); }}
              />
            </motion.section>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {currentlyPlaying ? (() => {
            const nowPlayingMovie = catalog.find((m) => m.tmdbId === currentlyPlaying.tmdbId) || currentEpisodeNavigation.movie || sourceMovieRef;
            const isSeries = currentlyPlaying.streamType === "series";
            const seasons = nowPlayingMovie?.seasons || [];
            const activeSeason = seasons[selectedSeasonIndex] || seasons[0];
            const activeEpisodes = activeSeason?.episodes || [];

            return (
              <motion.div
                key="now-playing"
                className="now-playing-panel"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {nowPlayingMovie && (
                  <>
                    <div className="now-playing-search">
                      <label className="search-shell search-shell-hero">
                        <Search size={18} />
                        <input
                          type="text"
                          placeholder="Search movies, actors, genres..."
                          value={searchInput}
                          onChange={(e) => setSearchInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRecentSearch(searchInput);
                            if (e.key === "Escape") clearSearch();
                          }}
                        />
                        {searchInput && (
                          <button className="search-clear clickable visible" onClick={clearSearch} aria-label="Clear search">
                            <X size={15} />
                          </button>
                        )}
                      </label>
                    </div>

                    {searchTerm && (
                      <div className="now-playing-results">
                        <div className="section-heading">
                          <h3>Results</h3>
                          <span>{combinedResults.length} titles{isTmdbSearching ? " · Searching TMDB..." : ""}</span>
                        </div>
                        {isTmdbSearching && <div className="tmdb-search-loading" />}
                        <div className="now-playing-results-grid">
                          {combinedResults.map((movie) => (
                            <SearchResultCard
                              key={movie.id}
                              movie={movie}
                              isFavorite={watchList.includes(movie.id)}
                              onOpenDetails={() => openDetails(movie)}
                              onToggleFavorite={(e) => toggleWatchList(movie.id, e)}
                            />
                          ))}
                        </div>
                        {combinedResults.length === 0 && !isTmdbSearching && (
                          <div className="empty-state compact-empty">
                            <p>No titles found for "{searchTerm}"</p>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="player-detail-header">
                      <img
                        className="player-detail-poster"
                        src={nowPlayingMovie.posterUrl || IMAGE_FALLBACK}
                        alt={`${nowPlayingMovie.title} poster`}
                        loading="lazy"
                        decoding="async"
                        onError={handleImageError}
                      />
                      <div className="player-detail-copy">
                        <span className="eyebrow">{typeLabel(nowPlayingMovie.type)}</span>
                        <h2>{nowPlayingMovie.title}</h2>
                        {nowPlayingMovie.tagline && (
                          <span className="tagline">&ldquo;{nowPlayingMovie.tagline}&rdquo;</span>
                        )}
                        <div className="meta-line">
                          <span><Star size={14} fill="currentColor" /> {nowPlayingMovie.rating || "--"}</span>
                          <span><Calendar size={14} /> {nowPlayingMovie.year}</span>
                          {nowPlayingMovie.duration && <span>{nowPlayingMovie.duration}</span>}
                          <span>{nowPlayingMovie.genres?.slice(0, 3).join(" / ")}</span>
                        </div>
                        <p>{nowPlayingMovie.description}</p>
                        <div className="detail-meta-grid">
                          <span>Creator</span>
                          <strong>{nowPlayingMovie.creator || "Unknown"}</strong>
                          {nowPlayingMovie.network && (
                            <>
                              <span>Network</span>
                              <strong>{nowPlayingMovie.network}</strong>
                            </>
                          )}
                          <span>Cast</span>
                          <strong>{nowPlayingMovie.cast?.slice(0, 4).join(", ") || "Not listed"}</strong>
                        </div>
                        {isSeries && (nowPlayingMovie.status || nowPlayingMovie.totalSeasons || nowPlayingMovie.totalEpisodes) && (
                          <div className="detail-meta-grid series-meta">
                            {nowPlayingMovie.status && (
                              <>
                                <span>Status</span>
                                <strong>{nowPlayingMovie.status}</strong>
                              </>
                            )}
                            {nowPlayingMovie.totalSeasons && (
                              <>
                                <span>Seasons</span>
                                <strong>{nowPlayingMovie.totalSeasons}</strong>
                              </>
                            )}
                            {nowPlayingMovie.totalEpisodes && (
                              <>
                                <span>Episodes</span>
                                <strong>{nowPlayingMovie.totalEpisodes}</strong>
                              </>
                            )}
                            {nowPlayingMovie.originCountry && (
                              <>
                                <span>Country</span>
                                <strong>{nowPlayingMovie.originCountry}</strong>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {isSeries && (
                      <div className="episode-panel">
                        <div className="section-heading compact">
                          <h3>Episodes</h3>
                          <span>{seasonsLoading ? "Loading seasons..." : seasons.length > 0 ? `${seasons.length} season${seasons.length === 1 ? "" : "s"}` : "No episodes available"}</span>
                        </div>

                        {seasonsLoading && (
                          <div className="seasons-loading">
                            <div className="seasons-loading-bar" />
                            <p>Fetching episode data from TMDB...</p>
                          </div>
                        )}

                        {!seasonsLoading && seasons.length > 1 && (
                          <div className="season-tabs" role="tablist">
                            {seasons.map((season, index) => {
                              const isLoading = episodesLoadingSeason === index;
                              return (
                                <button
                                  key={season.seasonNumber}
                                  className={`season-tab clickable ${index === selectedSeasonIndex ? "active" : ""} ${isLoading ? "loading" : ""}`}
                                  role="tab"
                                  aria-selected={index === selectedSeasonIndex}
                                  disabled={isLoading}
                                  onClick={() => handleSelectSeason(index)}
                                >
                                  {isLoading ? "Loading..." : `Season ${season.seasonNumber}`}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {!seasonsLoading && activeSeason && activeEpisodes.length > 0 && (
                          <div className="episode-list">
                            {activeEpisodes.map((episode) => {
                              const isCurrent = isSeries && activeSeason.seasonNumber === currentlyPlaying.seasonNumber && episode.episodeNumber === currentlyPlaying.episodeNumber;
                              return (
                                <PlayerEpisodeCard
                                  activeSeason={activeSeason}
                                  episode={episode}
                                  isCurrent={isCurrent}
                                  key={`${activeSeason.seasonNumber}-${episode.episodeNumber}`}
                                  onPlay={playEpisodeFromPlayer}
                                />
                              );
                            })}
                          </div>
                        )}

                        {!seasonsLoading && activeSeason && activeEpisodes.length === 0 && episodesLoadingSeason === selectedSeasonIndex && (
                          <div className="episodes-fetching">
                            <div className="seasons-loading-bar" />
                            <p>Fetching episodes from TMDB...</p>
                          </div>
                        )}

                        {!seasonsLoading && activeSeason && activeEpisodes.length === 0 && episodesLoadingSeason !== selectedSeasonIndex && seasons.length > 0 && (
                          <div className="episodes-fetching">
                            <p>Select a season to load episodes.</p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            );
          })() : activeTab === "favorites" ? (
            <motion.section
              key="favorites"
              className="favorites-page"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="page-title">
                <p>Saved library</p>
                <h1>My List</h1>
              </div>
              {favorites.length === 0 ? (
                <div className="empty-state">
                  <h2>Your list is empty</h2>
                  <p>Save a title from the catalog and it will appear here.</p>
                  <button className="primary-btn" onClick={() => setActiveTab("browse")}>Browse catalog</button>
                </div>
              ) : (
                <div className="poster-grid">
                  {favorites.map((movie) => (
                    <PosterCard
                      key={movie.id}
                      movie={movie}
                      isFavorite={true}
                      onOpenDetails={() => openDetails(movie)}
                      onToggleFavorite={(e) => toggleWatchList(movie.id, e)}
                    />
                  ))}
                </div>
              )}
            </motion.section>
          ) : (
            <motion.div
              key="browse"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              {featured && (
                <section
                  className="hero-panel branded-hero"
                  aria-live="polite"
                  onMouseEnter={() => setIsHeroPaused(true)}
                  onMouseLeave={() => setIsHeroPaused(false)}
                >
                  <img
                    key={`hero-backdrop-${heroIndex}`}
                    className="hero-backdrop"
                    src={featured.backdropUrl || IMAGE_FALLBACK}
                    alt={`${featured.title} backdrop`}
                    fetchPriority="high"
                    decoding="async"
                    onError={handleImageError}
                  />
                  <div className="hero-vignette" />
                  <div className="hero-inner">
                    <div key={`hero-copy-${heroIndex}`} className="hero-copy">
                      <span className="eyebrow">Featured Now</span>
                      <h1>{featured.title}</h1>
                      <div className="meta-line">
                        <span>{featured.rating}</span>
                        <span>{featured.year}</span>
                        <span>{typeLabel(featured.type)}</span>
                        <span>{featured.genres.slice(0, 2).join(" / ")}</span>
                      </div>
                      <p>{featured.description}</p>
                      <div className="hero-actions">
                        <button className="primary-btn clickable" onClick={() => startPlayback(featured)}>
                          <Play size={18} fill="currentColor" /> Play
                        </button>
                        <button className="ghost-btn clickable" onClick={() => openDetails(featured)}>Details</button>
                        <button className="secondary-btn clickable" onClick={(e) => toggleWatchList(featured.id, e)}>
                          <Heart size={18} strokeWidth={2} />
                          {watchList.includes(featured.id) ? "Saved" : "My List"}
                        </button>
                      </div>
                      <div className="tmdb-status-badge">
                        {catalogStatus === "refreshing" && (
                          <>
                            <div className="tmdb-status-dot refreshing" />
                            <span>Refreshing TMDB catalog...</span>
                          </>
                        )}
                        {catalogStatus === "refreshed" && (
                          <>
                            <div className="tmdb-status-dot success" />
                            <span>Catalog active · {catalog.length} titles</span>
                          </>
                        )}
                        {catalogStatus === "failed" && (
                          <>
                            <div className="tmdb-status-dot error" />
                            <span>TMDB refresh failed</span>
                          </>
                        )}
                        {catalogStatus === "fallback" && (
                          <>
                            <div className="tmdb-status-dot" />
                            <span>Local offline catalog active</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {catalog.length === 0 && (
                <section className="media-section">
                  <div className="empty-state">
                    <AlertTriangle size={34} />
                    <h2>No titles available</h2>
                    <p>Try refreshing the catalog or check your connection.</p>
                    <button className="primary-btn clickable" onClick={() => refreshCatalog()} disabled={catalogStatus === "refreshing"}>
                      <RefreshCw size={17} /> {catalogStatus === "refreshing" ? "Refreshing..." : "Refresh catalog"}
                    </button>
                  </div>
                </section>
              )}

              {isTmdbLoading && <SkeletonRow title="Refreshing TMDB details" />}

              <div className="filter-groups">
                <div className="filter-strip genre-strip" aria-label="Genre filters">
                  {genresList.map((genre) => (
                    <button
                      key={genre}
                      className={selectedGenre === genre ? "active" : ""}
                      onClick={() => setSelectedGenre(genre)}
                    >
                      {genre}
                    </button>
                  ))}
                </div>
                <div className="advanced-filters" aria-label="Advanced search filters">
                  <button 
                    className="advanced-search-toggle clickable" 
                    onClick={() => setIsAdvancedSearchOpen(!isAdvancedSearchOpen)}
                  >
                    <SlidersHorizontal size={15} /> Advanced Search 
                    {isAdvancedSearchOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                  
                  {isAdvancedSearchOpen && (
                    <>
                      <div className="filter-select-wrapper">
                        <Film size={14} />
                        <select value={selectedType} onChange={(e) => setSelectedType(e.target.value)} aria-label="Filter by media type">
                          <option value="all">All types</option>
                          <option value="movie">Movies</option>
                          <option value="series">TV Shows</option>
                        </select>
                      </div>
                      <div className="filter-select-wrapper">
                        <Calendar size={14} />
                        <select value={selectedYearRange} onChange={(e) => setSelectedYearRange(e.target.value)} aria-label="Filter by year">
                          <option value="all">Any year</option>
                          <option value="2020s">2020s</option>
                          <option value="2010s">2010s</option>
                          <option value="older">Before 2010</option>
                        </select>
                      </div>
                      <div className="filter-select-wrapper">
                        <Star size={14} />
                        <select value={selectedRating} onChange={(e) => setSelectedRating(e.target.value)} aria-label="Filter by minimum rating">
                          <option value="all">Any rating</option>
                          <option value="9">9.0+</option>
                          <option value="8.5">8.5+</option>
                          <option value="8">8.0+</option>
                        </select>
                      </div>
                    </>
                  )}
                  <button className="ghost-btn clickable filter-reset-btn" onClick={resetAllFilters}>
                    Reset
                    {filterActiveCount > 0 && <span className="filter-reset-badge">{filterActiveCount}</span>}
                  </button>
                </div>
                {recentSearches.length > 0 && (
                  <div className="recent-searches" aria-label="Recent searches">
                    <span>Recent</span>
                    {recentSearches.map((term) => (
                      <button key={term} className="clickable" onClick={() => applyRecentSearch(term)}>{term}</button>
                    ))}
                  </div>
                )}
              </div>

              {searchTerm || selectedGenre !== "All" || selectedType !== "all" || selectedYearRange !== "all" || selectedRating !== "all" ? (
                <section className="media-section" key="browse-search" ref={searchResultsRef}>
                  <div className="section-heading">
                    <h2>Browse Results</h2>
                    <span>{combinedResults.length} titles{isTmdbSearching ? " · Searching TMDB..." : ""}</span>
                  </div>
                  {isTmdbSearching && <div className="tmdb-search-loading" />}
                  <div className="search-results-grid">
                    {combinedResults.map((movie) => (
                      <SearchResultCard
                        key={movie.id}
                        movie={movie}
                        isFavorite={watchList.includes(movie.id)}
                        onOpenDetails={() => openDetails(movie)}
                        onToggleFavorite={(e) => toggleWatchList(movie.id, e)}
                      />
                    ))}
                  </div>
                  {combinedResults.length === 0 && !isTmdbSearching && (
                    <div className="empty-state compact-empty">
                      <h2>No titles found</h2>
                      <p>{hasTmdbCredentials
                        ? "Try a different search term or clearing the filters. TMDB search completed but no matches were found."
                        : "Try clearing search or changing the vibe and genre filters. Add TMDB credentials to enable live remote search."}</p>
                      <button className="primary-btn" onClick={resetAllFilters}>Reset filters</button>
                    </div>
                  )}
                </section>
              ) : (
                <div className="browse-rows" key="browse-rows">
                  {mostPopular.length > 0 && (
                    <div className="category-group">
                      <div className="category-group-heading">
                        <h2>Trending</h2>
                        <span>What's popular right now</span>
                      </div>
                      <ErrorBoundary fallback="Most Popular">
                        <MediaRow title="Most Popular" items={mostPopular} watchList={watchList} onOpenDetails={openDetails} onToggleFavorite={toggleWatchList} />
                      </ErrorBoundary>
                    </div>
                  )}

                  {topRated.length > 0 && (
                    <div className="category-group">
                      <div className="category-group-heading">
                        <h2>Top Rated</h2>
                        <span>Highest rated movies</span>
                      </div>
                      <ErrorBoundary fallback="Top Rated">
                        <MediaRow title="Top Rated" items={topRated} watchList={watchList} onOpenDetails={openDetails} onToggleFavorite={toggleWatchList} />
                      </ErrorBoundary>
                    </div>
                  )}

                  {newReleases.length > 0 && (
                    <div className="category-group">
                      <div className="category-group-heading">
                        <h2>New Releases</h2>
                        <span>Last 30 days</span>
                      </div>
                      <ErrorBoundary fallback="New Releases">
                        <MediaRow title="New Releases" items={newReleases} watchList={watchList} onOpenDetails={openDetails} onToggleFavorite={toggleWatchList} />
                      </ErrorBoundary>
                    </div>
                  )}

                  {comingSoon.length > 0 && (
                    <div className="category-group">
                      <div className="category-group-heading">
                        <h2>Coming Soon</h2>
                        <span>Upcoming releases</span>
                      </div>
                      <ErrorBoundary fallback="Coming Soon">
                        <MediaRow title="Coming Soon" items={comingSoon} watchList={watchList} onOpenDetails={openDetails} onToggleFavorite={toggleWatchList} />
                      </ErrorBoundary>
                    </div>
                  )}

                  {(bollywood.length > 0 || mollywood.length > 0) && (
                    <div className="category-group">
                      <div className="category-group-heading">
                        <h2>Regional</h2>
                        <span>Bollywood & Mollywood</span>
                      </div>
                      {bollywood.length > 0 && (
                        <ErrorBoundary fallback="Bollywood">
                          <MediaRow title="Bollywood" items={bollywood} watchList={watchList} onOpenDetails={openDetails} onToggleFavorite={toggleWatchList} />
                        </ErrorBoundary>
                      )}
                      {mollywood.length > 0 && (
                        <ErrorBoundary fallback="Mollywood">
                          <MediaRow title="Mollywood" items={mollywood} watchList={watchList} onOpenDetails={openDetails} onToggleFavorite={toggleWatchList} />
                        </ErrorBoundary>
                      )}
                    </div>
                  )}

                  {anime.length > 0 && (
                    <div className="category-group">
                      <div className="category-group-heading">
                        <h2>Anime</h2>
                        <span>Animated series & films</span>
                      </div>
                      <ErrorBoundary fallback="Anime">
                        <MediaRow title="Anime" items={anime} watchList={watchList} onOpenDetails={openDetails} onToggleFavorite={toggleWatchList} />
                      </ErrorBoundary>
                    </div>
                  )}

                  {categoriesLoading && (
                    <SkeletonRow title="Loading category data" />
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {toast && (
        <div className={`app-toast app-toast-${toast.variant}`} role="status" aria-live="polite">
          {toast.variant === "error"
            ? <AlertTriangle size={16} />
            : toast.variant === "success"
              ? <CheckCircle2 size={16} />
              : toast.variant === "loading"
                ? <Loader2 className="spin" size={16} />
                : <Info size={16} />}
          <span>{toast.message}</span>
          <button className="app-toast-close" onClick={() => setToast(null)} aria-label="Dismiss notification">
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
