import { useEffect, useState } from "react";
import { Shield, ShieldOff, ShieldCheck, ExternalLink, X } from "lucide-react";
import { initAdBlocker, destroyAdBlocker, getAdBlockerStatus } from "../utils/adBlocker";

/**
 * AdBlocker component
 *
 * Provides:
 *  1. Auto-initializes the in-page ad blocker on mount
 *  2. A small status pill showing blocked count
 *  3. A tooltip/popover with uBlock Origin install link
 */
export default function AdBlocker() {
  const [isActive, setIsActive] = useState(true);
  const [blockedCount, setBlockedCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showBanner, setShowBanner] = useState(true);

  useEffect(() => {
    initAdBlocker({
      onBlocked: () => {
        setBlockedCount((c) => c + 1);
      },
    });

    // Poll blocked count every 2s
    const interval = setInterval(() => {
      const status = getAdBlockerStatus();
      setBlockedCount(status.blockedCount);
    }, 2000);

    return () => {
      clearInterval(interval);
      destroyAdBlocker();
    };
  }, []);

  const toggleAdBlocker = () => {
    if (isActive) {
      destroyAdBlocker();
      setIsActive(false);
    } else {
      initAdBlocker({
        onBlocked: () => {
          setBlockedCount((c) => c + 1);
        },
      });
      setIsActive(true);
    }
  };

  return (
    <>
      {/* uBlock Origin setup banner */}
      {showBanner && (
        <div className="adblocker-banner">
          <div className="adblocker-banner-content">
            <Shield size={16} />
            <span>
              For <strong>complete popup and ad blocking</strong>, install{" "}
              <a
                href="https://github.com/gorhill/uBlock"
                target="_blank"
                rel="noopener noreferrer"
                className="adblocker-link"
              >
                uBlock Origin
                <ExternalLink size={10} />
              </a>{" "}
              — open-source, lightweight, and blocks ads, pop-ups, overlays, and trackers.
            </span>
          </div>
          <button className="adblocker-banner-close" onClick={() => setShowBanner(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Status pill */}
      <div
        className="adblocker-status-pill"
        onClick={() => setShowTooltip((v) => !v)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {isActive ? (
          <ShieldCheck size={14} className="adblocker-icon active" />
        ) : (
          <ShieldOff size={14} className="adblocker-icon inactive" />
        )}
        <span className="adblocker-count">{blockedCount}</span>

        {/* Tooltip */}
        {showTooltip && (
          <div className="adblocker-tooltip">
            <div className="adblocker-tooltip-header">
              <Shield size={16} />
              <span>In-Page Ad Blocker</span>
              <span className={`adblocker-badge ${isActive ? "on" : "off"}`}>
                {isActive ? "Active" : "Paused"}
              </span>
            </div>
            <div className="adblocker-tooltip-body">
              <p className="adblocker-tooltip-desc">
                Basic ad blocking is {isActive ? "enabled" : "paused"}. Blocks common ad
                domains, scripts, and elements.
              </p>
              <div className="adblocker-tooltip-stat">
                <span>Blocked:</span>
                <strong>{blockedCount} requests</strong>
              </div>
              <div className="adblocker-divider" />
              <p className="adblocker-tooltip-ublock">
                For <strong>complete protection</strong>, use a popup blocker plus DNS/ad blocking:
              </p>
              <div className="adblocker-ublock-links">
                <a
                  href="https://ublockdns.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="adblocker-btn ublock-chrome"
                >
                  <Shield size={14} />
                  uBlockDNS — all apps
                  <ExternalLink size={10} />
                </a>
                <a
                  href="/ublock-filters.txt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="adblocker-btn adguard-chrome"
                >
                  <Shield size={14} />
                  WebStreamer uBlock filters
                  <ExternalLink size={10} />
                </a>
                <a
                  href="https://chromewebstore.google.com/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="adblocker-btn ublock-chrome"
                >
                  <Shield size={14} />
                  uBlock Origin — Chrome
                  <ExternalLink size={10} />
                </a>
                <a
                  href="https://addons.mozilla.org/en-US/firefox/addon/ublock-origin/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="adblocker-btn ublock-firefox"
                >
                  <Shield size={14} />
                  uBlock Origin — Firefox
                  <ExternalLink size={10} />
                </a>
                <a
                  href="https://microsoftedge.microsoft.com/addons/detail/ublock-origin/odlpnhaoeobmoacbnpipbaimhklenmoa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="adblocker-btn ublock-edge"
                >
                  <Shield size={14} />
                  uBlock Origin — Edge
                  <ExternalLink size={10} />
                </a>
                <a
                  href="https://adguard.com/en/adblock-browser/chrome/overview.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="adblocker-btn adguard-chrome"
                >
                  <Shield size={14} />
                  AdGuard — Chrome
                  <ExternalLink size={10} />
                </a>
              </div>
              <div className="adblocker-divider" />
              <button className="adblocker-toggle-btn" onClick={toggleAdBlocker}>
                {isActive ? (
                  <>
                    <ShieldOff size={14} />
                    Pause In-Page Blocker
                  </>
                ) : (
                  <>
                    <ShieldCheck size={14} />
                    Resume In-Page Blocker
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
