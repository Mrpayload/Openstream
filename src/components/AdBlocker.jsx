import { useEffect, useState } from "react";
import { Shield, ShieldOff, ShieldCheck } from "lucide-react";
import { initAdBlocker, destroyAdBlocker, getAdBlockerStatus } from "../utils/adBlocker";

/**
 * AdBlocker component
 *
 * Provides:
 *  1. Auto-initializes the in-page ad blocker on mount
 *  2. A small status pill showing blocked count
 *  3. A tooltip/popover showing block stats and toggle
 */
export default function AdBlocker() {
  const [isActive, setIsActive] = useState(true);
  const [blockedCount, setBlockedCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);

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
  );
}
