import { useMemo, useState } from "react";
import { AlertTriangle, Copy, ExternalLink, Loader2, Magnet, RotateCcw, X, Play } from "lucide-react";
import { motion } from "framer-motion";
import {
  checkAudioSupport, copyToClipboard, getStreamFormat, getStreamQuality, hasProxyHeaders, isBrowserPlayableStream,
  isIframeUrl, isMagnetUrl, partitionStreams
} from "../utils/streamUtils";
import { useSwipeDownDismiss } from "../hooks/useSwipeDownDismiss";
import ExternalPlayerMenu from "./ExternalPlayerMenu";

const TABS = [
  { id: "iframe", label: "Iframe Players" },
  { id: "webstreamer", label: "Webstreamer" },
  { id: "torrentio", label: "Torrentio" }
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
  sectionsResolved = { webstreamer: false, torrentio: false },
  onSelect,
  onRetry,
  onClose,
  onNotify
}) {
  const hasStreams = streams.length > 0;
  const { webstreamer, iframe, torrentio } = useMemo(() => partitionStreams(streams), [streams]);

  // Default to Iframe Players so the 6 always-on embeds are immediately
  // tappable. App.jsx pushes them to `streams` synchronously; the Webstreamer
  // and Torrentio tabs fill in as the API calls resolve.
  const [activeTab, setActiveTab] = useState("iframe");
  const counts = {
    webstreamer: webstreamer.length,
    iframe: iframe.length,
    torrentio: torrentio.length
  };
  const prioritizedWebstreamer = useMemo(() => prioritizeGoodToGoStreams(webstreamer), [webstreamer]);
  const activeStreams = activeTab === "iframe"
    ? iframe
    : activeTab === "torrentio"
      ? torrentio
      : prioritizedWebstreamer;
  const externalStream = activeStreams.find((stream) =>
    stream?.url &&
    !stream.isConfigLink &&
    !stream.isMagnet &&
    !isMagnetUrl(stream.url) &&
    !stream.isIframe &&
    !isIframeUrl(stream.url) &&
    !hasProxyHeaders(stream)
  );
  const isTorrentioTab = activeTab === "torrentio";

  // Per-section "is this tab still waiting for its API?" flag. Iframe is
  // always ready synchronously, so it's not tracked.
  const isSectionLoading = {
    webstreamer: !sectionsResolved.webstreamer,
    torrentio: !sectionsResolved.torrentio
  }[activeTab] ?? false;

  // Magnet rows show a copy button so the user can grab the link without
  // opening the OS handler. Notification flows through onNotify so the
  // toast is the same one the rest of the app uses.
  const handleCopyMagnet = async (url, label = "Magnet link") => {
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (onNotify) {
      onNotify(ok ? `${label} copied` : "Copy failed", ok ? "success" : "error");
    }
  };

  const handlePlayClick = (stream, event) => {
    event.stopPropagation();
    onSelect(stream);
  };

  const handleMagnetOpen = (stream, event) => {
    event.stopPropagation();
    if (!stream?.url) return;
    window.open(stream.url, "_self");
  };

  // Truncate long magnet URLs for the visible row; the full URL stays in
  // the `title` attribute and the OS handler gets the un-truncated value.
  const truncateMagnet = (url) => {
    if (!url) return "";
    return url.length > 72 ? `${url.slice(0, 72)}\u2026` : url;
  };

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
                    <span>
                  {activeTab === "webstreamer"
                    ? "Loading direct streams from webstreamer sources..."
                    : "Searching Torrentio for server-backed torrent streams..."}
                    </span>
                  </>
                ) : activeTab === "torrentio" ? (
                  <span>No Torrentio streams returned for this title.</span>
                ) : activeTab === "webstreamer" ? (
                  <span>No direct streams returned for this title.</span>
                ) : (
                  <span>Open a title with a TMDB id to load embed players.</span>
                )}
              </div>
            )}
            {activeStreams.map((stream, index) => {
              const isBlocked = !stream.url || hasProxyHeaders(stream);
              const isConfigLink = Boolean(stream.isConfigLink);
              const isMagnet = !isConfigLink && (isTorrentioTab || isMagnetUrl(stream.url) || stream.isMagnet);
              const isIframeStream = !isMagnet && !isConfigLink && (stream.isIframe || isIframeUrl(stream.url));
              const recommended = isMagnet || (!isMagnet && isBrowserPlayableStream(stream));
              const audioSupport = checkAudioSupport(stream);
              const audioNeedsVlc = !isConfigLink && !isMagnet && !isIframeStream && audioSupport.supported === false;
              const quality = getStreamQuality(stream);
              const handleOpenConfig = () => {
                if (!stream.url || typeof window === "undefined") return;
                window.open(stream.url, "_blank", "noopener,noreferrer");
              };

              const inner = (
                <>
                  <div className="stream-play-icon">
                    {isConfigLink ? <ExternalLink size={18} /> : isMagnet ? <Magnet size={18} /> : <Play size={18} fill="currentColor" />}
                  </div>
                  <span className="stream-main">
                    <strong>
                      {isConfigLink ? "Torrentio configure" : `${title} · #${index + 1}`}
                      {stream.size && <span className="quality-badge auto">[{stream.size}]</span>}
                      <span className={`quality-badge ${quality === "Auto" ? "auto" : ""}`}>[{isConfigLink ? "Configure" : quality}]</span>
                    </strong>
                    <small>
                      ({isBlocked
                        ? "Unsupported Source"
                          : isConfigLink
                            ? "Torrentio setup link · opens in browser"
                          : isMagnet
                            ? stream.isHls || stream.behaviorHints?.notWebReady || stream.isNotWebReady
                              ? "Server-backed torrent · HLS transcode"
                              : "Server-backed torrent · HTTP range stream"
                            : isIframeStream
                              ? "Web-Ready Fallback"
                              : `${getStreamFormat(stream)} direct stream`})
                    </small>
                    {(isMagnet || isConfigLink) && stream.url && (
                      <code className="magnet-url" title={stream.url}>
                        {truncateMagnet(stream.url)}
                      </code>
                    )}
                  </span>
                  <span className="stream-tags">
                    {(isMagnet || isConfigLink) && stream.url && (
                      <span className="stream-magnet-actions">
                        {isMagnet && (
                          <button
                            type="button"
                            className="stream-action-btn play-btn"
                            onClick={(event) => handlePlayClick(stream, event)}
                            aria-label="Play in browser"
                            title="Play via server-backed torrent"
                          >
                            <Play size={13} fill="currentColor" /> Play
                          </button>
                        )}
                        {isMagnet && (
                          <button
                            type="button"
                            className="stream-action-btn magnet-btn"
                            onClick={(event) => handleMagnetOpen(stream, event)}
                            aria-label="Open in torrent downloader"
                            title="Open in external torrent client"
                          >
                            <Magnet size={13} /> Magnet
                          </button>
                        )}
                        {isConfigLink && (
                          <button
                            type="button"
                            className="stream-action-btn config-btn"
                            onClick={(event) => { event.stopPropagation(); handleOpenConfig(); }}
                            aria-label="Open Torrentio configuration"
                            title="Open configuration in browser"
                          >
                            <ExternalLink size={13} /> Configure
                          </button>
                        )}
                        <button
                          type="button"
                          className="stream-action-btn copy-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleCopyMagnet(stream.url, isConfigLink ? "Configure link" : "Magnet link");
                          }}
                          aria-label={isConfigLink ? "Copy configure link to clipboard" : "Copy magnet link to clipboard"}
                          title={isConfigLink ? "Copy configure link" : "Copy magnet link"}
                        >
                          <Copy size={13} />
                        </button>
                      </span>
                    )}
                    {isMagnet && Number.isFinite(stream.seeds) && <span className="seed-badge">Seeds: {stream.seeds}</span>}
                    {isMagnet && <span className="recommended-badge">Server</span>}
                    {!isConfigLink && !isMagnet && (
                      <span className={`audio-status-badge ${audioNeedsVlc ? "vlc-recommended" : "good-to-go"}`}>
                        {audioNeedsVlc ? "Use local player" : "Good to go"}
                      </span>
                    )}
                    {recommended && <span className="recommended-badge">Recommended</span>}
                    {hasProxyHeaders(stream) && <span>Requires proxy</span>}
                    {!stream.url && <span>No URL</span>}
                  </span>
                </>
              );

              if (isConfigLink) {
                return (
                  <div
                    key={`${stream.url || stream.name}-${index}`}
                    className="stream-option stream-option-magnet"
                    role="button"
                    tabIndex={isBlocked ? -1 : 0}
                    aria-disabled={isBlocked}
                    title={isBlocked ? "Configure link unavailable" : "Open Torrentio configuration"}
                  >
                    {inner}
                  </div>
                );
              }

              if (isMagnet) {
                return (
                  <div
                    key={`${stream.url || stream.name}-${index}`}
                    className="stream-option stream-option-magnet"
                    role="button"
                    tabIndex={isBlocked ? -1 : 0}
                    aria-disabled={isBlocked}
                    title={isBlocked
                      ? "Stream not playable in browser"
                      : "Play in browser or open magnet in external client"}
                  >
                    {inner}
                  </div>
                );
              }

              return (
                <button
                  key={`${stream.url || stream.name}-${index}`}
                  className={`stream-option ${isBlocked ? "" : "clickable"}`}
                  disabled={isBlocked}
                  onClick={() => onSelect(stream)}
                  title={isBlocked ? "Stream not playable in browser" : undefined}
                >
                  {inner}
                </button>
              );
            })}
          </div>
        )}
      </motion.section>
    </motion.div>
  );
}
