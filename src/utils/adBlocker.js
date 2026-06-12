/**
 * Lightweight in-page ad blocker for WebStreamer
 *
 * Layers:
 *  1. CSS injection — hides common ad containers
 *  2. Fetch/XHR interception — blocks requests to known ad domains
 *  3. DOM mutation observer — catches dynamically injected ad elements
 *
 * Note: This is NOT a replacement for a browser extension like uBlock Origin.
 * It provides basic in-page ad blocking. For full protection, install uBlock Origin.
 */

// ── Ad domain blocklist ──────────────────────────────────────────────
const AD_DOMAINS = new Set([
  // Major ad networks
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "google-analytics.com",
  "googletagmanager.com",
  "googletagservices.com",
  "adnxs.com",
  "adsrvr.org",
  "advertising.com",
  "casalemedia.com",
  "contextweb.com",
  "demdex.net",
  "doubleverify.com",
  "exelator.com",
  "eyeota.net",
  "hariken.co",
  "impdesk.com",
  "insurads.com",
  "mathtag.com",
  "mediaplex.com",
  "moatads.com",
  "nexac.com",
  "omtrdc.net",
  "openx.net",
  "optimizely.com",
  "permutive.com",
  "pubmatic.com",
  "quantserve.com",
  "rubiconproject.com",
  "scorecardresearch.com",
  "segment.com",
  "segment.io",
  "simpli.fi",
  "smartadserver.com",
  "taboola.com",
  "teads.tv",
  "turn.com",
  "unity3d.com",
  "valueclick.com",
  "yieldmo.com",
  "zerodrifts.com",
  "zergnet.com",

  // Streaming-specific ad servers
  "pubads.g.doubleclick.net",
  "gampad.ads.g.doubleclick.net",
  "ad.doubleclick.net",
  "pagead2.googlesyndication.com",
  "static.criteo.net",
  "bidder.criteo.com",
  "dis.criteo.com",
  "cdn.taboola.com",
  "cdn.outbrain.com",
  "widgets.outbrain.com",
  "widgets.criteo.com",

  // Tracking
  "hotjar.com",
  "sentry.io",
  "amplitude.com",
  "mixpanel.com",
  "pendo.io",
  "fullstory.com",
  "logrocket.com",
  "heap.io",
  "mouseflow.com",
  "crazyegg.com",
  "luckyorange.com",
]);

// ── CSS selectors for common ad elements ─────────────────────────────
const AD_CSS_SELECTORS = [
  // Generic ad containers
  '[class*="ad-banner"]',
  '[class*="ad-container"]',
  '[class*="ad-wrapper"]',
  '[class*="ad-slot"]',
  '[class*="ad-unit"]',
  '[class*="adzone"]',
  '[class*="adsbygoogle"]',
  '[id*="ad-banner"]',
  '[id*="ad-container"]',
  '[id*="ad-wrapper"]',
  '[id*="ad-slot"]',
  '[id*="google_ads"]',
  '[id*="googleAd"]',
  '[id*="doubleclick"]',
  '[data-ad-slot]',
  '[data-ad-unit]',
  '[data-ad-placement]',

  // Common ad networks
  ".adthrive",
  ".mediavine",
  ".carbon-ad",
  ".buysellads",
  ".sponsor-text",
  ".sponsored-content",
  ".sponsored-post",
  ".native-ad",
  ".ad-readmore",
  ".ad-inserter",
  ".wp-block-ad",
  ".commercial-unit-desktop-top",

  // Popups and overlays
  ".popup-ad",
  ".modal-ad",
  ".overlay-ad",
  ".interstitial-ad",
  ".prestitial-ad",

  // Video ads
  ".video-ad",
  ".preroll-ad",
  ".midroll-ad",
  ".vast-ad",
  ".ima-ad-container",

  // Iframe ads
  'iframe[src*="doubleclick"]',
  'iframe[src*="googlesyndication"]',
  'iframe[src*="adnxs"]',
  'iframe[src*="pubmatic"]',
  'iframe[src*="rubiconproject"]',
  'iframe[src*="openx"]',
  'iframe[src*="smartadserver"]',
  'iframe[src*="taboola"]',
  'iframe[src*="outbrain"]',
  'iframe[src*="criteo"]',
  'iframe[src*="zerodrifts.com"]',
  'iframe[src*="prebid"]',
  'iframe[id*="google_ads"]',
  'iframe[id*="ad_"]',
];

// ── Ad script URL patterns ───────────────────────────────────────────
const AD_SCRIPT_PATTERNS = [
  /ads\.(googlesyndication|doubleclick)\.com/i,
  /pagead2\.googlesyndication\.com/i,
  /imasdk\.googleapis\.com/i,
  /static\.criteo\.net/i,
  /cdn\.taboola\.com/i,
  /cdn\.outbrain\.com/i,
  /bidder\.criteo\.com/i,
  /dis\.criteo\.com/i,
  /tags\.tiqcdn\.com/i,
  /smartadserver\.com/i,
  /adnxs\.com/i,
  /adsrvr\.org/i,
  /rubiconproject\.com/i,
  /pubmatic\.com/i,
  /openx\.net/i,
  /prebid/i,
  /amazon-adsystem\.com/i,
  /aps\.amazon-adsystem\.com/i,
  /zerodrifts\.com/i,
];

// ── State ────────────────────────────────────────────────────────────
let isAdBlockerActive = false;
let blockedCount = 0;
let cssInjected = false;
let observerActive = false;
let styleElement = null;
let observer = null;
let originalFetch = null;
let originalXHROpen = null;
let originalWindowOpen = null;
let blockedClickHandler = null;
let onBlockedCallback = null;

// ── CSS injection ────────────────────────────────────────────────────
function injectAdBlockingCSS() {
  if (cssInjected) return;

  const css = `
    ${AD_CSS_SELECTORS.join(",\n")} {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      max-height: 0 !important;
      overflow: hidden !important;
      position: absolute !important;
      pointer-events: none !important;
      z-index: -9999 !important;
    }

    /* Anti-adblock wall bypass */
    .adblock-overlay,
    .adblock-modal,
    .adblock-popup,
    .adblock-wall,
    .adb-overlay,
    .adb-modal,
    [class*="adblock-detect"],
    [class*="adb-detect"],
    [id*="adblock-detect"],
    [id*="adb-detect"] {
      display: none !important;
    }

    /* Remove ad placeholder sizing */
    [class*="ad-slot"][style*="min-height"],
    [class*="ad-container"][style*="min-height"] {
      min-height: 0 !important;
    }
  `;

  styleElement = document.createElement("style");
  styleElement.id = "webstreamer-adblocker-css";
  styleElement.textContent = css;
  (document.head || document.documentElement).appendChild(styleElement);
  cssInjected = true;
}

function removeAdBlockingCSS() {
  if (styleElement && styleElement.parentNode) {
    styleElement.parentNode.removeChild(styleElement);
    styleElement = null;
    cssInjected = false;
  }
}

// ── Request interception ──────────────────────────────────────────────
function isAdUrl(url) {
  if (!url) return false;
  try {
    const parsedUrl = new URL(url, window.location.origin);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return false;
    const hostname = parsedUrl.hostname;
    // Check domain blocklist
    for (const domain of AD_DOMAINS) {
      if (hostname === domain || hostname.endsWith("." + domain)) {
        return true;
      }
    }
    // Check script patterns
    for (const pattern of AD_SCRIPT_PATTERNS) {
      if (pattern.test(url)) return true;
    }
  } catch {
    // Invalid URL, skip
  }
  return false;
}

function blockFetch() {
  if (originalFetch) return;

  originalFetch = window.fetch;
  window.fetch = function (...args) {
    const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
    if (isAdUrl(url)) {
      blockedCount++;
      if (onBlockedCallback) onBlockedCallback(url, "fetch");
      return Promise.resolve(new Response("", { status: 204, statusText: "Blocked by WebStreamer AdBlocker" }));
    }
    return originalFetch.apply(this, args);
  };
}

function blockXHR() {
  if (originalXHROpen) return;

  originalXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isAdUrl(url)) {
      blockedCount++;
      if (onBlockedCallback) onBlockedCallback(url, "xhr");
      // Abort silently
      this._blockedByAdBlocker = true;
      return;
    }
    return originalXHROpen.call(this, method, url, ...rest);
  };

  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._blockedByAdBlocker) {
      return;
    }
    return originalSend.apply(this, args);
  };
}

function blockWindowOpen() {
  if (originalWindowOpen) return;

  originalWindowOpen = window.open;
  window.open = function (url, ...rest) {
    if (isAdUrl(url)) {
      blockedCount++;
      if (onBlockedCallback) onBlockedCallback(url, "popup");
      return null;
    }
    return originalWindowOpen.call(this, url, ...rest);
  };
}

function blockAdClicks() {
  if (blockedClickHandler) return;

  blockedClickHandler = (event) => {
    const link = event.target?.closest?.("a[href]");
    if (!link || !isAdUrl(link.href)) return;

    event.preventDefault();
    event.stopPropagation();
    blockedCount++;
    if (onBlockedCallback) onBlockedCallback(link.href, "click");
  };

  document.addEventListener("click", blockedClickHandler, true);
}

function unblockFetch() {
  if (originalFetch) {
    window.fetch = originalFetch;
    originalFetch = null;
  }
}

function unblockXHR() {
  if (originalXHROpen) {
    XMLHttpRequest.prototype.open = originalXHROpen;
    originalXHROpen = null;
  }
}

function unblockWindowOpen() {
  if (originalWindowOpen) {
    window.open = originalWindowOpen;
    originalWindowOpen = null;
  }
}

function unblockAdClicks() {
  if (blockedClickHandler) {
    document.removeEventListener("click", blockedClickHandler, true);
    blockedClickHandler = null;
  }
}

// ── DOM mutation observer ────────────────────────────────────────────
function startObserver() {
  if (observerActive || typeof MutationObserver === "undefined") return;

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Check if the added node matches ad selectors
        for (const selector of AD_CSS_SELECTORS) {
          try {
            if (node.matches?.(selector) || node.querySelector?.(selector)) {
              node.style.display = "none";
              node.style.visibility = "hidden";
              blockedCount++;
              break;
            }
          } catch {
            // Invalid selector, skip
          }
        }

        // Check if added node is an iframe with ad URL
        if (node.tagName === "IFRAME" && node.src && isAdUrl(node.src)) {
          node.style.display = "none";
          blockedCount++;
        }

        // Check script tags
        if (node.tagName === "SCRIPT" && node.src && isAdUrl(node.src)) {
          node.type = "text/blocked";
          blockedCount++;
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  observerActive = true;
}

function stopObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
    observerActive = false;
  }
}

// ── Remove existing ad elements ──────────────────────────────────────
function removeExistingAds() {
  for (const selector of AD_CSS_SELECTORS) {
    try {
      document.querySelectorAll(selector).forEach((el) => {
        el.style.display = "none";
        el.style.visibility = "hidden";
      });
    } catch {
      // Invalid selector
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────
/**
 * Initialize the ad blocker.
 * @param {object} options
 * @param {function} options.onBlocked - Callback when a request/element is blocked: (url, type) => void
 */
export function initAdBlocker(options = {}) {
  if (isAdBlockerActive) return;

  onBlockedCallback = options.onBlocked || null;

  injectAdBlockingCSS();
  blockFetch();
  blockXHR();
  blockWindowOpen();
  blockAdClicks();
  startObserver();
  removeExistingAds();

  isAdBlockerActive = true;
}

/**
 * Destroy the ad blocker and restore original behavior.
 */
export function destroyAdBlocker() {
  if (!isAdBlockerActive) return;

  stopObserver();
  unblockFetch();
  unblockXHR();
  unblockWindowOpen();
  unblockAdClicks();
  removeAdBlockingCSS();

  isAdBlockerActive = false;
}

/**
 * Get ad blocker status.
 */
export function getAdBlockerStatus() {
  return {
    active: isAdBlockerActive,
    blockedCount,
  };
}

/**
 * Get the list of blocked ad domains (for display).
 */
export function getBlockedDomains() {
  return [...AD_DOMAINS].sort();
}

/**
 * Get the CSS selectors used for ad blocking (for display).
 */
export function getAdSelectors() {
  return [...AD_CSS_SELECTORS];
}
