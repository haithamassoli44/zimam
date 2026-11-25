import { computed, reactive, ref, shallowRef, triggerRef, watch } from 'vue'

import { deleteCache } from '@/lib/cache'
import { readChanges, readTexts, type Changes, type Content } from '@/lib/changes'
import { readCheckRuns, type CheckRuns } from '@/lib/checks'
import type { Context } from '@/lib/filters'
import { createGitHub, type GitHub } from '@/lib/github'
import { readIssue, readMoreComments, type Thread } from '@/lib/issue'
import { readPull, type Pull } from '@/lib/pull'
import type { IssueRef } from '@/lib/refs'
import { idleStatus, syncKey, Syncer, TICK, type SyncStatus, type SyncStore } from '@/lib/sync'
import { noOne, type Item, type Me, type Repo, type Workspace } from '@/types'

import { now } from './clock'
import { activeWorkspace, removeWorkspace } from './settings'

/** How long a row that just changed stays marked. */
export const FRESH_MS = 8000

// Each opened workspace gets its own maps and status, so a syncer that is still finishing can't touch the next one's.
export const repos = shallowRef(new Map<string, Repo>())
export const items = shallowRef(new Map<string, Item>())
/** Whose token reads the open workspace, and the open pull requests that ask them for a review. */
export const me = shallowRef<Me>(noOne())
export const status = shallowRef<SyncStatus>(reactive(idleStatus()))
export const highlighted = shallowRef(new Set<string>())
export const loaded = ref(false)

/** Every account the open workspace's repositories belong to, with its avatar. */
export const owners = computed(() => new Map([...repos.value.values()].map((repo) => [repo.owner, repo.ownerAvatar])))
const oneOwner = computed(() => owners.value.size <= 1)

/** Where a listed item lives, or null for a repository that isn't loaded. */
export function itemRef(item: Item): IssueRef | null {
  const repo = repos.value.get(item.repoId)
  return repo ? { repo: repo.fullName, number: item.number } : null
}

/** Where a listed issue lives, or null for a pull request or a repository that isn't loaded. */
export const issueRef = (item: Item): IssueRef | null => (item.kind === 'issue' ? itemRef(item) : null)

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

/** How far the closed history has loaded, in percent. */
export const historyPercent = computed(() => {
  const { history } = status.value
  return history.total ? Math.round((history.done / history.total) * 100) : 0
})

/** How far loading has got, in percent: the open items while they load, then the closed history until it's all in. */
export const progress = computed(() => {
  const { phase, done, total, history, historyDone } = status.value
  if (phase === 'open') return total ? Math.round((done / total) * 100) : null
  return !historyDone && history.total ? historyPercent.value : null
})

/** What the filters need besides the items: the repositories, the time and who is looking. */
export const context = computed<Context>(() => ({ repos: repos.value, now: now.value, me: me.value }))

/**
 * Whether a page is still gathering what it lists, or why it failed to, while it has none of it. `size` is how much
 * it has.
 */
export function gathered(size: () => number) {
  const empty = computed(() => loaded.value && size() === 0)
  return {
    gathering: computed(
      () =>
        !loaded.value ||
        (empty.value && (status.value.phase !== 'idle' || !status.value.syncedAt) && !status.value.error),
    ),
    failed: computed(() => (empty.value ? status.value.error : null)),
  }
}

let syncer: Syncer | null = null
let github: GitHub | null = null
let opening = 0

function session(): SyncStore {
  const store: SyncStore = {
    repos: new Map(),
    items: new Map(),
    me: noOne(),
    changed(fresh) {
      if (repos.value !== store.repos) return
      triggerRef(repos)
      triggerRef(items)
      triggerRef(me)
      if (fresh.length) markFresh(fresh)
    },
  }
  repos.value = store.repos
  items.value = store.items
  me.value = store.me
  status.value = reactive(idleStatus())
  return store
}

async function open(ws: Workspace | null) {
  const ticket = ++opening
  syncer?.stop()
  syncer = null
  github = null
  loaded.value = false
  const store = session()
  if (!ws) return
  const gh = createGitHub(ws.token)
  const next = await Syncer.open(ws, gh, store, status.value)
  if (ticket !== opening) return
  syncer = next
  github = gh
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
  return syncer ? syncer.sync(manual) : Promise.resolve()
}

/** The checks on an open pull request's last commit, read from GitHub when asked for. */
export function checkRuns(item: Pick<Item, 'id' | 'updatedAt' | 'checks'>): Promise<CheckRuns> {
  if (!github) return Promise.reject(new Error('No workspace'))
  return readCheckRuns(github, item)
}

/** An issue and its first comments, read from GitHub with the open workspace's token when it's opened. */
export function issueThread(issue: IssueRef, version?: string): Promise<Thread> {
  if (!github) return Promise.reject(new Error('No workspace'))
  return readIssue(github, issue, version)
}

export function moreComments(thread: Thread): Promise<Thread> {
  if (!github) return Promise.reject(new Error('No workspace'))
  return readMoreComments(github, thread)
}

/** PROTOTYPE: a pull request with its conversation, read with the open workspace's token. */
export function pullRequest(pull: IssueRef): Promise<Pull> {
  if (!github) return Promise.reject(new Error('No workspace'))
  return readPull(github, pull)
}

/** PROTOTYPE: a pull request's changed files and where its diff starts. */
export function pullChanges(repo: string, pull: Parameters<typeof readChanges>[2]): Promise<Changes> {
  if (!github) return Promise.reject(new Error('No workspace'))
  return readChanges(github, repo, pull)
}

/** PROTOTYPE: files' texts at commits, by `commit:path` expressions. */
export function pullTexts(repo: string, expressions: string[]): Promise<Content[]> {
  if (!github) return Promise.reject(new Error('No workspace'))
  return readTexts(github, repo, expressions)
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
