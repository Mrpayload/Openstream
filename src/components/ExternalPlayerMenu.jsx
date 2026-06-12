import { useRef, useState } from "react";
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
  const wrapRef = useRef(null);
  const copiedTimerRef = useRef(null);
  const players = externalPlayerSupport.availableExternalPlayers();
  const supportsProtocols = players.length > 0;

  const described = describeStreamForExternal(stream, fallbackTitle);
  const canCopy = Boolean(described?.url);
  const isMagnet = canCopy && (stream?.isMagnet || isMagnetUrl(stream.url));
  const isIframe = canCopy && (stream?.isIframe || isIframeUrl(stream.url));
  const proxyBlocked = stream && hasProxyHeaders(stream);
  const canLaunchProtocol = canCopy && !isMagnet && !isIframe && !proxyBlocked;

  const notify = (message, variant = "info") => {
    if (onNotify) onNotify(message, variant);
  };

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

  const handleProtocol = async (player) => {
    if (!described?.url) return;
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

    if (copiedOk) {
      notify(`Could not confirm ${player.label} opened — paste the copied URL into VLC.`, "error");
    } else {
      notify(`Could not open ${player.label}. Copy the URL manually.`, "error");
    }
  };

  const handleClick = () => {
    if (disabled) return;
    if (canLaunchProtocol && players.length > 0) {
      handleProtocol(players[0]);
      return;
    }
    handleCopy();
  };

  const disabled = !canCopy;

  return (
    <div className="external-player-menu" ref={wrapRef}>
      <button
        type="button"
        className="soft-btn accent clickable"
        onClick={handleClick}
        disabled={disabled}
        title={
          isMagnet
            ? "Copy this magnet link; VLC cannot play Torrentio magnets directly"
            : isIframe
            ? "Iframe streams can't be exported to an external player"
            : proxyBlocked
              ? "This source needs proxy headers that external players can't send"
              : "Open this stream in a desktop player"
        }
      >
        {copied ? <ClipboardCheck size={14} /> : <ExternalLink size={14} />}
        {showLabel && <span>{canLaunchProtocol && supportsProtocols ? menuLabel : "Copy URL"}</span>}
      </button>
    </div>
  );
};

export default ExternalPlayerMenu;
