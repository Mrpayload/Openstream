import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Maximize, Minimize } from "lucide-react";
import Hls from "hls.js";
import { App } from '@capacitor/app';

const isDirectHlsUrl = (url) => {
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return url.toLowerCase().includes(".m3u8");
  }
};

export default function NeoPlayer({
  videoUrl,
  title,
  subtitle,
  onClose,
}) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeGateActive, setIframeGateActive] = useState(true);
  const [hlsReady, setHlsReady] = useState(false);
  const [hlsError, setHlsError] = useState(null);

  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const revealRafRef = useRef(0);
  const iframeGateTimerRef = useRef(null);

  const isDirect = useMemo(() => isDirectHlsUrl(videoUrl), [videoUrl]);

  useEffect(() => {
    if (!isDirect || !videoRef.current || !videoUrl) return;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setHlsReady(false);
    setHlsError(null);

    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(videoUrl);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.MANIFEST_PARSED, () => setHlsReady(true));
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setHlsError("HLS playback failed");
          console.warn("[NeoPlayer] HLS fatal error:", data);
        }
      });
    } else if (videoRef.current.canPlayType("application/vnd.apple.mpegurl")) {
      videoRef.current.src = videoUrl;
      setHlsReady(true);
    } else {
      setHlsError("HLS not supported in this browser");
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoUrl, isDirect]);

  useEffect(() => {
    queueMicrotask(() => setIframeGateActive(true));
    iframeGateTimerRef.current = setTimeout(() => setIframeGateActive(false), 3000);
    return () => clearTimeout(iframeGateTimerRef.current);
  }, [videoUrl]);

  const revealControls = useCallback(() => {
    if (revealRafRef.current) return;
    revealRafRef.current = requestAnimationFrame(() => {
      revealRafRef.current = 0;
      setControlsVisible(true);
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2800);
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleClose = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  useEffect(() => {
    let listener = null;
    const registerListener = async () => {
      try {
        listener = await App.addListener('backButton', () => {
          handleClose();
        });
      } catch (err) {
        console.warn('[NeoPlayer] Capacitor App plugin not available:', err);
      }
    };
    registerListener();

    return () => {
      if (listener) {
        listener.remove();
      }
    };
  }, [handleClose]);

  useEffect(() => {
    queueMicrotask(() => revealControls());
  }, [revealControls]);

  return (
    <div
      ref={containerRef}
      className={`neo-player${isFullscreen ? " fullscreen" : ""}`}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
      style={{ backgroundColor: "#000", overflow: "hidden" }}
    >

      {isDirect ? (
        <>
          <video
            ref={videoRef}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onClick={togglePlay}
            controls={false}
            playsInline
          />
          {!hlsReady && !hlsError && (
            <div
              style={{
                position: "absolute", inset: 0, display: "flex",
                alignItems: "center", justifyContent: "center",
                color: "#888", fontSize: "14px", pointerEvents: "none",
              }}
            >
              Loading HLS stream...
            </div>
          )}
          {hlsError && (
            <div
              style={{
                position: "absolute", inset: 0, display: "flex",
                alignItems: "center", justifyContent: "center",
                color: "#f44", fontSize: "14px", pointerEvents: "none",
              }}
            >
              {hlsError}
            </div>
          )}
          <div
            className="player-header"
            style={{ opacity: controlsVisible ? 1 : 0 }}
          >
            <div className="player-header-left">
              <button
                onClick={handleClose}
                className="icon-control clickable"
                title="Back"
                style={{ marginRight: "1rem" }}
              >
                <ArrowLeft size={18} />
              </button>
            </div>

            <div className="player-title-block">
              <h3>{title}</h3>
              {subtitle && <span>{subtitle}</span>}
            </div>

            <div className="player-header-right">
              <button
                onClick={toggleFullscreen}
                className="icon-control clickable"
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {iframeGateActive && (
            <div
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
              style={{
                position: "absolute", inset: 0, zIndex: 5,
                cursor: "pointer", background: "transparent",
              }}
              aria-label="Click gate active"
            />
          )}

          <iframe
            src={videoUrl}
            title={title ? `${title} stream` : "Embedded stream"}
            style={{ width: "100%", height: "100%", border: 0 }}
            allowFullScreen
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            referrerPolicy="no-referrer-when-downgrade"
          />

          <div
            className="player-header"
            style={{ opacity: controlsVisible ? 1 : 0 }}
          >
            <div className="player-header-left">
              <button
                onClick={handleClose}
                className="icon-control clickable"
                title="Back"
                style={{ marginRight: "1rem" }}
              >
                <ArrowLeft size={18} />
              </button>
            </div>

            <div className="player-title-block">
              <h3>{title}</h3>
              {subtitle && <span>{subtitle}</span>}
            </div>

            <div className="player-header-right">
              <button
                onClick={toggleFullscreen}
                className="icon-control clickable"
                title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
