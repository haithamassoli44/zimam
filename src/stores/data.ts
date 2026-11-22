import { computed, reactive, ref, shallowRef, triggerRef, watch } from 'vue'

import { deleteCache } from '@/lib/cache'
import { createGitHub } from '@/lib/github'
import { idleStatus, syncKey, Syncer, TICK, type SyncStatus, type SyncStore } from '@/lib/sync'
import type { Item, Repo, Workspace } from '@/types'

import { activeWorkspace, removeWorkspace } from './settings'

// style.css reads this as `--fresh` for the wash on a fresh row.
const FRESH_MS = 8000
document.documentElement.style.setProperty('--fresh', `${FRESH_MS}ms`)

// Each opened workspace gets its own maps and status, so a syncer that is still finishing can't touch the next one's.
export const repos = shallowRef(new Map<string, Repo>())
export const items = shallowRef(new Map<string, Item>())
export const status = shallowRef<SyncStatus>(reactive(idleStatus()))
export const highlighted = shallowRef(new Set<string>())
export const loaded = ref(false)

/** Every account the open workspace's repositories belong to, with its avatar. */
export const owners = computed(() => new Map([...repos.value.values()].map((repo) => [repo.owner, repo.ownerAvatar])))
const oneOwner = computed(() => owners.value.size <= 1)

export function displayRepo(fullName: string): string {
  return oneOwner.value ? (fullName.split('/')[1] ?? fullName) : fullName
}

export const people = computed(() => {
  const avatars = new Map<string, string>()
  const colors = new Map<string, string>()
  for (const item of items.value.values()) {
    if (item.author) avatars.set(item.author.login, item.author.avatarUrl)
    for (const person of item.assignees) avatars.set(person.login, person.avatarUrl)
    for (const label of item.labels) colors.set(label.name, label.color)
  }
  return { avatars, colors }
})

/** How far loading has got, in percent: the open items while they load, then the closed history until it's all in. */
export const progress = computed(() => {
  const { phase, done, total, history, historyDone } = status.value
  if (phase === 'open') return total ? Math.round((done / total) * 100) : null
  return !historyDone && history.total ? Math.round((history.done / history.total) * 100) : null
})

let syncer: Syncer | null = null
let opening = 0

function session(): SyncStore {
  const store: SyncStore = {
    repos: new Map(),
    items: new Map(),
    changed(fresh) {
      if (repos.value !== store.repos) return
      triggerRef(repos)
      triggerRef(items)
      if (fresh.length) markFresh(fresh)
    },
  }
  repos.value = store.repos
  items.value = store.items
  status.value = reactive(idleStatus())
  return store
}

async function open(ws: Workspace | null) {
  const ticket = ++opening
  syncer?.stop()
  syncer = null
  loaded.value = false
  const store = session()
  if (!ws) return
  const next = await Syncer.open(ws, createGitHub(ws.token), store, status.value)
  if (ticket !== opening) return
  syncer = next
  loaded.value = true
  void next.start()
}

watch(
  () => activeWorkspace.value && syncKey(activeWorkspace.value),
  () => void open(activeWorkspace.value),
  {
    immediate: true,
  },
)

export function syncNow(manual = false) {
  if (!syncer || status.value.error === 'auth') return Promise.resolve()
  return syncer.sync(manual)
}

/** Drops what this browser saved for the open workspace and fetches it again. */
export async function reloadWorkspace() {
  const ws = activeWorkspace.value
  if (!ws) return
  syncer?.stop()
  await deleteCache(ws.id)
  await open(ws)
}

export async function deleteWorkspace() {
  const ws = activeWorkspace.value
  if (!ws) return
  syncer?.stop()
  await deleteCache(ws.id)
  removeWorkspace(ws.id)
}

function markFresh(ids: string[]) {
  highlighted.value = new Set([...highlighted.value, ...ids])
  setTimeout(() => {
    const next = new Set(highlighted.value)
    for (const id of ids) next.delete(id)
    highlighted.value = next
  }, FRESH_MS)
}

let lastTick = Date.now()

function tick() {
  if (document.visibilityState !== 'visible') return
  lastTick = Date.now()
  void syncNow()
}

setInterval(tick, TICK)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastTick > TICK / 2) tick()
})
// Back online: catch up now, not at the next tick.
addEventListener('online', tick)
