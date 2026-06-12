# Openstream (formerly WebStreamer)

Open-source, client-side movie and TV streaming web app built with **React 19 + Vite 8**. Browse a TMDB-backed catalog, pick a stream from one of five parallel providers (with six iframe fallbacks), and play it in the browser with `hls.js` or a native HTML5 video element.

The visual language is a minimalist monochrome Cineby / Apple TV-inspired UI with custom Inter and JetBrains Mono typography.

## Features

- **TMDB-backed catalog** with optional hydration, trending auto-discovery, and a fully local 12-title fallback when no TMDB credentials are set.
- **Five parallel stream APIs** (WebStreamrMBG, FlixHQ API, ezvidapi, SmashyStream, MediaFusion) merged via `Promise.allSettled` so a single slow provider never blocks the user.
- **Six iframe fallback players** (vidsrc-embed.ru, vidsrc.me, vsembed.ru, multiembed.mov, 2embed.cc, vidlink.pro) that are presented instantly so playback always has a path.
- **hls.js-based primary player** (`NeoPlayer.jsx`) with native HLS on Safari, codec-aware audio track selection (Dolby Digital / Dolby Digital Plus passthrough detection), sidecar proxy for unsupported audio codecs, picture-in-picture, theater mode, and resume-from-saved-position.
- **External player integration** for VLC, MPV, IINA, and PotPlayer via custom URL schemes, with M3U playlist download and clipboard fallback.
- **In-page ad blocker** layered with CSS injection, fetch / XHR interception, popup blocking, and a DOM mutation observer. Plus a status pill that links to uBlock Origin / uBlockDNS for full protection.
- **Advanced search** with debounced input, multi-field matching (title, cast, creator, year, genre, description), filters for type / genre / year / rating, and recent-search history.
- **Watch list ("My List")** persisted in `localStorage`, plus a per-movie and per-episode playback position memory.
- **Accessibility** — keyboard navigation, `aria-live` regions, focus-visible outlines, skip-to-content link, and a `/` or `Ctrl+K` shortcut to focus the search box.

## Quick start

```bash
npm install
npm run dev
```

Open the URL printed by Vite (default: <http://localhost:5173>).

The app runs out of the box with the local fallback catalog. To enable TMDB hydration and search, copy `.env.example` (or create `.env.local`) and set one of:

```text
VITE_TMDB_API_KEY=your_tmdb_v3_api_key
# or
VITE_TMDB_ACCESS_TOKEN=your_tmdb_v4_read_access_token
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server with the local HLS / stream sidecar middleware |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint over the source tree |
| `npm run test` | Run the Vitest suite |

## Deploy to Vercel

Vercel can deploy this repo directly from GitHub as a Vite app.

Recommended Vercel settings:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |

Set these environment variables in the Vercel project settings:

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_TMDB_ACCESS_TOKEN` | recommended | TMDB v4 read access token for catalog/search/season metadata and MediaFusion TMDB to IMDb lookup |
| `VITE_TMDB_API_KEY` | optional | TMDB v3 API key fallback if no access token is set |
| `VITE_MEDIAFUSION_URL` | optional | Custom MediaFusion/Stremio addon base URL; defaults to `https://mediafusion.elfhosted.com` |

Playback provider endpoints are deployed as Vercel serverless functions under `api/`, matching the local Vite middleware routes:

```text
api/flixhq/source.js        /api/flixhq/source
api/ezvidapi/embed.js       /api/ezvidapi/embed
api/smplstream/embed.js     /api/smplstream/embed
api/mediafusion/stream.js   /api/mediafusion/stream
api/sidecar/{stream,segment}.js
```

Do not commit `.env`; use `.env.example` for variable names and set real values in Vercel.

## Architecture

```text
src/
├── App.jsx                 Main shell (catalog, search, hero, detail, player wiring)
├── data/movies.js          Local fallback catalog (12 titles) with TMDB IDs
├── services/
│   ├── streamApi.js        WebStreamrMBG + four dev-middleware stream providers
│   └── tmdbApi.js          Catalog hydration, search, seasons, trending
├── utils/
│   ├── streamUtils.js      Codec detection, external player launcher, M3U builder
│   ├── fallbackStreams.js  Centralized list of iframe fallback players
│   └── adBlocker.js        In-page ad blocker (CSS + fetch + XHR + mutation observer)
└── components/
    ├── NeoPlayer.jsx       Primary player (hls.js, native video, iframe embed)
    ├── StreamPicker.jsx    Source/quality selector modal
    ├── AdBlocker.jsx       Status pill + tooltip with extension install links
    ├── ExternalPlayerMenu.jsx  VLC / MPV / IINA / PotPlayer launcher
    └── ErrorBoundary.jsx

vite/                       Custom Vite dev middleware
├── flixhq-plugin.js        /api/flixhq/source
├── ezvidapi-plugin.js      /api/ezvidapi/embed
├── smplstream-plugin.js    /api/smplstream/embed
├── mediafusion-plugin.js   /api/mediafusion/stream
├── sidecar-plugin.js       /api/sidecar/{stream,segment}  (HLS manifest rewrite + CORS proxy)
└── hls-manifest.js         Manifest rewriting for unsupported audio codecs

api/                        Vercel serverless playback endpoints
├── flixhq/source.js
├── ezvidapi/embed.js
├── smplstream/embed.js
├── mediafusion/stream.js
└── sidecar/{stream,segment}.js
```

## Configuration

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_TMDB_API_KEY` | optional | TMDB v3 API key (used if no access token is set) |
| `VITE_TMDB_ACCESS_TOKEN` | optional | TMDB v4 read access token (preferred) |

If neither is set, the app runs in **fallback mode** with the local catalog and a friendlier empty-state for the "My List" / search pages.

### Catalog refresh policy

- Hydrate once on mount.
- Periodic refresh every 6 hours (down from 30 minutes) when the tab is visible and credentials exist.
- Re-hydrate on tab focus only if the cached catalog is older than 6 hours.

## Credits

- [Vite](https://vite.dev/) and the React plugin.
- [hls.js](https://github.com/video-dev/hls.js/) for adaptive HLS playback.
- [video.js](https://videojs.com/) (used in earlier iterations, no longer required at runtime).
- [framer-motion](https://www.framer.com/motion/) for animation.
- [lucide-react](https://lucide.dev/) for icons.
- [TMDB](https://www.themoviedb.org/) for catalog metadata, posters, and backdrops.
- [uBlock Origin](https://github.com/gorhill/uBlock) for the recommended browser-side ad blocker.

## License

MIT. See the project metadata in `package.json`.
