import { getRequestUrl, sendJson } from "./_lib/http.js";

const ALLOWED_EMBED_HOSTS = new Set([
  "vsembed.ru",
  "vidlink.pro",
  "vidsrcme.ru",
  "multiembed.mov",
  "vidsrc.to",
  "autoembed.com",
  "multiembed.com",
  "watch-v2.autoembed.app",
  "autoembed.net",
  "embed.smashystream.com",
  "www.2embed.cc",
  "flicky.host",
]);

const PROXY_TIMEOUT_MS = 15_000;

// Guard script injected at the TOP of <head> — runs before any ad script.
// This blocks all popup vectors inside the proxied embed page.
const GUARD_SCRIPT = `<script id="webstreamer-guard">
(function() {
  "use strict";

  // ── 1. Override window.open ──────────────────────────────────────────
  var _open = window.open;
  window.open = function(url, target, features) {
    console.warn("[guard] blocked window.open:", url);
    return { closed: true, close: function(){}, document: { write: function(){} } };
  };
  // Spoof toString so detection scripts see "[native code]"
  window.open.toString = function() { return "function open() { [native code] }"; };

  // ── 2. Intercept anchor clicks targeting _blank ──────────────────────
  document.addEventListener("click", function(e) {
    var a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (a && a.target === "_blank") {
      e.preventDefault();
      e.stopPropagation();
      console.warn("[guard] blocked _blank link:", a.href);
    }
  }, true);

  // ── 3. Wrap location.assign / location.replace ───────────────────────
  var _assign = location.assign.bind(location);
  var _replace = location.replace.bind(location);
  location.assign = function(url) {
    if (typeof url === "string" && url.match(/^https?:\\/\\//) && !url.includes(location.hostname)) {
      console.warn("[guard] blocked location.assign:", url);
      return;
    }
    _assign(url);
  };
  location.replace = function(url) {
    if (typeof url === "string" && url.match(/^https?:\\/\\//) && !url.includes(location.hostname)) {
      console.warn("[guard] blocked location.replace:", url);
      return;
    }
    _replace(url);
  };

  // ── 4. Block form submissions targeting new windows ───────────────────
  document.addEventListener("submit", function(e) {
    var form = e.target;
    if (form && (form.target === "_blank" || form.target === "_parent" || form.target === "_top")) {
      e.preventDefault();
      console.warn("[guard] blocked form submit to:", form.target);
    }
  }, true);

  // ── 5. Block programmatic HTMLElement.click on anchors ────────────────
  var _click = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function() {
    if (this && this.tagName === "A" && this.target === "_blank") {
      console.warn("[guard] blocked programmatic click on:", this.href);
      return;
    }
    return _click.apply(this, arguments);
  };

  console.log("[guard] popup blocker active");
})();
</script>`;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const url = getRequestUrl(req);
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    sendJson(res, 400, { error: "Missing required parameter: url" });
    return;
  }

  // Validate target is an allowed embed host
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    sendJson(res, 400, { error: "Invalid URL" });
    return;
  }

  if (!ALLOWED_EMBED_HOSTS.has(parsedTarget.hostname)) {
    sendJson(res, 403, { error: `Host not allowed: ${parsedTarget.hostname}` });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const upstreamRes = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Referer": `${parsedTarget.origin}/`,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
    });

    if (!upstreamRes.ok) {
      console.warn(`[embed-proxy] upstream ${upstreamRes.status} for ${targetUrl} (redirecting)`);
      res.statusCode = 302;
      res.setHeader("Location", targetUrl);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end();
      return;
    }

    const contentType = upstreamRes.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      // Not HTML — stream through as-is (e.g., m3u8, mp4)
      res.statusCode = upstreamRes.status;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Access-Control-Allow-Origin", "*");
      const body = Buffer.from(await upstreamRes.arrayBuffer());
      res.end(body);
      return;
    }

    let html = await upstreamRes.text();

    const baseTag = `<base href="${parsedTarget.origin}/">`;
    const injectedHead = baseTag + "\n" + GUARD_SCRIPT;
    
    // Inject guard script and base tag at the top of <head> (or at the start of <html> if no <head>)
    if (html.includes("<head")) {
      html = html.replace(/(<head[^>]*>)/i, "$1\n" + injectedHead);
    } else if (html.includes("<html")) {
      html = html.replace(/(<html[^>]*>)/i, "$1\n<head>\n" + injectedHead + "\n</head>");
    } else {
      html = injectedHead + "\n" + html;
    }

    // Strip upstream CSP headers that might block our scripts
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "ALLOWALL");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (typeof res.removeHeader === "function") {
      res.removeHeader("Content-Security-Policy");
      res.removeHeader("Content-Security-Policy-Report-Only");
    }
    res.end(html);
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("[embed-proxy] error:", error?.message || error);
    }
    res.statusCode = 302;
    res.setHeader("Location", targetUrl);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end();
  } finally {
    clearTimeout(timer);
  }
}
