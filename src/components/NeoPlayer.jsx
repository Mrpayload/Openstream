import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Maximize, Minimize } from "lucide-react";

export default function NeoPlayer({
  videoUrl,
  title,
  subtitle,
  onClose,
}) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [iframeGateActive, setIframeGateActive] = useState(true);

  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);
  const revealRafRef = useRef(0);
  const iframeGateTimerRef = useRef(null);

  useEffect(() => {
    setIframeGateActive(true);
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

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape" && !document.fullscreenElement) {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

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
          <button onClick={onClose} className="soft-btn accent clickable">
            <ArrowLeft size={14} /> Back
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
    </div>
  );
}
