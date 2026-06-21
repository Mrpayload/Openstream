import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, ExternalLink } from "lucide-react";
import {
  copyToClipboard, describeStreamForExternal, externalPlayerSupport,
  hasProxyHeaders, isIframeUrl, isMagnetUrl, openWithProtocol
} from "../utils/streamUtils";

const ExternalPlayerMenu = ({
  stream,
  fallbackTitle = "",
  menuLabel = "Play externally",
  showLabel = false,
  onNotify
}) => {
  const [copied, setCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef(null);
  const copiedTimerRef = useRef(null);
  const players = externalPlayerSupport.availableExternalPlayers();

  const described = describeStreamForExternal(stream, fallbackTitle);
  const canCopy = Boolean(described?.url);
  const isMagnet = canCopy && (stream?.isMagnet || isMagnetUrl(stream.url));
  const isIframe = canCopy && (stream?.isIframe || isIframeUrl(stream.url));
  const proxyBlocked = stream && hasProxyHeaders(stream);
  const canOpenLocally = canCopy && !isMagnet && !isIframe && !proxyBlocked;
  const canShowPlayerMenu = canOpenLocally && players.length > 0;
  const disabled = !canCopy;

  const notify = (message, variant = "info") => {
    if (onNotify) onNotify(message, variant);
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleCopy = async () => {
    if (!canCopy) return;
    const ok = await copyToClipboard(described.url);
    if (ok) {
      notify(`Copied URL — paste it into your player`);
      setCopied(true);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } else {
      notify("Copy failed — your browser blocked clipboard access", "error");
    }
  };

  const handleOpenPlayer = async (player) => {
    if (!described?.url) return;
    setIsOpen(false);
    const copiedOk = await copyToClipboard(described.url);
    if (copiedOk) {
      notify(`URL copied — opening ${player.label}...`);
      setCopied(true);
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
    } else {
      notify(`Opening ${player.label}...`, "info");
    }

    const launched = await openWithProtocol(player.scheme, described.url);
    if (launched) {
      notify(`Opened in ${player.label}`);
      return;
    }

    notify(
      copiedOk
        ? `Could not confirm ${player.label} opened — paste the copied URL into your player.`
        : `Could not open ${player.label}. Copy the URL manually.`,
      "error"
    );
  };

  const handleClick = () => {
    if (disabled) return;
    if (canShowPlayerMenu) {
      setIsOpen((open) => !open);
      return;
    }
    if (canOpenLocally) {
      handleCopy();
      return;
    }
    handleCopy();
  };

  return (
    <div className="external-player-menu" ref={wrapRef}>
      <button
        type="button"
        className="soft-btn accent clickable"
        onClick={handleClick}
        disabled={disabled}
        aria-haspopup={canShowPlayerMenu ? "menu" : undefined}
        aria-expanded={canShowPlayerMenu ? isOpen : undefined}
        title={
          isMagnet
            ? "Copy this magnet link or use the Magnet button for your torrent app"
            : isIframe
            ? "Iframe streams can't be exported to an external player"
            : proxyBlocked
              ? "This source needs proxy headers that external players can't send"
              : "Open this stream with your system's media handler"
        }
      >
        {copied ? <ClipboardCheck size={14} /> : <ExternalLink size={14} />}
        {showLabel && <span>{canOpenLocally ? menuLabel : "Copy URL"}</span>}
        {canShowPlayerMenu && <span aria-hidden="true">▾</span>}
      </button>
      {isOpen && canShowPlayerMenu && (
        <div className="external-player-dropdown" role="menu" aria-label="Choose local player">
          {players.map((player) => (
            <button
              key={player.id}
              type="button"
              role="menuitem"
              onClick={() => handleOpenPlayer(player)}
            >
              Open in {player.label}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => { setIsOpen(false); handleCopy(); }}>
            Copy URL
          </button>
        </div>
      )}
    </div>
  );
};

export default ExternalPlayerMenu;
