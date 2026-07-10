import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw, X, Play } from "lucide-react";
import { motion } from "framer-motion";
import {
  checkAudioSupport, getAudioFileFormat, getStreamFormat, getStreamQuality, hasProxyHeaders, isAudioOnlyStream, isBrowserPlayableStream,
  isIframeUrl, partitionStreams
} from "../utils/streamUtils";
import { useSwipeDownDismiss } from "../hooks/useSwipeDownDismiss";
import ExternalPlayerMenu from "./ExternalPlayerMenu";

const TABS = [
  { id: "iframe", label: "Iframe Players" },
  { id: "webstreamer", label: "Webstreamer" }
];

const getStreamAudioPriority = (stream) => {
  if (!stream?.url || hasProxyHeaders(stream)) return 2;
  return checkAudioSupport(stream).supported === false ? 1 : 0;
};

const prioritizeGoodToGoStreams = (streamList) =>
  streamList
    .map((stream, index) => ({ stream, index, priority: getStreamAudioPriority(stream) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ stream }) => stream);

export default function StreamPicker({
  title,
  streams = [],
  isLoading = false,
  error = null,
  sectionsResolved = { webstreamer: false },
  onSelect,
  onRetry,
  onClose,
  onNotify
}) {
  const hasStreams = streams.length > 0;
  const { webstreamer, iframe } = useMemo(() => partitionStreams(streams), [streams]);

  // Default to Iframe Players so the always-on embeds are immediately
  // tappable. App.jsx pushes them to `streams` synchronously; the Webstreamer
  // tab fills in as the API calls resolve.
  const [activeTab, setActiveTab] = useState("iframe");
  const counts = {
    webstreamer: webstreamer.length,
    iframe: iframe.length,
  };
  const prioritizedWebstreamer = useMemo(() => prioritizeGoodToGoStreams(webstreamer), [webstreamer]);
  const activeStreams = activeTab === "iframe"
    ? iframe
    : prioritizedWebstreamer;
  const externalStream = activeStreams.find((stream) =>
    stream?.url &&
    !stream.isIframe &&
    !isIframeUrl(stream.url) &&
    !hasProxyHeaders(stream)
  );

  // Per-section "is this tab still waiting for its API?" flag. Iframe is
  // always ready synchronously, so it's not tracked.
  const isSectionLoading = {
    webstreamer: !sectionsResolved.webstreamer,
  }[activeTab] ?? false;

  // Swipe-down-to-dismiss on mobile. The grab handle at the top of the
  // panel is the touch target; dragging it down past the threshold
  // (or doing a quick downward flick) calls onClose.
  const { dragY, isDragging, handlers } = useSwipeDownDismiss({ onDismiss: onClose });
  const dragOpacity = Math.max(0, 1 - Math.abs(dragY) / 400);

  return (
    <motion.div
      className="stream-picker-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Choose stream source"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12, ease: "linear" }}
    >
      <motion.section
        className="stream-picker-panel"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98, y: 80 }}
        transition={{ duration: 0.12, ease: "linear" }}
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--border-soft)",
          background: "#060606",
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
        <div className="stream-picker-header">
          <div>
            <p style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "var(--text-secondary)", textTransform: "uppercase" }}>[ SOURCE SELECT ]</p>
            <h2 style={{ fontFamily: "var(--font-mono)", fontSize: "1.18rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{title || "Available streams"}</h2>
          </div>
          <div className="stream-picker-header-actions">
            {hasStreams && !isLoading && !error && (
              <ExternalPlayerMenu
                stream={externalStream}
                fallbackTitle={title}
                menuLabel="[ External ]"
                onNotify={onNotify}
              />
            )}
            <button className="stream-picker-close clickable" onClick={onClose} aria-label="Close stream picker">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── Section tabs ──────────────────────────────────────────────── */}
        <div className="stream-picker-tabs" role="tablist" aria-label="Stream source groups">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`stream-tabpanel-${tab.id}`}
                id={`stream-tab-${tab.id}`}
                className={`stream-picker-tab clickable ${isActive ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="stream-picker-tab-bracket">[</span>
                <span className="stream-picker-tab-label">{tab.label}</span>
                <span className="stream-picker-tab-count">{counts[tab.id]}</span>
                <span className="stream-picker-tab-bracket">]</span>
              </button>
            );
          })}
        </div>

        {isLoading && (
          <div className="stream-picker-state">
            <Loader2 className="spin" size={30} style={{ color: "var(--text-primary)" }} />
            <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "0.95rem" }}>Finding streams...</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>Querying open-source sources for playable streams.</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="stream-picker-state error">
            <AlertTriangle size={30} style={{ color: "var(--text-primary)" }} />
            <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "0.95rem" }}>Stream lookup failed</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>{error}</p>
            {onRetry && (
              <button className="primary-btn clickable" onClick={onRetry}>
                <RotateCcw size={15} /> Retry
              </button>
            )}
          </div>
        )}

        {!isLoading && !error && !hasStreams && (
          <div className="stream-picker-state">
            <AlertTriangle size={30} style={{ color: "var(--text-primary)" }} />
            <h3 style={{ fontFamily: "var(--font-mono)", fontSize: "0.95rem" }}>No sources found</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>No playable streams returned for this title.</p>
            {onRetry && (
              <button className="secondary-btn clickable" onClick={onRetry}>
                <RotateCcw size={15} /> Check again
              </button>
            )}
          </div>
        )}

        {!isLoading && !error && hasStreams && (
          <div
            className="stream-list"
            role="tabpanel"
            id={`stream-tabpanel-${activeTab}`}
            aria-labelledby={`stream-tab-${activeTab}`}
          >
            {activeStreams.length === 0 && (
              <div className="stream-picker-section-empty" aria-live="polite">
                {isSectionLoading ? (
                  <>
                    <Loader2 className="spin" size={18} />
                    <span>Loading direct streams from webstreamer sources...</span>
                  </>
                ) : activeTab === "webstreamer" ? (
                  <span>No direct streams returned for this title.</span>
                ) : (
                  <span>Open a title with a TMDB id to load embed players.</span>
                )}
              </div>
            )}
            {activeStreams.map((stream, index) => {
              const isBlocked = !stream.url || hasProxyHeaders(stream);
              const isIframeStream = stream.isIframe || isIframeUrl(stream.url);
              const recommended = isBrowserPlayableStream(stream);
              const audioSupport = checkAudioSupport(stream);
              const audioNeedsVlc = !isIframeStream && audioSupport.supported === false;
              const quality = getStreamQuality(stream);

              return (
                <button
                  key={`${stream.url || stream.name}-${index}`}
                  className={`stream-option ${isBlocked ? "" : "clickable"}`}
                  disabled={isBlocked}
                  onClick={() => onSelect(stream)}
                  title={isBlocked ? "Stream not playable in browser" : undefined}
                >
                  <div className="stream-play-icon">
                    <Play size={18} fill="currentColor" />
                  </div>
                  <span className="stream-main">
                    <strong>
                      {`${title} · #${index + 1}`}
                      {stream.size && <span className="quality-badge auto">[{stream.size}]</span>}
                      <span className={`quality-badge ${quality === "Auto" ? "auto" : ""}`}>[{quality}]</span>
                      {isAudioOnlyStream(stream) && (
                        <span className="quality-badge audio">{getAudioFileFormat(stream.url)}</span>
                      )}
                    </strong>
                    <small>
                      {isBlocked
                        ? "Unsupported Source"
                        : isIframeStream
                          ? "Web-Ready Fallback"
                          : `${getStreamFormat(stream)} direct stream`}
                    </small>
                  </span>
                  <span className="stream-tags">
                    {!isBlocked && (
                      <span className={`audio-status-badge ${audioNeedsVlc ? "vlc-recommended" : "good-to-go"}`}>
                        {audioNeedsVlc ? "Use local player" : "Good to go"}
                      </span>
                    )}
                    {recommended && !isBlocked && <span className="recommended-badge">Recommended</span>}
                    {hasProxyHeaders(stream) && <span>Requires proxy</span>}
                    {!stream.url && <span>No URL</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </motion.section>
    </motion.div>
  );
}
