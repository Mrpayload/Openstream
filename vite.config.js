import { defineConfig } from 'vite'
import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'

// Dev-only server plugins are imported dynamically only during `vite dev`.
// They are excluded from `vite build` (including Vercel) because some use
// top-level side-effects (createRequire, loadEnv, process.env) that can
// fail in build environments.
const devPlugins = async () => {
  const [
    { default: flixhqApiPlugin },
    { default: ezvidApiPlugin },
    { default: smplStreamPlugin },
    { default: mediafusionPlugin },
    { default: sidecarPlugin },
    { default: embedProxyPlugin },
    { default: vidlinkPlugin },
    { default: cinemetaPlugin },
    { default: tmdbPlugin },
  ] = await Promise.all([
    import('./vite/flixhq-plugin.js'),
    import('./vite/ezvidapi-plugin.js'),
    import('./vite/smplstream-plugin.js'),
    import('./vite/mediafusion-plugin.js'),
    import('./vite/sidecar-plugin.js'),
    import('./vite/embed-proxy-plugin.js'),
    import('./vite/vidlink-plugin.js'),
    import('./vite/cinemeta-plugin.js'),
    import('./vite/tmdb-plugin.js'),
  ])
  return [
    flixhqApiPlugin(),
    ezvidApiPlugin(),
    smplStreamPlugin(),
    mediafusionPlugin(),
    sidecarPlugin(),
    embedProxyPlugin(),
    vidlinkPlugin(),
    cinemetaPlugin(),
    tmdbPlugin(),
  ]
}

// https://vite.dev/config/
export default defineConfig(async ({ command }) => {
  const plugins = [react()]

  if (command === 'serve') {
    plugins.push(...(await devPlugins()))
  }

  return {
    plugins,
    resolve: {
      alias: {
        'webtorrent': fileURLToPath(new URL('./node_modules/webtorrent/dist/webtorrent.min.js', import.meta.url))
      }
    },
    server: {
      allowedHosts: true
    }
  }
})
