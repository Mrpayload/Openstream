// Browser capability detection for the web-only ad-block prompt.
//
// The prompt should appear ONLY when the user satisfies NEITHER of:
//   1. Using the Brave browser (has built-in ad/tracker blocking)
//   2. Has uBlock Origin Lite (or uBlock Origin) extension installed
//
// Web-only gate: Capacitor sets `window.Capacitor` on native builds, so its
// absence means we're running in a plain browser.

const UBO_LITE_ID = "ddkjiahejlhfcafbddmgiahcphecmpfh";
const UBO_FULL_ID = "cjpalhdlnbpafiamejdnhcphjbkeiagm";

// Brave detection. Brave's user-agent string mimics Chrome and does NOT
// contain "Brave", so we rely on client hints + the official navigator.brave
// API. Returns a Promise<boolean>.
export const detectBrave = async () => {
  if (typeof navigator === "undefined") return false;

  // Client hints (User-Agent Reduction brands) expose "Brave" in modern Brave.
  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands) && brands.some((b) => /Brave/i.test(b.brand))) {
    return true;
  }

  // Official Brave API: navigator.brave.isBrave() resolves to true on Brave.
  if (navigator.brave && typeof navigator.brave.isBrave === "function") {
    try {
      return await navigator.brave.isBrave();
    } catch {
      // fall through to false
    }
  }

  return false;
};

// Probe a uBlock extension by attempting to load one of its web-accessible
// resources. A successful load means the extension is installed. Returns a
// Promise<boolean>.
const probeExtensionId = (id) =>
  new Promise((resolve) => {
    if (typeof document === "undefined" || !id) {
      resolve(false);
      return;
    }
    const img = new Image();
    const done = (result) => {
      img.onload = img.onerror = null;
      resolve(result);
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    // noop.png is exposed as a web-accessible resource by both uBO variants.
    img.src = `chrome-extension://${id}/web_accessible_resources/noop.png?cb=${Date.now()}`;
    // Don't hang forever if the load neither fires.
    setTimeout(() => done(false), 1500);
  });

// Detect whether an ad-blocking extension (uBlock Origin Lite or uBlock
// Origin) is present. Best-effort: extensions don't expose themselves to
// pages directly, so we probe known extension IDs.
export const detectUBlock = async () => {
  const [lite, full] = await Promise.all([
    probeExtensionId(UBO_LITE_ID),
    probeExtensionId(UBO_FULL_ID),
  ]);
  return lite || full;
};

export const isWebPlatform = () => {
  if (typeof window === "undefined") return false;
  return !window.Capacitor;
};
