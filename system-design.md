# Openstream (WebStreamer) Integration System Design

## Goal

Run a client-side React + Vite app that lets users browse a TMDB-backed
catalog of movies and series, pick a stream, and play it in the browser. The
app aggregates **five different stream APIs in parallel** and always shows a
short list of iframe embed fallbacks so playback works even when the APIs
are rate-limited or down.

## Current System

- Frontend: React 19 + Vite 8 app (`src/`).
- Local fallback catalog with TMDB IDs: `src/data/movies.js` (12 titles).
- Catalog hydration, search, and season/episode metadata: `src/services/tmdbApi.js`
  (TMDB v3 API, optional via `VITE_TMDB_API_KEY` or `VITE_TMDB_ACCESS_TOKEN`).
- Multi-provider stream fetching: `src/services/streamApi.js`.
- Centralized iframe fallback list: `src/utils/fallbackStreams.js`.
- Player: `src/components/NeoPlayer.jsx` (hls.js-based, with native HLS on
  Safari, custom MP4 path, codec-aware audio track selection, and sidecar
  fallback for unsupported audio codecs).
- Ad blocker (CSS + fetch + XHR + popup + mutation observer): `src/utils/adBlocker.js`.

## Architecture

```text
Browser
  |
  v
React App
  |
  |-- src/data/movies.js          Local catalog with TMDB IDs
  |-- src/services/tmdbApi.js     TMDB hydration, search, seasons
  |-- src/services/streamApi.js   Five parallel stream APIs
  |-- src/utils/fallbackStreams.js  Iframe fallback URLs
  |-- src/utils/streamUtils.js   Codec/source classification
  |-- src/components/StreamPicker.jsx  Source and quality selector
  |-- src/components/NeoPlayer.jsx     hls.js / native <video> / iframe player
  |-- src/utils/adBlocker.js + src/components/AdBlocker.jsx
  |
  v
Five stream providers (Promise.allSettled, in parallel)
  + six iframe embed fallbacks
  + Vite dev middleware sidecars (flixhq, ezvidapi, smplstream, mediafusion, sidecar HLS)
```

## Stream Aggregation

The user clicks "Play" on a movie or episode and the app fires
`Promise.allSettled` against the following five providers, plus the
fallback iframe list:

| Provider | Path | Notes |
| --- | --- | --- |
| WebStreamrMBG | `/stream/{type}/tmdb:{id}[:{s}:{e}].json` | Stremio-style aggregator |
| FlixHQ API | `/api/flixhq/source` (Vite dev middleware) | Direct m3u8 |
| ezvidapi | `/api/ezvidapi/embed` (Vite dev middleware) | Multi-server HLS |
| SmashyStream (smplstream) | `/api/smplstream/embed` (Vite dev middleware) | Multi-server HLS / MP4 |
| MediaFusion | `/api/mediafusion/stream` (Vite dev middleware) | Stremio-style aggregator, TMDB → IMDb |

After the API results come back, they are deduplicated and merged in front
of the iframe fallback list. Each provider's stream objects are normalized
into the shared shape used by `StreamPicker` and `NeoPlayer`:

```json
{
  "url": "https://example.com/video.m3u8",
  "name": "Provider\n1080p",
  "title": "Provider information",
  "behaviorHints": {},
  "isHls": true,
  "source": "flixhq-api"
}
```

`StreamPicker` uses `isBrowserPlayableStream()` and the codec detection in
`src/utils/streamUtils.js` to flag each option as "Recommended", "Web-Ready
Fallback", or "Unsupported Source" (e.g. `proxyHeaders` required, MKV,
DTS/TrueHD).

## Fallback Iframe Players

The fallback list lives in `src/utils/fallbackStreams.js` so every UI
surface that needs to know the embed URLs shares one source of truth:

| ID | Domain | Notes |
| --- | --- | --- |
| vidsrc-embed | vidsrc-embed.ru | migrated from vidsrcme.ru |
| vidsrc-me | vidsrc.me | legacy, may redirect |
| vsembed | vsembed.ru | latest mirror |
| superembed | multiembed.mov | 10+ servers |
| 2embed | 2embed.cc | TMDB-based |
| vidlink | vidlink.pro | progress tracking + autoplay |

`buildFallbackStreamList(playable)` returns a normalized stream array the
same shape as API results, marked `isIframe: true`. `NeoPlayer` checks
`isIframeUrl()` to decide whether to render an `<iframe>` instead of an
HLS/MP4 element.

## Playback Flow

1. User clicks play on a movie card or detail modal.
2. App reads `playable.tmdbId` (and season/episode for series).
3. App immediately shows the iframe fallback streams so the user always
   has something to click.
4. App fires `Promise.allSettled` against the five stream APIs.
5. As each API responds successfully, its streams are merged in front of
   the fallback list.
6. The user picks a stream. `NeoPlayer` decides the renderer:
   - iframe embed → `<iframe src={url}>`
   - `.m3u8` → native HLS on Safari, hls.js elsewhere
   - MP4 / WebM / other → native `<video src>`
7. HLS streams that contain unsupported audio codecs (Dolby Digital Plus
   without MSE passthrough, DTS, TrueHD) are routed through the
   sidecar plugin (`/api/sidecar/stream`) which rewrites the manifest
   to drop the bad track and proxies segments with CORS headers.

## Configuration

The app runs out of the box with the local fallback catalog. To enable
TMDB hydration, set one of:

```text
VITE_TMDB_API_KEY=...
VITE_TMDB_ACCESS_TOKEN=...
```

The five stream APIs do not require credentials.

## New Files

### `src/services/streamApi.js`

- Stores the WebStreamrMBG base URL.
- Builds movie and series endpoint URLs (`tmdb:{id}[:{s}:{e}]`).
- Fetches stream responses with a 5-minute in-memory cache and an
  in-flight deduper to absorb rate limits.
- Exposes `fetchStreams`, `checkHealth`, `clearStreamCache`.
- Forwards to the local Vite dev middleware for the FlixHQ, ezvidapi,
  smplstream, and MediaFusion providers.

### `src/components/StreamPicker.jsx`

- Shows the merged list of API + iframe fallback streams.
- Labels each option with quality, format, and a "Recommended" badge for
  browser-playable options.
- Provides retry, close, and an "External player" submenu (VLC, MPV,
  IINA, PotPlayer) for sources the browser can't play directly.
- Surfaces errors with a retry button.

### `src/components/NeoPlayer.jsx`

- Primary player (replaces the older `CinePlayer.jsx` video.js wrapper).
- Detects `.m3u8` URLs and uses native HLS on Safari, hls.js elsewhere.
- Detects iframe URLs and renders an `<iframe>` instead of a `<video>`.
- Routes HLS streams with bad audio codecs through the sidecar plugin.
- Implements full keyboard control, audio track switching, source
  switching, episode navigation, picture-in-picture, theater mode, and
  resume-from-saved-position.

### `src/utils/fallbackStreams.js`

- Centralized list of the six iframe fallback players.
- Exposes `buildFallbackStreamList(playable)`, `isFallbackEmbedUrl(url)`,
  and `FALLBACK_EMBED_PLAYER_IDS`.
- Single source of truth shared by `App.jsx` and any future embed-aware UI.

## Modified Files

### `src/App.jsx`

- Now imports `NeoPlayer` (was `CinePlayer`) and `buildFallbackStreamList`
  from the new utility.
- Replaced the hardcoded list of 6 iframe URLs with a call to
  `buildFallbackStreamList(playable)`.
- Catalog hydration is now less aggressive: it runs once on mount, and
  re-hydration on tab focus only happens if the cached catalog is older
  than 6 hours (down from every focus). The poll interval is also
  widened to 6 hours (down from 30 minutes).

### `src/components/AdBlocker.jsx`

- Banner now recommends uBlock Origin (open-source, lightweight) instead
  of "Poper Blocker". Install links for uBlock Origin and uBlockDNS are
  prominent in the tooltip.

## Error Handling

| Scenario | Behavior |
| --- | --- |
| API unavailable | StreamPicker shows "Stream lookup failed" + Retry |
| No streams returned | StreamPicker shows "No sources found" + Check again |
| All API providers fail | Iframe fallbacks are still shown |
| Stream fails in player | NeoPlayer tries the next browser-playable source |
| HLS audio codec unsupported | Sidecar plugin strips the bad track and proxies segments |
| Stream requires proxy headers | Disabled in picker, explained in tooltip |
| HLS unsupported in browser | Fatal error overlay with retry and source list |

## Rate Limit Strategy

- 5-minute in-memory cache for `fetchStreams` (per `tmdbId[:s:e]` key).
- In-flight request deduper — duplicate clicks don't double-fetch.
- Six iframe fallbacks are presented immediately, so a slow API never
  blocks the user.

## Verification Plan

1. `npm run dev` and open the app.
2. Click play on a movie → fallback iframes appear instantly, API
   streams merge in.
3. Pick an iframe stream → player renders in an `<iframe>`.
4. Pick an HLS stream → hls.js takes over, codec selection is correct.
5. Pick a proxy-required stream → it is disabled with a clear reason.
6. Tab away and back → no re-fetch if the catalog is < 6 hours old.

## Known Risks

- Public providers can be rate-limited, geo-restricted, or go down.
- Iframe players can show their own ads (the in-page ad blocker plus
  uBlock Origin in the user's browser covers most of this).
- Streams that need `behaviorHints.proxyHeaders` cannot be played
  directly in a browser `<video>` element.
