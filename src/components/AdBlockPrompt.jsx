import { motion } from "framer-motion";
import { ShieldAlert, ExternalLink, X } from "lucide-react";

const UBO_LITE_URL =
  "https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh";

const DISMISSED_KEY = "openstream_adblock_prompt_dismissed";

/**
 * AdBlockPrompt
 *
 * Web-only modal shown to users who are neither on Brave (built-in blocking)
 * nor running uBlock Origin Lite / uBlock Origin. Prompts them to adopt one
 * for an ad-free experience. Dismissal is remembered in localStorage.
 */
export default function AdBlockPrompt({ onDismiss }) {
  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    onDismiss?.();
  };

  const openExtension = () => {
    window.open(UBO_LITE_URL, "_blank", "noopener,noreferrer");
    handleDismiss();
  };

  return (
    <div className="adblock-prompt-backdrop" role="dialog" aria-modal="true" aria-label="Ad-free browsing">
      <motion.div
        className="adblock-prompt"
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <button className="adblock-prompt-close" onClick={handleDismiss} aria-label="Dismiss">
          <X size={22} />
        </button>

        <div className="adblock-prompt-icon">
          <ShieldAlert size={40} />
        </div>

        <h2 className="adblock-prompt-title">Get an ad-free experience</h2>
        <p className="adblock-prompt-body">
          You're browsing the web version without built-in ad blocking. For the
          cleanest playback, use the <strong>Brave browser</strong> or install
          <strong> uBlock Origin Lite</strong> — then this prompt won't appear.
        </p>

        <div className="adblock-prompt-actions">
          <button className="adblock-prompt-primary" onClick={openExtension}>
            <ExternalLink size={16} />
            Get uBlock Origin Lite
          </button>
          <button className="adblock-prompt-secondary" onClick={handleDismiss}>
            I use Brave / Dismiss
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export { DISMISSED_KEY };
