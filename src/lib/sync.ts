import type { Item, Repo, Source, Workspace } from '@/types'

import { emptyCache, readCache, setMarker, syncedMarker, writeCache, type Cache } from './cache'
import { GitHubError, type ErrorKind, type GitHub, type RateLimit } from './github'
import { NODES, PR_STATUS, repoItems, SEARCH, toChecks, toItem, toReview, type Page, type RawItem } from './queries'
import { belongsTo, qualifier, reposOf, sourcesKey } from './sources'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

export const TICK = MINUTE
// The closed history can take many minutes to load, so it loads in slices this long, with a check for changes before
// each one.
const HISTORY_SLICE = 0.75 * TICK
// GitHub's search lags behind a change by a little, so each check looks this far before the last one.
const OVERLAP = 10 * MINUTE
const REPOS_EVERY = 15 * MINUTE
const CHECKS_EVERY = 5 * MINUTE
// Search can't report what disappeared, such as deleted or transferred issues, so open items are refetched now and then.
const RECONCILE_EVERY = 6 * HOUR
const RECONCILE_MANUAL = 10 * MINUTE
// The hourly allowance is shared with every other tool on the same GitHub account, so some of it is always left.
const RESERVE = 0.02
const HISTORY_RESERVE = 0.15

export interface SyncStatus {
  phase: 'idle' | 'repos' | 'open' | 'changes' | 'history'
  /** Repositories whose open items are fetched, while `phase` is 'open'. */
  done: number
  total: number
  syncedAt: number | null
  /** Repositories whose closed history is fetched, out of those that have one. */
  history: { done: number; total: number }
  historyDone: boolean
  pausedUntil: number | null
  rate: RateLimit | null
  /** Rate limits pause instead: see `pausedUntil`. */
  error: Exclude<ErrorKind, 'rate'> | null
  failedSources: string[]
}

export function idleStatus(): SyncStatus {
  return {
    phase: 'idle',
    done: 0,
    total: 0,
    syncedAt: null,
    history: { done: 0, total: 0 },
    historyDone: false,
    pausedUntil: null,
    rate: null,
    error: null,
    failedSources: [],
  }
}

/** The in-memory data the screen reads. `changed` is called after every change, with the items that are news. */
export interface SyncStore {
  repos: Map<string, Repo>
  items: Map<string, Item>
  changed(fresh: string[]): void
}

/** What a sync depends on: a change to any of it needs a new Syncer. */
export function syncKey(ws: Workspace): string {
  return `${ws.id} ${ws.token} ${sourcesKey(ws.sources)}`
}

export class Syncer {
  private stopped = false
  private current: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private channel: BroadcastChannel | null = null
  private newsSince = Infinity
  private unsaved = false
  private settled = false
  private sliced = false

  static async open(ws: Workspace, gh: GitHub, store: SyncStore, status: SyncStatus): Promise<Syncer> {
    const sources = sourcesKey(ws.sources)
    const cache = (await readCache(ws.id)) ?? emptyCache(ws.id, sources)
    if (cache.sources !== sources) {
      cache.sources = sources
      cache.reposAt = null
    }
    return new Syncer(ws, gh, store, status, cache)
  }

  constructor(
    private readonly ws: Workspace,
    private readonly gh: GitHub,
    private readonly store: SyncStore,
    private readonly status: SyncStatus,
    private cache: Cache,
  ) {}

  start(): Promise<void> {
    this.show(this.cache)
    if ('BroadcastChannel' in globalThis) {
      this.channel = new BroadcastChannel('zimam')
      this.channel.addEventListener('message', (event: MessageEvent<{ ws: string }>) => {
        if (event.data.ws === this.ws.id && !this.current) void this.adoptStored()
      })
    }
    return this.sync()
  }

  stop() {
    this.stopped = true
    clearTimeout(this.saveTimer)
    this.channel?.close()
  }

  sync(manual = false): Promise<void> {
    this.current ??= this.withLock(manual).finally(() => {
      this.current = null
      const more = this.sliced
      this.sliced = false
      // The next slice of the history doesn't wait for a tick.
      if (more && !this.stopped) setTimeout(() => void this.sync(), 0)
    })
    return this.current
  }

  private async withLock(manual: boolean) {
    const locks = globalThis.navigator?.locks
    if (!locks) return this.run(manual)
    const ran = await locks.request(`zimam:${this.ws.id}`, { ifAvailable: true }, async (lock) => {
      if (lock) await this.run(manual)
      return !!lock
    })
    // A workspace that was just opened shouldn't wait a whole tick for a lock that is about to be free, such as the
    // one a syncer this tab just stopped is letting go of.
    if (!ran && !this.settled && !this.stopped) setTimeout(() => void this.sync(manual), 2000)
  }

  private async run(manual: boolean) {
    const started = Date.now()
    if (this.stopped || (this.status.pausedUntil ?? 0) > started) return
    this.status.pausedUntil = null
    const peerJustSynced = (await this.adoptStored()) && started - syncedMarker(this.ws.id) < 0.75 * TICK
    if (peerJustSynced && !manual) return

    this.newsSince = this.cache.syncedAt === null ? Infinity : this.cache.syncedAt - OVERLAP
    const first = this.cache.watermark === null
    if (first) {
      this.cache.watermark = started
      this.cache.reconciledAt = started
    } else if (started - (this.cache.reconciledAt ?? 0) > (manual ? RECONCILE_MANUAL : RECONCILE_EVERY)) {
      this.cache.openDone = []
      this.cache.reconciledAt = started
    }

    const steps = [
      () => (manual || !this.cache.reposAt || started - this.cache.reposAt > REPOS_EVERY ? this.loadRepos() : null),
      () => this.loadOpen(),
      () => (first ? null : this.loadChanges(started)),
      () => {
        const checked = this.cache.checksAt ?? 0
        return (manual ? checked < started : started - checked > CHECKS_EVERY) ? this.loadChecks() : null
      },
      () => {
        this.cache.syncedAt = Date.now()
        this.status.syncedAt = this.cache.syncedAt
        return this.save()
      },
      () => this.loadHistory(),
    ]
    try {
      this.status.error = null
      for (const step of steps) {
        if (this.stopped) return
        await step()
      }
    } catch (error) {
      this.fail(error)
    } finally {
      this.settled = true
      this.status.phase = 'idle'
      this.status.rate = this.gh.rate()
      await this.save()
    }
  }

  private async adoptStored(): Promise<boolean> {
    if (syncedMarker(this.ws.id) <= (this.cache.syncedAt ?? 0)) return false
    const stored = await readCache(this.ws.id)
    if (!stored || (stored.syncedAt ?? 0) <= (this.cache.syncedAt ?? 0)) return false
    this.cache = stored
    this.show(stored)
    return true
  }

  private changed(fresh: string[]) {
    this.unsaved = true
    this.store.changed(fresh)
  }

  private show(cache: Cache) {
    this.store.repos.clear()
    this.store.items.clear()
    for (const repo of cache.repos) this.store.repos.set(repo.id, repo)
    for (const item of cache.items) this.store.items.set(item.id, item)
    this.status.syncedAt = cache.syncedAt
    this.showHistory()
    this.store.changed([])
  }

  private fail(error: unknown) {
    if (this.stopped) return
    if (!(error instanceof GitHubError)) {
      console.error(error)
      this.status.error = 'query'
    } else if (error.kind === 'rate') {
      this.status.pausedUntil = error.retryAt ?? Date.now() + MINUTE
    } else {
      this.status.error = error.kind
    }
  }

  private hasBudget(reserve: number): boolean {
    const rate = this.gh.rate()
    this.status.rate = rate
    if (!rate || rate.remaining > rate.limit * reserve) return true
    if (rate.remaining <= rate.limit * RESERVE) this.status.pausedUntil = rate.resetAt
    return false
  }

  private async loadRepos() {
    this.status.phase = 'repos'
    const repos = new Map<string, Repo>()
    const failed: Source[] = []
    for (const source of this.ws.sources) {
      try {
        for (const repo of await reposOf(this.gh, source)) repos.set(repo.id, repo)
      } catch (error) {
        if (!(error instanceof GitHubError) || error.kind !== 'query') throw error
        failed.push(source)
      }
    }
    this.status.failedSources = failed.map((source) => source.name)
    // A source GitHub couldn't read this time keeps its repositories, so one bad answer doesn't empty the list.
    for (const repo of this.store.repos.values()) {
      if (!repos.has(repo.id) && failed.some((source) => belongsTo(repo, source))) repos.set(repo.id, repo)
    }
    for (const item of this.store.items.values()) if (!repos.has(item.repoId)) this.store.items.delete(item.id)
    this.store.repos.clear()
    for (const [id, repo] of repos) this.store.repos.set(id, repo)
    this.cache.openDone = this.cache.openDone.filter((id) => repos.has(id))
    this.cache.reposAt = Date.now()
    this.changed([])
  }

  private async loadOpen() {
    const pending = [...this.store.repos.values()].filter((repo) => !this.cache.openDone.includes(repo.id))
    if (!pending.length) return
    const startedAt = Date.now()
    const all = pending.length === this.store.repos.size
    this.status.phase = 'open'
    this.status.done = 0
    this.status.total = pending.length
    await pool(pending, 4, async (repo) => {
      if (this.stopped || !this.hasBudget(RESERVE)) return
      const fetched: Item[] = []
      if (repo.openIssues) for await (const page of this.pages(repo, 'issues', ['OPEN'])) fetched.push(...page.items)
      if (repo.openPrs) for await (const page of this.pages(repo, 'pullRequests', ['OPEN'])) fetched.push(...page.items)
      if (this.stopped) return
      this.put(fetched)
      const seen = new Set(fetched.map((item) => item.id))
      const missing = [...this.store.items.values()].filter(
        (item) => item.repoId === repo.id && item.state === 'open' && !seen.has(item.id),
      )
      if (missing.length) await this.refetch(missing.map((item) => item.id))
      this.cache.openDone.push(repo.id)
      this.status.done++
      this.saveSoon()
    })
    // Open pull requests come with their checks and reviews, so once all of them are in, those are fresh too.
    if (all && pending.every((repo) => this.cache.openDone.includes(repo.id))) this.cache.checksAt = startedAt
  }

  private async loadChanges(started: number) {
    if (!this.hasBudget(RESERVE)) return
    this.status.phase = 'changes'
    const since = new Date((this.cache.watermark ?? started) - OVERLAP).toISOString().replace(/\.\d+Z$/, 'Z')
    const found: Item[] = []
    let tooMany = false
    // Several qualifiers in one search are OR'ed, and a query holds about eight before GitHub refuses it.
    for (const group of chunk(this.ws.sources, 8)) {
      if (tooMany) break
      const q = `${group.map(qualifier).join(' ')} updated:>=${since}`
      let after: string | null = null
      do {
        const data: { search: Page<RawItem | Record<string, never>> & { issueCount: number } } = await this.gh.query(
          SEARCH,
          { q, after },
        )
        // Search stops at 1,000 results. After a long absence, refetching the open items is cheaper and complete.
        if (data.search.issueCount > 1000) tooMany = true
        if (tooMany) break
        for (const node of data.search.nodes) if (node && 'id' in node) found.push(toItem(node as RawItem))
        after = data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null
      } while (after)
    }
    if (tooMany) {
      this.cache.openDone = []
      this.cache.reconciledAt = started
      await this.loadOpen()
    }
    const newRepo = found.some((item) => !this.store.repos.has(item.repoId))
    this.put(found)
    if (newRepo) {
      await this.loadRepos()
      await this.loadOpen()
    }
    this.cache.watermark = started
  }

  // A finished CI run doesn't change a pull request's update time, so open pull requests' checks are asked for apart.
  private async loadChecks() {
    const open = [...this.store.items.values()].filter((item) => item.kind === 'pr' && item.state === 'open')
    for (const ids of chunk(
      open.map((item) => item.id),
      100,
    )) {
      if (this.stopped || !this.hasBudget(RESERVE)) return
      const data = await this.gh.query<{
        nodes: (Pick<RawItem, 'id' | 'isDraft' | 'reviewDecision' | 'commits'> | null)[]
      }>(PR_STATUS, { ids })
      let patched = false
      for (const node of data.nodes) {
        const item = node && this.store.items.get(node.id)
        if (!node || !item) continue
        const review = toReview(node)
        const checks = toChecks(node)
        if (review === item.review && checks === item.checks) continue
        this.store.items.set(item.id, { ...item, review, checks })
        patched = true
      }
      if (patched) this.changed([])
    }
    this.cache.checksAt = Date.now()
  }

  private async loadHistory() {
    const pending = this.showHistory()
    if (!pending.length || !this.hasBudget(HISTORY_RESERVE)) return
    this.status.phase = 'history'
    const until = Date.now() + HISTORY_SLICE
    const more = () => !this.stopped && Date.now() < until && this.hasBudget(HISTORY_RESERVE)
    await pool(pending, 2, async (repo) => {
      for (const kind of this.historyKinds(repo)) {
        if (!more()) return
        const entry = (this.cache.history[repo.id] ??= {})
        const key = kind === 'issues' ? 'issues' : 'prs'
        const saved = entry[key]
        const resume = typeof saved === 'string' ? saved : null
        const states = kind === 'issues' ? ['CLOSED'] : ['CLOSED', 'MERGED']
        for await (const page of this.pages(repo, kind, states, resume)) {
          this.put(page.items)
          entry[key] = page.cursor ?? true
          this.saveSoon()
          if (!more()) return
        }
        if (this.stopped) return
        entry[key] = true
      }
      this.status.history.done++
    })
    this.sliced = this.showHistory().length > 0 && !this.stopped && this.hasBudget(HISTORY_RESERVE)
  }

  /** Shows how much of the history is loaded, and returns the repositories with some of it left. */
  private showHistory(): Repo[] {
    const pending = this.historyLeft()
    const total = [...this.store.repos.values()].filter(
      (repo) => repo.issues + repo.prs > repo.openIssues + repo.openPrs,
    ).length
    this.status.history = { done: total - pending.length, total }
    this.status.historyDone = this.cache.syncedAt !== null && pending.length === 0
    return pending
  }

  private historyLeft(): Repo[] {
    return [...this.store.repos.values()].filter((repo) => this.historyKinds(repo).length > 0)
  }

  private historyKinds(repo: Repo): ('issues' | 'pullRequests')[] {
    const entry = this.cache.history[repo.id] ?? {}
    const kinds: ('issues' | 'pullRequests')[] = []
    if (repo.issues > repo.openIssues && entry.issues !== true) kinds.push('issues')
    if (repo.prs > repo.openPrs && entry.prs !== true) kinds.push('pullRequests')
    return kinds
  }

  // GitHub times out on heavy pages, open pull requests with their checks most of all, so those start smaller and
  // any page that times out is asked for again at half the size.
  private async *pages(repo: Repo, kind: 'issues' | 'pullRequests', states: string[], after: string | null = null) {
    const open = states.includes('OPEN')
    const query = repoItems(kind, open)
    let first = kind === 'pullRequests' && open ? 50 : 100
    while (!this.stopped) {
      let page: Page<RawItem | null> | undefined
      try {
        const data = await this.gh.query<{ repository: Record<string, Page<RawItem | null>> | null }>(query, {
          owner: repo.owner,
          name: repo.name,
          states,
          first,
          after,
        })
        page = data.repository?.[kind]
      } catch (error) {
        if (error instanceof GitHubError && error.kind === 'server' && first > 25) {
          first = Math.floor(first / 2)
          continue
        }
        throw error
      }
      if (!page) return
      const cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
      yield { items: page.nodes.filter((node): node is RawItem => node !== null).map(toItem), cursor }
      if (!cursor) return
      after = cursor
    }
  }

  private async refetch(ids: string[]) {
    for (const group of chunk(ids, 100)) {
      const data = await this.gh.query<{ nodes: (RawItem | null)[] }>(NODES, { ids: group })
      const found: Item[] = []
      let deleted = false
      data.nodes.forEach((node, index) => {
        if (node && 'id' in node) found.push(toItem(node))
        else deleted = this.store.items.delete(group[index]) || deleted
      })
      if (!this.put(found) && deleted) this.changed([])
    }
  }

  /** Returns whether anything changed. */
  private put(items: Item[]): boolean {
    const fresh: string[] = []
    let changed = false
    for (const item of items) {
      const old = this.store.items.get(item.id)
      if (old && old.updatedAt > item.updatedAt) continue
      if (old && old.updatedAt === item.updatedAt && old.checks === item.checks && old.review === item.review) continue
      this.store.items.set(item.id, item)
      changed = true
      if (old?.updatedAt !== item.updatedAt && Date.parse(item.updatedAt) > this.newsSince) fresh.push(item.id)
    }
    if (changed) this.changed(fresh)
    return changed
  }

  private saveSoon() {
    if (this.stopped) return
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), 2000)
  }

  // Other tabs only hear about saves with new data, so a quiet minute doesn't make each of them reread the cache.
  private async save() {
    clearTimeout(this.saveTimer)
    if (this.stopped) return
    const announce = this.unsaved
    this.unsaved = false
    this.cache.repos = [...this.store.repos.values()]
    this.cache.items = [...this.store.items.values()]
    if (!(await writeCache(this.cache)) || !announce) return
    setMarker(this.ws.id, this.cache.syncedAt)
    this.channel?.postMessage({ ws: this.ws.id })
  }
}

function chunk<T>(list: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size))
  return chunks
}

async function pool<T>(list: T[], size: number, task: (item: T) => Promise<void>) {
  let next = 0
  let failure: { error: unknown } | null = null
  const worker = async () => {
    while (!failure && next < list.length) {
      try {
        await task(list[next++])
      } catch (error) {
        failure ??= { error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker))
  if (failure) throw (failure as { error: unknown }).error
}
