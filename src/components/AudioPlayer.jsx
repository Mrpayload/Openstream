import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Pause, Play, RotateCcw, SkipForward,
  Volume2, VolumeX
} from "lucide-react";
import { getAudioFileFormat } from "../utils/streamUtils";
import { useSwipeDownDismiss } from "../hooks/useSwipeDownDismiss";

const formatTime = (secs) => {
  if (!Number.isFinite(secs)) return "00:00";
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, "0");
  const s = String(Math.floor(secs % 60)).padStart(2, "0");
  return h > 0 ? `${String(h).padStart(2, "0")}:${m}:${s}` : `${m}:${s}`;
};

const WAVE_BARS = 40;

export default function AudioPlayer({
  videoUrl,
  title,
  subtitle,
  onClose,
  onNotify,
}) {
  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const animFrameRef = useRef(null);
  const waveformCanvasRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState(null);
  const [waveformData, setWaveformData] = useState(() => new Uint8Array(WAVE_BARS).fill(128));

  const format = useMemo(() => getAudioFileFormat(videoUrl), [videoUrl]);

  // ── Web Audio API setup ────────────────────────────────────────────────

  const initAudioContext = useCallback(() => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    return ctx;
  }, []);

  const connectSource = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || sourceRef.current) return;
    try {
      const ctx = initAudioContext();
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyserRef.current);
      sourceRef.current = source;
    } catch { /* already connected or not supported */ }
  }, [initAudioContext]);

  // ── waveform animation loop ────────────────────────────────────────────

  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const analyser = analyserRef.current;
    if (!analyser) return;

    const freqData = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(freqData);
      const step = Math.max(1, Math.floor(freqData.length / WAVE_BARS));
      const bars = new Uint8Array(WAVE_BARS);
      for (let i = 0; i < WAVE_BARS; i++) {
        bars[i] = freqData[i * step] ?? 128;
      }
      setWaveformData(bars);
      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [isPlaying]);

  // ── audio element events ───────────────────────────────────────────────

  const handleTimeUpdate = useCallback(() => {
    const a = audioRef.current;
    if (a) setCurrentTime(a.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      setDuration(a.duration);
    }
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleError = useCallback(() => {
    setError("Failed to load audio");
    setIsPlaying(false);
    onNotify?.({ type: "error", message: "Audio playback failed" });
  }, [onNotify]);

  // ── controls ───────────────────────────────────────────────────────────

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    connectSource();
    if (a.paused) { a.play().catch(() => {}); setIsPlaying(true); }
    else { a.pause(); setIsPlaying(false); }
  }, [connectSource]);

  const skipTime = useCallback((delta) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + delta));
  }, []);

  const toggleMute = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.muted = !a.muted;
    setIsMuted(a.muted);
  }, []);

  const seek = useCallback((e) => {
    const a = audioRef.current;
    if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * duration;
  }, [duration]);

  // ── keyboard shortcuts ─────────────────────────────────────────────────

  const shortcutHandlersRef = useRef({});
  useEffect(() => {
    shortcutHandlersRef.current = { togglePlay, skipTime, toggleMute, onClose };
  });

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const { togglePlay, skipTime, toggleMute, onClose } = shortcutHandlersRef.current;
      switch (e.code) {
        case "Space": e.preventDefault(); togglePlay?.(); break;
        case "ArrowRight": skipTime?.(10); break;
        case "ArrowLeft": skipTime?.(-10); break;
        default: break;
      }
      if (e.key.toLowerCase() === "m") toggleMute?.();
      if (e.key === "Escape" && !document.fullscreenElement) onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── dismiss on swipe down ──────────────────────────────────────────────

  const { dragY, handlers: swipeHandlers } = useSwipeDownDismiss({
    onDismiss: onClose,
  });

  const swipeStyle = dragY ? { transform: `translateY(${dragY}px)` } : undefined;

  // ── render ─────────────────────────────────────────────────────────────

  return (
    <div className="audio-player" style={swipeStyle} {...swipeHandlers}>
      <audio
        ref={audioRef}
        src={videoUrl}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={handleError}
      />

      {/* header */}
      <div className="audio-player-header">
        <button className="audio-player-back" onClick={onClose} aria-label="Close player">
          <ArrowLeft size={20} />
        </button>
        <div className="audio-player-header-info">
          <span className="audio-info-badge">{format}</span>
          <span className="audio-player-title">{title || "Unknown"}</span>
        </div>
      </div>

      {/* album art / vinyl disc */}
      <div className="audio-player-art-container">
        <div className={`vinyl-disc ${isPlaying ? "vinyl-spinning" : ""}`}>
          <div className="vinyl-grooves" />
          <div className="vinyl-label">
            <div className="vinyl-label-text">{format}</div>
          </div>
        </div>
      </div>

      {/* track info */}
      <div className="audio-player-info">
        <div className="audio-player-info-title">{title || "Unknown"}</div>
        {subtitle && <div className="audio-player-info-subtitle">{subtitle}</div>}
      </div>

      {/* waveform */}
      <div className="audio-waveform-container">
        <canvas
          ref={waveformCanvasRef}
          className="audio-waveform-canvas"
          width={WAVE_BARS * 4}
          height={60}
          style={{ display: "none" }}
        />
        <div className="audio-waveform-bars" aria-hidden="true">
          {waveformData.map((val, i) => {
            const pct = Math.max(5, (val / 255) * 100);
            const isBefore = duration > 0 && (i / WAVE_BARS) < (currentTime / duration);
            return (
              <div
                key={i}
                className={`audio-waveform-bar ${isBefore ? "audio-waveform-bar-played" : ""}`}
                style={{ height: `${pct}%` }}
              />
            );
          })}
        </div>
      </div>

      {/* seek bar */}
      <div className="audio-player-seek-row">
        <span className="audio-player-time">{formatTime(currentTime)}</span>
        <div className="audio-player-seekbar" onClick={seek}>
          <div className="audio-player-seekbar-track">
            <div
              className="audio-player-seekbar-progress"
              style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
            />
            <div
              className="audio-player-seekbar-thumb"
              style={{ left: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
            />
          </div>
        </div>
        <span className="audio-player-time">{formatTime(duration)}</span>
      </div>

      {/* controls */}
      <div className="audio-player-controls">
        <button className="audio-player-btn" onClick={() => skipTime(-10)} aria-label="Rewind 10 seconds">
          <RotateCcw size={18} />
        </button>
        <button className="audio-player-btn audio-player-btn-main" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <Pause size={28} /> : <Play size={28} />}
        </button>
        <button className="audio-player-btn" onClick={() => skipTime(10)} aria-label="Forward 10 seconds">
          <SkipForward size={18} />
        </button>
      </div>

      {/* volume */}
      <div className="audio-player-volume">
        <button className="audio-player-btn audio-player-btn-sm" onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>
          {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={isMuted ? 0 : volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            if (audioRef.current) audioRef.current.volume = v;
            if (v > 0 && isMuted) { setIsMuted(false); if (audioRef.current) audioRef.current.muted = false; }
          }}
          className="audio-player-volume-slider"
          aria-label="Volume"
        />
      </div>

      {/* error state */}
      {error && (
        <div className="audio-player-error">
          <p>{error}</p>
          <button onClick={() => { setError(null); audioRef.current?.load(); }}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
