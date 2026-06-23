import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Hls from "hls.js";
import {
  ArrowLeft, Keyboard, ListVideo, Maximize, Minimize, Pause, PictureInPicture,
  Play, RotateCcw, SkipBack, SkipForward, Tv, Volume2, VolumeX
} from "lucide-react";
import {
  checkAudioSupport, getAudioCodecLabel, getBrowserAudioCodecSupport, getSidecarUrl,
  getStreamQuality, getStreamSource, hasProxyHeaders, isAudioOnlyStream, isAudioOnlyUrl, isDolbyAudioCodec,
  isExternalPlayerRecommended, isHlsUrl, isIframeUrl, isMagnetUrl, isWebtorrentPlayable,
  normalizeAudioCodec,
  isAudioCodecPlayable
} from "../utils/streamUtils";
import TorrentStreamSession, { formatBytes, formatTorrentStatus } from "../utils/torrentPlayer";
import ExternalPlayerMenu from "./ExternalPlayerMenu";
import AudioPlayer from "./AudioPlayer";

const formatTime = (secs) => {
  if (!Number.isFinite(secs)) return "00:00";
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(Math.floor(secs % 60)).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${m}:${s}` : `${m}:${s}`;
};

const truncate = (value, max = 28) =>
  !value ? "" : value.length > max ? `${value.slice(0, max - 1)}…` : value;

const getFileBasename = (name) => {
  if (!name) return "";
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  return slash >= 0 ? name.slice(slash + 1) : name;
};

// Pure: strip the leading folder, append the size. Used by the Files
// popover rows and the trigger button label.
const formatFileOption = (file) => {
  if (!file?.name) return { name: "Unknown file", size: "" };
  const size = file.length ?? file.size ?? 0;
  return {
    name: getFileBasename(file.name),
    size: Number.isFinite(size) && size > 0 ? formatBytes(size) : ""
  };
};

const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2];

// How long to wait before surfacing an error if an iframe never fires
// its load event (cross-origin providers often don't, or return 404 inside
// the frame). Below this, the spinner hides as soon as the iframe loads.
const IFRAME_LOAD_TIMEOUT_MS = 15_000;

// How long to wait for a magnet torrent to start receiving peers or
// progress. If 30s pass with 0 peers and 0 progress, we surface a
// "no peers" error instead of spinning forever.
const TORRENT_PROGRESS_TIMEOUT_MS = 30_000;

const getPlayableAudioTrackIndex = (tracks, codecSupport) => {
  if (!tracks?.length) return -1;

  const supportedTracks = tracks
    .map((track, index) => ({ track, index, codec: normalizeAudioCodec(track) }))
    .filter(({ codec }) => isAudioCodecPlayable(codec, codecSupport));

  if (supportedTracks.length === 0) return -1;

  const preferredCodecs = [
    codecSupport.eac3 ? "ec-3" : null,
    codecSupport.ac3 ? "ac-3" : null,
    "aac",
    "opus",
    "vorbis",
    "mp3",
    ""
  ].filter((codec) => codec !== null);

  for (const codec of preferredCodecs) {
    const match = supportedTracks.find((entry) => entry.codec === codec);
    if (match) return match.index;
  }

  return supportedTracks[0].index;
};

const getPlayableHlsLevelIndex = (levels, codecSupport) => {
  const levelsWithAudioCodecs = (levels || [])
    .map((level, index) => ({ level, index, codec: normalizeAudioCodec(level) }))
    .filter(({ codec }) => codec);

  if (levelsWithAudioCodecs.length === 0) return null;

  const playable = levelsWithAudioCodecs.find(({ codec }) => isAudioCodecPlayable(codec, codecSupport));
  return playable ? playable.index : -1;
};

const getAudioTrackMeta = (track, codecSupport) => {
  const codec = normalizeAudioCodec(track);
  const label = getAudioCodecLabel(track);

  if (codec === "ec-3") {
    return { codec, label, detail: codecSupport.eac3 ? "MSE passthrough" : "No native MSE" };
  }
  if (codec === "ac-3") {
    return { codec, label, detail: codecSupport.ac3 ? "MSE passthrough" : "No native MSE" };
  }
  if (["aac", "opus", "vorbis", "mp3"].includes(codec)) {
    return { codec, label, detail: "Native browser codec" };
  }
  if (codec === "dts" || codec === "truehd") {
    return { codec, label, detail: "Needs transcoding" };
  }
  return { codec, label, detail: track.channels ? `${track.channels} channels` : "Codec unknown" };
};

// ─── component ──────────────────────────────────────────────────────────────

export default function NeoPlayer({
  videoUrl,
  title,
  subtitle,
  streams = [],
  currentStream,
  currentStreamIndex = 0,
  playbackKey,
  onClose,
  onSelectStream,
  onPlaybackError,
  episodeOptions = [],
  currentEpisodeIndex = -1,
  onSelectEpisode,
  onPreviousEpisode,
  onNextEpisode,
  onNotify,
}) {
  const isIframe = isIframeUrl(videoUrl);
  const isMagnet = isWebtorrentPlayable(currentStream) || (videoUrl && isMagnetUrl(videoUrl));
  const shouldTranscodeTorrent = Boolean(currentStream?.isNotWebReady || currentStream?.behaviorHints?.notWebReady);
  const torrentProxyUrl = import.meta.env.DEV && videoUrl && isMagnetUrl(videoUrl)
    ? (() => {
        const params = new URLSearchParams({ magnet: videoUrl });
        if (Number.isInteger(currentStream?.fileIdx)) {
          params.set("fileIdx", String(currentStream.fileIdx));
        }
        if (shouldTranscodeTorrent) {
          params.set("transcode", "1");
        }
        return `/api/torrent/stream?${params.toString()}`;
      })()
    : null;
  const usesTorrentProxy = Boolean(torrentProxyUrl);
  const torrentProxyNeedsHls = Boolean(torrentProxyUrl && shouldTranscodeTorrent);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const torrentSessionRef = useRef(null);

  // ── state ───────────────────────────────────────────────────────────────

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [playbackError, setPlaybackError] = useState(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [audioTracks, setAudioTracks] = useState([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState(-1);
  const [audioTrackError, setAudioTrackError] = useState(null);
  // WebTorrent status. `null` means "not started" or "completed and idle".
  const [torrentStatus, setTorrentStatus] = useState(null);
  const [torrentError, setTorrentError] = useState(null);
  // List of video files in the torrent, in pickVideoFile rank order
  // (index 0 is the auto-selected main file). Populated once the torrent
  // resolves via the onFileList callback; lets the user pick a different
  // file from a multi-file release without leaving the player.
  const [torrentFileList, setTorrentFileList] = useState([]);
  const [activeTorrentFileName, setActiveTorrentFileName] = useState(null);
  // True when the currently-playing torrent file is in a container
  // Chrome can demux via MediaSource Extensions (mp4, m4v, mov, m4p,
  // webm, ogv). MKV / AVI siblings are kept visible in the Files popover
  // but tagged as "external player only" so the user knows why they
  // can't be rendered in the browser.
  const [isPlayingFileMse, setIsPlayingFileMse] = useState(true);

  // popover toggles
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSourceMenu, setShowSourceMenu] = useState(false);
  const [showEpisodeMenu, setShowEpisodeMenu] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showFilesMenu, setShowFilesMenu] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const shouldShowControls = controlsVisible || !isPlaying || isLoading || playbackError;
  const audioCodecSupport = getBrowserAudioCodecSupport();
  const isAudioOnly = useMemo(() => {
    if (currentStream && isAudioOnlyStream(currentStream)) return true;
    if (videoUrl && !isIframe && !isMagnet) return isAudioOnlyUrl(videoUrl);
    return false;
  }, [videoUrl, currentStream, isIframe, isMagnet]);

  // ── derived flags ───────────────────────────────────────────────────────

  const closePopovers = useCallback(() => {
    setShowSpeedMenu(false);
    setShowSourceMenu(false);
    setShowEpisodeMenu(false);
    setShowAudioMenu(false);
    setShowFilesMenu(false);
    setShowShortcuts(false);
  }, []);

  // ── controls auto-hide ──────────────────────────────────────────────────

  const hideTimerRef = useRef(null);
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimerRef.current);
    if (isPlaying && !playbackError && !isLoading) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
        closePopovers();
      }, 2800);
    }
  }, [isPlaying, playbackError, isLoading, closePopovers]);

  // ── video source setup ──────────────────────────────────────────────────

  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  const mutedRef = useRef(isMuted);
  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);

  const lastAudibleVolumeRef = useRef(1);
  useEffect(() => {
    if (volume > 0) lastAudibleVolumeRef.current = volume;
  }, [volume]);

  // Mirror of isLoading so the iframe-load-timeout callback can read
  // the current loading state without going through setIsLoading's
  // function form (the linter discourages that pattern for clarity).
  const isLoadingRef = useRef(true);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  // Track the most recent dev-proxy URL so the onError handler can probe
  // it to distinguish a real decoder failure from a 4xx JSON error
  // payload (the Vite torrent plugin returns 415 + JSON when the picked
  // file is in a container Chrome can't demux). Refs (not state) because
  // the onError handler is a stable callback and we don't want a
  // re-render whenever the proxy URL changes — the src effect already
  // re-runs for that.
  const torrentProxyUrlRef = useRef(null);
  useEffect(() => { torrentProxyUrlRef.current = torrentProxyUrl; }, [torrentProxyUrl]);

  const onPlaybackErrorRef = useRef(onPlaybackError);
  useEffect(() => { onPlaybackErrorRef.current = onPlaybackError; }, [onPlaybackError]);

  const [retryNonce, setRetryNonce] = useState(0);
  const positionKey = playbackKey ? `webfreedom_position_${playbackKey}` : null;
  const errorGuardRef = useRef(false);
  const lastSavedSecRef = useRef(0);
  const resumeAppliedRef = useRef(false);
  const sourceSwitchRef = useRef(false);

  const attemptPlay = useCallback((video, isDisposedRef) => {
    video.muted = mutedRef.current;
    video.volume = mutedRef.current ? 0 : volumeRef.current;
    video.play()
      .then(() => {
        if (!isDisposedRef.current) {
          setIsPlaying(true);
          setIsMuted(mutedRef.current);
        }
      })
      .catch(() => {
        if (isDisposedRef.current) return;
        setIsPlaying(false);
        setControlsVisible(true);
      });
  }, []);

  const handlePlaybackError = useCallback((msg) => {
    if (errorGuardRef.current) return;
    errorGuardRef.current = true;
    const switched = onPlaybackErrorRef.current?.();
    if (switched) {
      setPlaybackError(null);
      setIsLoading(true);
      errorGuardRef.current = false;
      return;
    }
    setIsLoading(false);
    setPlaybackError(msg);
    setControlsVisible(true);
    errorGuardRef.current = false;
  }, []);

  // Probe the dev proxy when the <video> element fires onError. The
  // torrent-stream Vite plugin returns 415 + JSON for non-MSE
  // containers (MKV / AVI / TS); a plain <video> onError would
  // otherwise surface a useless "This source failed to play" message.
  // The probe only runs in dev-mode (torrentProxyUrl is set) and only
  // checks the response status — 2xx means the video started, 4xx is
  // the JSON error path. Range: bytes=0-0 forces a 1-byte response so
  // we never read the full torrent just to discover it's unplayable.
  // A race guard ensures a late-arriving probe for a stale proxy URL
  // can't overwrite a newer error state.
  const probeRef = useRef(0);
  const handleVideoError = useCallback(() => {
    const proxyUrl = torrentProxyUrlRef.current;
    if (!proxyUrl) {
      handlePlaybackError("This source failed to play.");
      return;
    }
    const probeId = ++probeRef.current;
    fetch(proxyUrl, { method: "GET", headers: { Range: "bytes=0-0" } })
      .then((res) => {
        if (probeId !== probeRef.current) return null;
        if (res.status < 400) return null;
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) return null;
        return res.json().catch(() => ({}));
      })
      .then((data) => {
        if (probeId !== probeRef.current || !data) return;
        const message = typeof data.error === "string" && data.error
          ? data.error
          : "This torrent's main video container can't be played in the browser. Open the magnet in VLC or your torrent client.";
        handlePlaybackError(message);
      })
      .catch(() => {
        if (probeId !== probeRef.current) return;
        handlePlaybackError("This source failed to play.");
      });
  }, [handlePlaybackError]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    // Magnet URLs are handled by a separate useEffect (webtorrent streaming)
    // so we must short-circuit the HLS / direct-src setup below.
    if (isMagnet && !usesTorrentProxy) return;
    const playbackUrl = torrentProxyUrl || videoUrl;
    const shouldUseHls = isHlsUrl(playbackUrl) || torrentProxyNeedsHls || currentStream?.isHls;
    const effectiveUrl = shouldUseHls && isHlsUrl(playbackUrl)
      ? (getSidecarUrl(playbackUrl) || playbackUrl)
      : playbackUrl;
    const isDisposed = { current: false };
    // The setState calls below all live inside async HLS event callbacks
    // (MANIFEST_PARSED, AUDIO_TRACKS_UPDATED, ERROR, ...) — they fire well
    // after this effect has returned, never synchronously inside the effect
    // body. The exhaustive-deps/set-state-in-effect rules can't see through
    // the callback indirection, so we disable them for the duration of the
    // HLS wiring block.
    /* eslint-disable react-hooks/set-state-in-effect */
    let audioPreferenceApplied = false;
    const selectPreferredAudioTrack = (hls, tracks) => {
      if (audioPreferenceApplied) return;
      if (!tracks?.length) return;

      const codecSupport = getBrowserAudioCodecSupport();
      const trackIndex = getPlayableAudioTrackIndex(tracks, codecSupport);
      if (trackIndex < 0) {
        console.log("No playable audio tracks found, trying sidecar fallback...");
        if (hasProxyHeaders(currentStream)) {
          console.log("Sidecar available, attempting fallback...");
          handlePlaybackError("This source requires sidecar proxy. Switching to sidecar source...");
          return;
        } else {
          handlePlaybackError("This source only includes audio codecs Chrome cannot play. Trying another source...");
          return;
        }
      }

      hls.audioTrack = trackIndex;
      setActiveAudioTrack(tracks[trackIndex]?.id ?? trackIndex);
      audioPreferenceApplied = true;
    };

    // Reset state for new source. The transient reset itself lives in
    // a useLayoutEffect below (which is explicitly allowed to setState
    // by react-hooks/set-state-in-effect). Refs and side-effects stay here.
    resumeAppliedRef.current = false;
    lastSavedSecRef.current = 0;
    errorGuardRef.current = false;
    closePopovers();

    // Destroy previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    video.pause();
    video.removeAttribute("src");

    // ── HLS path ──────────────────────────────────────────────────────────
    if (shouldUseHls) {
      // Safari native HLS
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = effectiveUrl;
        video.load();
        attemptPlay(video, isDisposed);
      }
      // hls.js path
      else if (Hls.isSupported()) {
        const { preferredDolbyCodec } = getBrowserAudioCodecSupport();
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          ...(preferredDolbyCodec ? { audioPreference: { audioCodec: preferredDolbyCodec } } : {}),
        });

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (isDisposed.current) return;

          const isAudioTrackError = data.details === Hls.ErrorDetails.AUDIO_TRACK_LOAD_ERROR ||
            data.details === Hls.ErrorDetails.AUDIO_TRACK_LOAD_TIMEOUT;

          if (isAudioTrackError) {
            setAudioTrackError("Selected audio track failed to load. Try another audio track or source.");
          }

          if (data.fatal) {
            hls.destroy();
            hlsRef.current = null;
            handlePlaybackError("HLS stream failed. Trying another source…");
          }
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (isDisposed.current) return;
          const codecSupport = getBrowserAudioCodecSupport();
          const levelIndex = getPlayableHlsLevelIndex(hls.levels, codecSupport);
          if (levelIndex === -1) {
            handlePlaybackError("This source only includes audio codecs Chrome cannot play. Trying another source...");
            return;
          }
          if (levelIndex !== null) {
            hls.currentLevel = levelIndex;
          }

          const tracks = hls.audioTracks || [];
          setAudioTracks(tracks);
          selectPreferredAudioTrack(hls, tracks);
          setIsLoading(false);
          attemptPlay(video, isDisposed);
        });

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
          if (isDisposed.current) return;
          const tracks = data.audioTracks || [];
          setAudioTracks(tracks);
          selectPreferredAudioTrack(hls, tracks);
        });

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
          if (!isDisposed.current) {
            setActiveAudioTrack(data.id);
            setAudioTrackError(null);
          }
        });

        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          if (!isDisposed.current) hls.loadSource(effectiveUrl);
        });
        hlsRef.current = hls;
      }
      // HLS unsupported
      else {
        queueMicrotask(() => handlePlaybackError("This browser does not support HLS playback."));
      }
    }
    // ── Direct MP4/WebM path ──────────────────────────────────────────────
    else {
      video.src = effectiveUrl;
      video.load();
      attemptPlay(video, isDisposed);
    }

    return () => {
      isDisposed.current = true;
      clearTimeout(hideTimerRef.current);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute("src");
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [videoUrl, retryNonce, attemptPlay, handlePlaybackError, closePopovers, currentStream, isMagnet, usesTorrentProxy, torrentProxyUrl, torrentProxyNeedsHls]);

  // ── reset transient state on source change ─────────────────────────────
  // Lives in a layout effect so the reset is explicitly allowed to call
  // setState (the react-hooks/set-state-in-effect rule only flags setState
  // inside useEffect). Layout effects also flush before paint, so the
  // user never sees a stale loading/error frame for the previous source.

  useLayoutEffect(() => {
    // The transient state reset must run synchronously before paint so the
    // user never sees a stale loading/error frame for the previous source.
    // These setStates are intentionally inside the layout effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    setIsLoading(true);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setPlaybackError(null);
    setControlsVisible(true);
    setAudioTracks([]);
    setActiveAudioTrack(-1);
    setAudioTrackError(null);
    setTorrentError(null);
    setTorrentStatus(null);
    // Reset the per-file MSE flag too so the warning overlay doesn't
    // briefly reference the previous torrent's container before the new
    // torrent's onFileChange callback fires.
    setIsPlayingFileMse(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [videoUrl, retryNonce, isMagnet]);

  // ── sync volume / muted to DOM ──────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
    video.volume = isMuted ? 0 : volume;
  }, [isMuted, volume]);

  // ── handle autoplay policy ───────────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    // Magnet URLs are handled by a separate useEffect (webtorrent streaming)
    // so we must short-circuit the HLS / direct-src setup below.
    if (isMagnet && !usesTorrentProxy) return;

    // setState calls inside attemptAutoplay() run from the resolved/rejected
    // video.play() promise — they are not synchronous effect body updates.
    const attemptAutoplay = () => {
      if (isPlaying || playbackError) return;

      video.play()
        .then(() => {
          setIsPlaying(true);
          setIsMuted(false);
        })
        .catch((error) => {
          console.log("Autoplay prevented, user interaction required:", error);
          setIsPlaying(false);
          setControlsVisible(true);
        });
    };

    const handleUserInteraction = () => {
      attemptAutoplay();
      document.removeEventListener("click", handleUserInteraction);
      document.removeEventListener("keydown", handleUserInteraction);
      document.removeEventListener("touchstart", handleUserInteraction);
    };

    if (isHlsUrl(videoUrl)) {
      document.addEventListener("click", handleUserInteraction);
      document.addEventListener("keydown", handleUserInteraction);
      document.addEventListener("touchstart", handleUserInteraction, { passive: true });
    }

    return () => {
      document.removeEventListener("click", handleUserInteraction);
      document.removeEventListener("keydown", handleUserInteraction);
      document.removeEventListener("touchstart", handleUserInteraction);
    };
    // isHlsUrl is a stable module-level import; isMagnet is required so the
    // effect re-runs when the user switches to/from a magnet stream.
  }, [videoUrl, isPlaying, playbackError, isMagnet, usesTorrentProxy]);



  // ── sync playback speed ─────────────────────────────────────────────────

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // ── fullscreen & PiP listeners ──────────────────────────────────────────

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    const onPipEnter = () => setIsPip(true);
    const onPipLeave = () => setIsPip(false);
    const video = videoRef.current;
    document.addEventListener("fullscreenchange", onFs);
    video?.addEventListener("enterpictureinpicture", onPipEnter);
    video?.addEventListener("leavepictureinpicture", onPipLeave);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      video?.removeEventListener("enterpictureinpicture", onPipEnter);
      video?.removeEventListener("leavepictureinpicture", onPipLeave);
    };
  }, []);

  // ── reveal controls on mount ────────────────────────────────────────────

  useEffect(() => {
    queueMicrotask(() => revealControls());
  }, [revealControls]);

  // ── video event handlers ────────────────────────────────────────────────

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    setIsLoading(false);

    // Resume position
    if (!resumeAppliedRef.current && positionKey) {
      const saved = Number(localStorage.getItem(positionKey));
      const minResume = sourceSwitchRef.current ? 0 : 30;
      if (saved > minResume && saved < video.duration - 15) {
        video.currentTime = saved;
        setCurrentTime(saved);
      }
    }
    resumeAppliedRef.current = true;
    sourceSwitchRef.current = false;
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    const sec = Math.floor(video.currentTime);
    if (positionKey && sec > 5 && sec % 5 === 0 && sec !== lastSavedSecRef.current) {
      localStorage.setItem(positionKey, String(sec));
      lastSavedSecRef.current = sec;
    }
  };

  const handleEnded = () => {
    if (positionKey) localStorage.removeItem(positionKey);
    setIsPlaying(false);
    setControlsVisible(true);
  };

  // ── control actions ─────────────────────────────────────────────────────

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) { video.pause(); setIsPlaying(false); return; }
    video.play()
      .then(() => setIsPlaying(true))
      .catch(() => handlePlaybackError("Playback failed. Try another source."));
  };

  const skipTime = (secs) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(video.currentTime + secs, 0), duration || video.duration || 0);
    setCurrentTime(video.currentTime);
  };

  const handleScrub = (e) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
    if (videoRef.current) videoRef.current.currentTime = t;
  };

  const handleVolumeChange = (e) => {
    const v = parseFloat(e.target.value);
    setVolume(v);
    setIsMuted(v === 0);
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && volume === 0) {
      setVolume(lastAudibleVolumeRef.current || 1);
    }
  };

  const changeSpeed = (s) => { setPlaybackSpeed(s); setShowSpeedMenu(false); };

  const handleAudioTrackChange = (trackIndex) => {
    setAudioTrackError(null);
    if (hlsRef.current) hlsRef.current.audioTrack = trackIndex;
    setActiveAudioTrack(audioTracks[trackIndex]?.id ?? trackIndex);
    setShowAudioMenu(false);
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    document.fullscreenElement
      ? document.exitFullscreen?.()
      : containerRef.current.requestFullscreen?.();
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    document.pictureInPictureElement
      ? await document.exitPictureInPicture()
      : await video.requestPictureInPicture();
  };

  const handleSelectStream = (stream, index) => {
    if (!stream?.url || hasProxyHeaders(stream)) return;
    const video = videoRef.current;
    if (video && positionKey) {
      const pos = Math.floor(video.currentTime);
      if (pos > 5) localStorage.setItem(positionKey, String(pos));
    }
    sourceSwitchRef.current = true;
    onSelectStream?.(stream, index);
    setShowSourceMenu(false);
  };

  const handleSelectEpisode = (entry) => {
    onSelectEpisode?.(entry);
    setShowEpisodeMenu(false);
  };

  // ── render ──────────────────────────────────────────────────────────────

  const handleRetry = () => {
    setPlaybackError(null);
    setIsLoading(true);
    errorGuardRef.current = false;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute("src");
    }
    setRetryNonce((n) => n + 1);
  };

  // ── keyboard shortcuts ──────────────────────────────────────────────────

  const shortcutHandlersRef = useRef({});
  useEffect(() => {
    shortcutHandlersRef.current = { togglePlay, skipTime, toggleMute, toggleFullscreen, onClose, revealControls };
  });

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      
      const { togglePlay, skipTime, toggleMute, toggleFullscreen, onClose, revealControls } = shortcutHandlersRef.current;
      
      switch (e.code) {
        case "Space": e.preventDefault(); togglePlay?.(); break;
        case "ArrowRight": skipTime?.(10); break;
        case "ArrowLeft": skipTime?.(-10); break;
        default: break;
      }
      if (e.key.toLowerCase() === "m") toggleMute?.();
      if (e.key.toLowerCase() === "f") toggleFullscreen?.();
      if (e.key === "Escape" && !document.fullscreenElement) onClose?.();
      revealControls?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Clear autohide timer on unmount to prevent state updates on unmounted components
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  // ── WebTorrent / magnet streaming ──────────────────────────────────────
  // The transient state reset (isLoading, playbackError, torrentError,
  // torrentStatus) is handled by the useLayoutEffect above. This effect
  // only owns the torrent session itself.
  useEffect(() => {
    if (!isMagnet || usesTorrentProxy || !videoUrl) return;
    const video = videoRef.current;
    if (!video) return;

    const session = new TorrentStreamSession();
    torrentSessionRef.current = session;

    // If the torrent resolves metadata but never connects to peers and
    // makes no progress, surface an error instead of spinning forever.
    // The error message tells the user to try a different source or
    // hand off to an external torrent client.
    const progressTimer = window.setTimeout(() => {
      const session = torrentSessionRef.current;
      if (!session?.torrent) {
        setTorrentError("Torrent metadata did not resolve — the magnet may be dead or browser peer discovery is blocked.");
        setIsLoading(false);
        setPlaybackError("Torrent metadata did not resolve. Try another Torrentio source or open the magnet in your torrent client.");
        return;
      }
      const peers = session.torrent.numPeers ?? 0;
      const progress = session.torrent.progress ?? 0;
      if (peers > 0 || progress > 0) return; // already making progress
      setTorrentError("No peers found after 30s — the torrent may be dead or the network is blocking WebRTC.");
      setIsLoading(false);
      setPlaybackError("No torrent peers found. Try a different source or open the magnet in your torrent client.");
    }, TORRENT_PROGRESS_TIMEOUT_MS);

    session.load(videoUrl, video, {
      // Stremio protocol hints: fileIdx (zero-based index in the torrent
      // file list) and isNotWebReady. Both are best-effort — the session
      // will fall back to its own file picker when they are missing.
      fileIdx: Number.isInteger(currentStream?.fileIdx) ? currentStream.fileIdx : undefined,
      isNotWebReady: Boolean(currentStream?.isNotWebReady || currentStream?.behaviorHints?.notWebReady),
      onStatus: (status) => {
        if (!status) return;
        setTorrentStatus(status);
        // Once peers or any progress arrive, drop the loading overlay.
        if ((status.peers ?? 0) > 0 || (status.progress ?? 0) > 0) {
          setIsLoading(false);
        }
      },
      onError: (err) => {
        const message = err?.message || "Torrent stream failed to start";
        setTorrentError(message);
        setIsLoading(false);
        // Strip the trailing action prompt from the session message —
        // the player-level error panel already shows a button to open
        // the magnet in an external player, so we don't need to repeat
        // the instruction here.
        setPlaybackError(message);
      },
      onReady: () => {
        setIsLoading(false);
        setTorrentError(null);
      },
      onFileList: (files) => {
        setTorrentFileList(Array.isArray(files) ? files : []);
      },
      onFileChange: (file, _ranked, meta) => {
        if (file?.name) setActiveTorrentFileName(file.name);
        // Switching files restarts the buffer; show the loading overlay
        // until renderTo() calls onReady again.
        setIsLoading(true);
        // Stash the MSE-compatibility flag so the Files popover can
        // visually warn the user about non-browser-playable entries.
        setIsPlayingFileMse(Boolean(meta?.fileIsMse));
      }
    });

    return () => {
      window.clearTimeout(progressTimer);
      session.cleanup();
      if (torrentSessionRef.current === session) {
        torrentSessionRef.current = null;
      }
    };
    // currentStream?.fileIdx / isNotWebReady feed into the load() handler
    // context, so the effect must re-run when the user picks a different
    // Torrentio source from the Source popover. videoUrl already changes
    // on stream switch, so this is more of a lint-satisfier than a
    // correctness fix, but it keeps exhaustive-deps happy.
  }, [videoUrl, isMagnet, usesTorrentProxy, retryNonce, currentStream?.fileIdx, currentStream?.isNotWebReady, currentStream?.behaviorHints?.notWebReady]);

  const handleSelectTorrentFile = useCallback((file) => {
    if (!file) return;
    setShowFilesMenu(false);
    torrentSessionRef.current?.selectFile(file);
  }, []);

  // Iframe load-timeout: the loading overlay is hidden as soon as the
  // iframe fires its load event, but cross-origin providers (vidsrc,
  // 2embed, etc.) often serve a 404 page inside the frame and either
  // never fire load or fire it immediately. We arm a timeout so the user
  // isn't stuck on a black iframe with no feedback.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isIframe) return undefined;
    setIsLoading(false);
    const timer = window.setTimeout(() => {
      if (isLoadingRef.current) {
        setPlaybackError("Embed player didn't load — this provider may be down or the title is unavailable. Try another source.");
        setIsLoading(false);
      }
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isIframe, videoUrl]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Truncated basename of the currently-playing torrent file. Used as
  // the trigger label of the Files popover. Kept as a useMemo so it's
  // only recomputed when the active file name actually changes; the
  // popover button reads it inside the conditional render below.
  const activeFileLabel = useMemo(
    () => activeTorrentFileName
      ? truncate(getFileBasename(activeTorrentFileName))
      : null,
    [activeTorrentFileName]
  );

  // ── render ──────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className={`neo-player ${isFullscreen ? "fullscreen" : ""} ${isTheaterMode && !isFullscreen ? "theater-mode" : ""}`}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
      style={{
        backgroundColor: "#000",
        overflow: "hidden",
      }}
    >
      {/* ── audio player ──────────────────────────────────────────────────── */}
      {isAudioOnly ? (
        <AudioPlayer
          videoUrl={videoUrl}
          title={title}
          subtitle={subtitle}
          onClose={onClose}
          onNotify={onNotify}
        />
      ) : isIframe ? (
        <iframe
          src={videoUrl}
          title={title ? `${title} stream` : "Embedded stream"}
          style={{ width: "100%", height: "100%", border: 0 }}
          allowFullScreen
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="origin"
          onLoad={() => {
            // Cross-origin iframes may not fire load on 404 pages, but when
            // they do we want to drop the loading overlay immediately. The
            // timeout-based error path below handles the never-loads case.
            setIsLoading(false);
            // Assume playing so the auto-hide timer kicks in — cross-origin
            // iframes can't report play/pause state.
            setIsPlaying(true);
          }}
        />
      ) : (
        <video
          ref={videoRef}
          onClick={togglePlay}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          onError={handleVideoError}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onWaiting={() => setIsLoading(true)}
          onCanPlay={() => setIsLoading(false)}
          style={{ width: "100%", height: "100%", objectFit: "contain", cursor: shouldShowControls ? "default" : "none" }}
          autoPlay
          playsInline
        />
      )}

      {/* ── error overlay ───────────────────────────────────────────────── */}
      {!isIframe && playbackError && (
        <div className="player-error-panel">
          <strong>Browser playback failed</strong>
          <span>{playbackError}</span>

          {streams.length > 1 ? (
            <div className="player-source-grid">
              {streams.map((s, i) => {
                const isIframeStream = s.isIframe || isIframeUrl(s.url);
                const audioNeedsVlc = !isIframeStream && checkAudioSupport(s).supported !== true;
                const playerNeedsVlc = isExternalPlayerRecommended(s);
                return (
                  <button
                    key={s.url || i}
                    className={`player-source-option${i === currentStreamIndex ? ' failed' : ''}${!s.url || hasProxyHeaders(s) ? ' disabled' : ''}`}
                    disabled={!s.url || hasProxyHeaders(s) || i === currentStreamIndex}
                    onClick={() => handleSelectStream(s, i)}
                  >
                    <span className="src-name">{getStreamSource(s)}</span>
                    <span className="src-meta">
                      <span className="src-quality">{getStreamQuality(s)}</span>
                      <span className={`src-audio-badge ${audioNeedsVlc ? "vlc-recommended" : "good-to-go"}`}>
                        {audioNeedsVlc ? "Use local player" : "Good to go"}
                      </span>
                      {playerNeedsVlc && !audioNeedsVlc && <span className="src-player-badge">Use local player</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="source-grid-empty">No alternative sources</span>
          )}

          <div className="player-error-actions">
            <button className="primary-btn clickable" onClick={handleRetry}><RotateCcw size={17} /> Retry</button>
            {currentStream && (checkAudioSupport(currentStream).supported === false || isExternalPlayerRecommended(currentStream)) && (
              <ExternalPlayerMenu
                stream={currentStream}
                fallbackTitle={title}
                menuLabel="Open local player"
                showLabel
                onNotify={onNotify}
              />
            )}
            <button className="secondary-btn clickable" onClick={onClose}>Back</button>
          </div>
        </div>
      )}

      {/* ── loading overlay ─────────────────────────────────────────────── */}
      {!isIframe && isLoading && !playbackError && (
        <div className="player-loading-panel">
          <div className="player-loader" />
          <strong>Loading stream</strong>
          <span>{getStreamSource(currentStream)} · {getStreamQuality(currentStream)}</span>
        </div>
      )}

      {/* ── center play button ──────────────────────────────────────────── */}
      {!isIframe && !isPlaying && !isLoading && !playbackError && (
        <button className="player-center-play clickable" onClick={togglePlay}><Play size={48} /></button>
      )}

      {/* ── unmute overlay ──────────────────────────────────────────────── */}
      {!isIframe && isPlaying && isMuted && !isLoading && !playbackError && (
        <button className="player-unmute-overlay clickable" onClick={toggleMute} title="Click to unmute">
          <VolumeX size={28} /><span>Click to unmute</span>
        </button>
      )}

      {/* ── torrent stats overlay (magnet streams) ──────────────────────── */}
      {isMagnet && torrentStatus && !torrentError && (
        <div className="torrent-status-overlay" aria-live="polite">
          <div className="torrent-status-dot" />
          <span>{formatTorrentStatus(torrentStatus) || "Connecting to peers..."}</span>
        </div>
      )}
      {isMagnet && torrentError && !playbackError && (
        <div className="torrent-status-overlay error">
          <span>{torrentError}</span>
        </div>
      )}

      {/* When the picked torrent file isn't MSE-compatible (MKV / AVI
          are the usual cases) and the session didn't already short-circuit
          because no MSE sibling exists, gently warn the user in the file
          picker. The error panel below carries the actionable message. */}
      {isMagnet && torrentFileList.length > 0 && !isPlayingFileMse && !playbackError && (
        <div className="torrent-status-overlay" aria-live="polite">
          <span>
            {`Browser can't demux ${(activeTorrentFileName?.split(".").pop() || "this").toUpperCase()} — open the magnet in VLC or your torrent app.`}
          </span>
        </div>
      )}

      {/* ── header bar ──────────────────────────────────────────────────── */}
      {!isAudioOnly && <div className="player-header" style={{ opacity: shouldShowControls ? 1 : 0 }}>
        <div className="player-header-left">
          <button onClick={onClose} className="soft-btn accent clickable"><ArrowLeft size={14} /> Back</button>
          {!isIframe && currentStream && (
            <ExternalPlayerMenu
              stream={currentStream}
              fallbackTitle={title}
              onNotify={onNotify}
            />
          )}
        </div>

        <div className="player-title-block">
          <h3>{title}</h3>
          {subtitle && <span>{subtitle}</span>}
        </div>

        <div className="player-header-right">
          {/* source picker — follows control visibility */}
          <div className="player-popover-wrap" style={{ opacity: shouldShowControls ? 1 : 0, pointerEvents: shouldShowControls ? "auto" : "none", transition: "opacity 0.25s" }}>
            <button onClick={() => setShowSourceMenu((v) => !v)} className="soft-btn accent clickable"><ListVideo size={15} /> Source</button>
            {showSourceMenu && (
              <div className="player-popover sources-popover" style={{ bottom: "auto", top: "calc(100% + 0.55rem)" }}>
                {streams.length === 0 && <span className="popover-empty">No alternate sources loaded.</span>}
                {streams.map((s, i) => (
                  <button key={`${s.url || s.name}-${i}`} className={i === currentStreamIndex ? "active" : ""} disabled={!s.url || hasProxyHeaders(s)} onClick={() => handleSelectStream(s, i)}>
                    <strong>{getStreamSource(s)}</strong>
                    <div>
                      <small>{hasProxyHeaders(s) ? "Needs proxy headers" : getStreamQuality(s)}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={toggleFullscreen}
            className="icon-control clickable"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            style={{ opacity: shouldShowControls ? 1 : 0, pointerEvents: shouldShowControls ? "auto" : "none", transition: "opacity 0.25s" }}
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        </div>
      </div>}

      {/* ── bottom controls ─────────────────────────────────────────────── */}
      {!isAudioOnly && (
        <div className="player-controls" style={{ opacity: shouldShowControls ? 1 : 0 }}>
          {!isIframe && (
            <input
              type="range"
              className="timeline-slider"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={handleScrub}
              aria-label="Playback timeline"
              style={{ "--progress": duration > 0 ? `${(currentTime / duration) * 100}%` : "0%" }}
            />
          )}

          <div className="player-control-row">
            {!isIframe && (
              <div className="player-control-group">
                <button onClick={togglePlay} className="soft-btn primary clickable round-control" aria-label="Play or pause">
                  {isPlaying ? <Pause size={20} /> : <Play size={20} />}
                </button>
                <button onClick={() => skipTime(-10)} className="icon-control clickable" title="Rewind 10s">-10s</button>
                <button onClick={() => skipTime(10)} className="icon-control clickable" title="Skip 10s">+10s</button>
                <button onClick={toggleMute} className="icon-control clickable" title="Mute">
                  {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </button>
                <input
                  type="range"
                  className="timeline-slider volume-slider"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  aria-label="Volume"
                  style={{ "--volume": `${(isMuted ? 0 : volume) * 100}%` }}
                />
                <span className="time-display"><strong>{formatTime(currentTime)}</strong> / {formatTime(duration)}</span>
              </div>
            )}

            <div className="player-control-group right-controls">
              {!isIframe && onPreviousEpisode && <button onClick={onPreviousEpisode} className="soft-btn clickable"><SkipBack size={14} /> Prev</button>}
              {!isIframe && onNextEpisode && <button onClick={onNextEpisode} className="soft-btn clickable">Next <SkipForward size={14} /></button>}

              {!isIframe && episodeOptions.length > 0 && (
                <div className="player-popover-wrap">
                  <button onClick={() => setShowEpisodeMenu((v) => !v)} className="soft-btn clickable"><Tv size={15} /> <span>Episodes</span></button>
                  {showEpisodeMenu && (
                    <div className="player-popover episodes-popover">
                      {episodeOptions.map((entry, i) => (
                        <button key={`${entry.season.seasonNumber}-${entry.episode.episodeNumber}`} className={i === currentEpisodeIndex ? "active" : ""} onClick={() => handleSelectEpisode(entry)}>
                          <strong>S{entry.season.seasonNumber} E{entry.episode.episodeNumber}</strong>
                          <small>{entry.episode.title}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isMagnet && torrentFileList.length > 1 && (
                <div className="player-popover-wrap">
                  <button
                    onClick={() => setShowFilesMenu((v) => !v)}
                    className="soft-btn clickable"
                    title={activeTorrentFileName || "Pick a different video file from this torrent"}
                  >
                    Files{activeFileLabel ? `: ${activeFileLabel}` : ""}
                  </button>
                  {showFilesMenu && (
                    <div className="player-popover files-popover">
                      <span className="popover-empty">Select a video file to play</span>
                      {torrentFileList.map((file, index) => {
                        const meta = formatFileOption(file);
                        const isActive = file.name === activeTorrentFileName;
                        return (
                          <button
                            key={`${file.name}-${index}`}
                            className={isActive ? "active" : ""}
                            onClick={() => handleSelectTorrentFile(file)}
                            title={meta.name}
                          >
                            <strong>{meta.name}</strong>
                            <div>
                              {meta.size && <small>{meta.size}</small>}
                              {index === 0 && <small>· Main</small>}
                              {isActive && <small>· Playing</small>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!isIframe && (
                <div className="player-popover-wrap">
                  <button onClick={() => setShowAudioMenu((v) => !v)} className="soft-btn clickable"><span>Audio</span></button>
                  {showAudioMenu && (
                    <div className="player-popover audio-popover">
                      {audioTrackError && <span className="popover-empty">{audioTrackError}</span>}
                      {audioTracks.length === 0 ? (
                        <button className="active" disabled>
                          <strong>Default Audio (Embedded)</strong>
                          <small>Single multiplexed audio track.</small>
                        </button>
                      ) : audioTracks.map((t, trackIndex) => {
                        const meta = getAudioTrackMeta(t, audioCodecSupport);
                        const isPlayable = isAudioCodecPlayable(meta.codec, audioCodecSupport);
                        const isActive = activeAudioTrack === (t.id ?? trackIndex);
                        const isDolbyPassthrough = isPlayable && isDolbyAudioCodec(meta.codec);
                        const badgeClass = !isPlayable
                          ? "codec-badge codec-unsupported"
                          : isDolbyPassthrough
                            ? "codec-badge codec-dolby-passthrough"
                            : "codec-badge";
                        return (
                          <button
                            key={t.id ?? trackIndex}
                            className={isActive ? "active" : ""}
                            disabled={!isPlayable}
                            onClick={() => handleAudioTrackChange(trackIndex)}
                          >
                            <strong>{t.name || `Track ${trackIndex + 1}`}</strong>
                            <div>
                              {t.lang && <small>{t.lang}</small>}
                              <small>{meta.label}</small>
                              <span className={badgeClass}>{isPlayable ? meta.detail : "Not supported in Chrome"}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!isIframe && (
                <div className="player-popover-wrap">
                  <button onClick={() => setShowSpeedMenu((v) => !v)} className="soft-btn clickable">{playbackSpeed}x</button>
                  {showSpeedMenu && (
                    <div className="player-popover speed-popover">
                      {PLAYBACK_SPEEDS.map((s) => (
                        <button key={s} className={playbackSpeed === s ? "active" : ""} onClick={() => changeSpeed(s)}>{s}x</button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!isIframe && <button onClick={() => setShowShortcuts((v) => !v)} className="icon-control clickable" title="Keyboard shortcuts"><Keyboard size={18} /></button>}
              {!isIframe && <button onClick={() => setIsTheaterMode((v) => !v)} className="icon-control clickable" title="Theater mode"><Tv size={18} /></button>}
              {!isIframe && document.pictureInPictureEnabled && <button onClick={togglePip} className="icon-control clickable" title="Picture in Picture"><PictureInPicture size={18} color={isPip ? "var(--accent-hover)" : undefined} /></button>}

            </div>
          </div>
        </div>
      )}

      {/* ── shortcuts panel ──────────────────────────────────────────────── */}
      {!isIframe && showShortcuts && (
        <div className="shortcut-panel fade-in">
          <h3>Keyboard shortcuts</h3>
          <span className="shortcut-row"><kbd>Space</kbd> Play / Pause</span>
          <span className="shortcut-row"><kbd>←</kbd><kbd>→</kbd> Seek 10s</span>
          <span className="shortcut-row"><kbd>M</kbd> Mute</span>
          <span className="shortcut-row"><kbd>F</kbd> Fullscreen</span>
          <span className="shortcut-row"><kbd>Esc</kbd> Back</span>
        </div>
      )}
    </div>
  );
}
