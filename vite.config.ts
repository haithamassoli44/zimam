import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import VueI18nPlugin from '@intlify/unplugin-vue-i18n/vite'
import ui from '@nuxt/ui/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import { DEV_TOKEN_PATH } from './src/dev.ts'
import { uiIcons } from './src/ui-icons.ts'

// To open `vite dev` from your other devices through `tailscale serve`, set the host name it is served on, and the
// one Tailscale login allowed to take this machine's gh token.
const remoteHost = process.env.ZIMAM_DEV_HOST
const remoteUser = process.env.ZIMAM_DEV_USER

export default defineConfig(({ command }) => ({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5190, strictPort: true, allowedHosts: remoteHost ? [remoteHost] : [] },
  preview: { host: '127.0.0.1', port: 5191, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        // Each syntax grammar loads only when a diff needs it. There are some 250, so they get a folder of their own,
        // which the service worker leaves out.
        chunkFileNames: (chunk) =>
          chunk.facadeModuleId?.includes('/@shikijs/langs/')
            ? 'assets/grammars/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    vue(),
    ui({
      router: false,
      autoImport: false,
      components: false,
      colorMode: false,
      ui: {
        colors: { primary: 'lapis', info: 'lapis', neutral: 'neutral' },
        icons: uiIcons,
        popover: { slots: { content: 'rounded-lg' } },
        dropdownMenu: {
          slots: { content: 'rounded-lg', label: 'font-medium' },
          variants: {
            size: { md: { item: 'pointer-coarse:py-3', itemLeadingIcon: 'size-4', itemTrailingIcon: 'size-4' } },
          },
        },
        // Touch screens get room for a finger: see `tap` in style.css, and 16px inputs, which iOS doesn't zoom into.
        button: {
          slots: { base: 'tap' },
          variants: {
            size: {
              md: { leadingIcon: 'size-4', trailingIcon: 'size-4' },
              lg: { leadingIcon: 'size-4', trailingIcon: 'size-4' },
            },
          },
        },
        input: {
          slots: { base: 'pointer-coarse:text-base' },
          variants: {
            size: {
              md: { leadingIcon: 'size-4', trailingIcon: 'size-4' },
              lg: { leadingIcon: 'size-4', trailingIcon: 'size-4' },
            },
          },
        },
        modal: { slots: { title: 'font-medium' } },
        slideover: { slots: { title: 'font-medium' } },
        // Keys as they're typed: `j`, `Shift`, `Enter`, not capitals.
        kbd: { base: 'font-mono font-normal normal-case' },
      },
      // Only bundled icons are allowed: the page may not call the Iconify API.
      // The scan reads .ts too: icons named in tables like components/looks.ts appear in no template.
      icon: { clientBundle: { scan: { globInclude: ['src/**/*.{vue,ts}'] }, icons: Object.values(uiIcons) } },
      experimental: { componentDetection: command === 'build' },
    }),
    VueI18nPlugin({ include: fileURLToPath(new URL('./src/locales/*.json', import.meta.url)) }),
    VitePWA({
      // A new version waits until the reader reloads: src/pwa.ts offers it.
      registerType: 'prompt',
      injectRegister: false,
      // The precache below takes the icons with every other file.
      includeManifestIcons: false,
      manifest: {
        id: '/',
        name: 'Zimam',
        short_name: 'Zimam',
        description: 'Every issue and pull request across your GitHub organizations, in one fast, filterable list.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // The light background in style.css.
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // The install dialogs of Chrome and Edge show these.
        screenshots: [
          {
            src: '/screenshots/wide.webp',
            sizes: '1440x900',
            type: 'image/webp',
            form_factor: 'wide',
            label: 'Every open issue and pull request of an organization, with filters and counts',
          },
          {
            src: '/screenshots/narrow.webp',
            sizes: '780x1688',
            type: 'image/webp',
            form_factor: 'narrow',
            label: 'The same list on a phone',
          },
        ],
      },
      workbox: {
        // The app itself, so it opens offline. GitHub's API is never cached: the list's own cache is IndexedDB.
        globPatterns: ['**/*.{html,js,css,woff2,svg,ico,png}'],
        globIgnores: ['og.png', 'screenshots/**', 'assets/grammars/**'],
        // Cloudflare serves these, like the analytics endpoint; they aren't pages of the app.
        navigateFallbackDenylist: [/^\/cdn-cgi\//],
      },
    }),
    devGitHubToken(),
  ],
}))

function devGitHubToken(): Plugin {
  return {
    name: 'zimam-dev-github-token',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(DEV_TOKEN_PATH, (req, res) => {
        // Tailscale sets this header on what it proxies, and drops any value a client sends.
        const allowed = !remoteUser || req.headers['tailscale-user-login'] === remoteUser
        if (req.headers['sec-fetch-site'] !== 'same-origin' || !allowed) {
          res.statusCode = 403
          res.end()
          return
        }
        promisify(execFile)('gh', ['auth', 'token']).then(
          ({ stdout }) => {
            res.setHeader('Content-Type', 'text/plain')
            res.end(stdout.trim())
          },
          () => {
            res.statusCode = 404
            res.end()
          },
        )
      })
    },
  }
}
