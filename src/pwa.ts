// Zimam as an installed app: the service worker's new versions, and installing.
import { registerSW } from 'virtual:pwa-register'
import { ref, shallowRef } from 'vue'

const HOUR = 60 * 60_000

/** A new version is installed and waits for a reload. */
export const updateReady = ref(false)

let reloading = false
function reload() {
  if (reloading) return
  reloading = true
  location.reload()
}

const activate = registerSW({
  onNeedRefresh: () => (updateReady.value = true),
  // The other tabs the old version runs reload once the new one takes over.
  onNeedReload: reload,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    // Browsers look for a new version when a page loads, and a dashboard can stay open for days.
    setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) registration.update().catch(() => {})
    }, HOUR)
  },
})

/** Lets the new version take over, then reloads into it. */
export async function update() {
  const waiting = (await navigator.serviceWorker.getRegistration())?.waiting
  if (!waiting) {
    reload()
    return
  }
  // A tab opened before the app was first installed runs without a service worker, so nothing tells it when the new
  // one takes over: it watches the worker itself, and reloads anyway if that takes too long.
  waiting.addEventListener('statechange', () => {
    if (waiting.state === 'activated') reload()
  })
  setTimeout(reload, 3000)
  await activate()
}

const standalone = matchMedia('(display-mode: standalone)')

/** Running as an installed app, in its own window. */
export const installed = ref(standalone.matches || (navigator as { standalone?: boolean }).standalone === true)
standalone.addEventListener('change', (event) => (installed.value = event.matches))

// An installed app keeps what it saved, even when the device runs short of space.
if (installed.value) void navigator.storage?.persist?.()

interface InstallPrompt extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** The browser's install dialog, while it offers one. Only Chromium-based browsers do. */
export const installPrompt = shallowRef<InstallPrompt | null>(null)
addEventListener('beforeinstallprompt', (event) => (installPrompt.value = event as InstallPrompt))
addEventListener('appinstalled', () => (installPrompt.value = null))

export async function install() {
  const prompt = installPrompt.value
  // Each prompt opens once. The browser offers a new one later if this one is dismissed.
  installPrompt.value = null
  await prompt?.prompt()
}

/** Where to install from in browsers without an install dialog: Safari on iOS and iPadOS, and on macOS from 17. */
export const manualInstall = ((): 'ios' | 'mac' | null => {
  const agent = navigator.userAgent
  // iPadOS asks for desktop sites, so it reads as a Mac with a touch screen.
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return 'ios'
  const safari = /Version\/(\d+)[\d.]* Safari\//.exec(agent)
  return /Macintosh/.test(agent) && Number(safari?.[1]) >= 17 ? 'mac' : null
})()
