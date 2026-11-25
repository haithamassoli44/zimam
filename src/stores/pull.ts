// The open pull request: what it is, what it changed, and what the reader saw of it before.
import { computed, shallowReactive, shallowRef, watch } from 'vue'

import { seenKey } from '@/lib/cache'
import {
  blobAt,
  readChanges,
  readRange,
  BLOBS_PER_READ,
  NO_FILE,
  readTexts,
  readVersions,
  sides,
  type PullHeads,
  type Changes,
  type Content,
  type FileChange,
} from '@/lib/changes'
import { readCheckRuns, type CheckRuns } from '@/lib/checks'
import { diffFiles, type FileDiff } from '@/lib/diff'
import { generatedRules } from '@/lib/generated'
import type { GitHub } from '@/lib/github'
import { isPost, readPull, type Commit, type Pull, type ReviewThread } from '@/lib/pull'
import { refKey, sameRef, type IssueRef } from '@/lib/refs'
import { BASE, changeKey, onAllChanges, readFile, tickFile, type FileTicks, type Reading } from '@/lib/ticks'
import type { FileMode, Item } from '@/types'

import { client, itemRef, items, status } from './data'
import { activeWorkspace, postShown, settings } from './settings'
import { sharedRecord } from './shared'
import { openPull, pullScope } from './view'

// --- What the reader saw: visits, viewed files, and a pull request's own file mode ----------------------------------

interface Seen {
  /** The last visit: when, and the head commit then. */
  at: number
  head: string
  /** The changes ticked viewed, by the file's path, as lib/ticks names them. */
  ticked: Record<string, string[]>
  /** Changes unticked by hand that would still read as viewed, by GitHub's tick or by other ticks leading there. */
  unticked: Record<string, string[]>
  files?: FileMode
}

// The pull requests a workspace remembers: the latest visited, as many as fit in about a megabyte, a share of the room
// the browser gives the whole app.
const ROOM = 1_000_000

// Each pull request is an entry the tabs share field by field, so a tab doesn't undo what another saw, even of the same
// pull request.
const seenAll = sharedRecord<Seen>(
  () => seenKey(activeWorkspace.value?.id ?? ''),
  (entries) => {
    const kept: [string, Seen][] = []
    let used = 0
    for (const entry of entries.toSorted(([, a], [, b]) => b.at - a.at)) {
      used += entry[0].length + JSON.stringify(entry[1]).length
      if (used > ROOM && kept.length) break
      kept.push(entry)
    }
    return kept
  },
)

// --- The session: one pull request, from opening it until another opens --------------------------------------------

/** What a read gives: the answer, still on its way (null), or not to be had. */
type Read<T> = T | 'failed' | null

interface Session {
  ref: IssueRef
  /** The client of the workspace it opened in: every read goes through it. */
  gh: GitHub
  pull: Read<Pull>
  problem: string | null
  /** The visit before this one, which the marks count from. Null on a first visit. */
  lastVisit: { at: number; head: string } | null
  runs: Read<CheckRuns>
  /** What each run of commits changed, by its key: ALL for the whole pull request. */
  changes: Map<string, Read<Changes>>
  /** Those reads, by the same key, on their way or done. One that failed is asked again by whoever asks next. */
  reads: Map<string, Promise<Changes | null>>
  /** The repository's .gitattributes at the head, for generated files. */
  attributes: string | null
  /** File texts by `commit:path`, and those asked for, here or on their way. */
  texts: Map<string, Content>
  asked: Set<string>
  /** Files' versions by `commit:path`: read with their texts, or alone for the commits list's ticks. */
  versions: Map<string, string>
  /** Whether the commits list's reads have started. */
  commitsRead: boolean
  textsDone: number
  textsTotal: number
  /** Files whose new side's text marks them generated, by path. */
  marked: Set<string>
  showGenerated: boolean
  diffs: Map<string, FileDiff>
  /** Its read again on its way, which says whether the page took GitHub's answer, and whether to read once more after. */
  refreshing: Promise<boolean> | null
  refreshAgain: boolean
  /**
   * The list's copy it was last read again for. The page can still be behind it after, as when GitHub's search runs
   * ahead of the pull request: it isn't read again for the same copy, unless that read failed.
   */
  readFor: string | null
  /**
   * The checks and conflicts the list's copy had when the page's last read started, each until a copy agrees with the
   * page on it: a copy that differs from them and the page has news, where one that differs from the page alone is just
   * behind it. And when that read started, for a list without a copy then.
   */
  listed: ListStatus
  readAt: number
  /** How many times its checks were asked for: only the last answer counts. */
  runsAsked: number
}

const ALL = 'all'

function newSession(ref: IssueRef, gh: GitHub): Session {
  return shallowReactive({
    ref,
    gh,
    pull: null,
    problem: null,
    lastVisit: null,
    runs: null,
    changes: shallowReactive(new Map()),
    reads: new Map(),
    attributes: null,
    texts: shallowReactive(new Map()),
    asked: new Set(),
    versions: shallowReactive(new Map()),
    commitsRead: false,
    textsDone: 0,
    textsTotal: 0,
    marked: shallowReactive(new Set()),
    showGenerated: false,
    diffs: new Map(),
    refreshing: null,
    refreshAgain: false,
    readFor: null,
    listed: {},
    readAt: 0,
    runsAsked: 0,
  })
}

const session = shallowRef<Session | null>(null)

// The visit before this session's first look at each pull request. Reading one again in the session, or reloading the
// workspace, keeps counting from there.
const sessionVisits = new Map<string, { at: number; head: string } | null>()

// Every step writes into the session it started in: once another pull request opens, nothing reads that one again.
async function open(ref: IssueRef, gh: GitHub) {
  const s = newSession(ref, gh)
  session.value = s
  s.listed = statusOf(listCopy(ref))
  s.readAt = Date.now()
  let pull: Pull
  try {
    // What the pull request changed is read as soon as its first answer says where it starts and ends.
    pull = await readPull(gh, ref, (heads) => void changesOf(s, heads, null))
  } catch (error) {
    s.problem = error instanceof Error ? error.message : 'failed'
    s.pull = 'failed'
    return
  }
  if (session.value !== s) return
  const key = refKey(ref)
  const before = seenAll[key]
  if (!sessionVisits.has(key)) sessionVisits.set(key, before ? { at: before.at, head: before.head } : null)
  s.lastVisit = sessionVisits.get(key) ?? null
  recordVisit(s, pull)
  s.pull = pull
  readRuns(s, pull)
  // What the address shows first, then the whole pull request, which the marks since the last visit count in, then
  // what the commits list needs for its ticks, where the reader ticks commits.
  if (scope.value) void changesOf(s, pull, scope.value)
  const onCommits = ticksCommits(s)
  void readWhole(s, pull).then(() => {
    if (onCommits) void readCommits(s, pull)
  })
}

// The visit this is, which the next one counts from: now, at this head.
function recordVisit(s: Session, pull: Pull) {
  const key = refKey(s.ref)
  const before = seenAll[key]
  seenAll[key] = {
    ...before,
    ticked: before?.ticked ?? {},
    unticked: before?.unticked ?? {},
    at: Date.now(),
    head: pull.headOid,
  }
}

// The checks of the head read last: an answer about an earlier one, still on its way, is let go.
function readRuns(s: Session, pull: Pull) {
  const asked = ++s.runsAsked
  if (!pull.checks) {
    s.runs = null
    return
  }
  readCheckRuns(s.gh, pull).then(
    (found) => {
      if (asked === s.runsAsked) s.runs = found
    },
    () => {
      if (asked === s.runsAsked) s.runs = 'failed'
    },
  )
}

// Whether the reader ticked files in a run of commits, which the commits list's ticks need read.
const ticksCommits = (s: Session) =>
  !Object.values(seenAll[refKey(s.ref)]?.ticked ?? {})
    .flat()
    .every(onAllChanges)

export function reloadPull() {
  return openPull.value && client.value ? open(openPull.value, client.value) : Promise.resolve()
}

/**
 * Reads the open pull request again, as GitHub has it now, without starting over: what's on screen stays until the new
 * answer is in. When its head or base moved, what it changed is read again before the page takes the new answer, so
 * the diff never shows one head's files at another's. So is what it changed when that couldn't be read last time, and
 * the commits shown. Asked again while it reads, it reads once more after.
 */
export async function refreshPull(): Promise<boolean> {
  const s = session.value
  if (!s || s.pull === null) return false
  if (s.pull === 'failed') {
    await reloadPull()
    return true
  }
  s.refreshAgain = true
  s.refreshing ??= readAgain(s)
  return s.refreshing
}

/** Reads the session's pull request again, as many times as asked meanwhile. Says whether the page took the answer. */
async function readAgain(s: Session): Promise<boolean> {
  try {
    while (s.refreshAgain && session.value === s) {
      s.refreshAgain = false
      if (s.pull === null || s.pull === 'failed') return false
      const before: Pull = s.pull
      const listed = statusOf(items.value.get(before.id))
      const readAt = Date.now()
      const heads: { moved: boolean; read?: Promise<{ changes: Changes; attributes: string | null } | null> } = {
        moved: false,
      }
      const next = await readPull(s.gh, s.ref, (found) => {
        heads.moved = found.headOid !== before.headOid || found.baseOid !== before.baseOid
        if (heads.moved || s.changes.get(ALL) === 'failed') heads.read = readChanges(s.gh, found).catch(() => null)
      })
      const found = heads.read && (await heads.read)
      if (session.value !== s) return false
      if (heads.read) {
        s.reads.delete(ALL)
        if (found) {
          s.reads.set(ALL, Promise.resolve(found.changes))
          s.changes.set(ALL, found.changes)
          s.attributes = found.attributes
        } else s.changes.set(ALL, 'failed')
      }
      // A tab out of sight reads it again for when it's back, which isn't a visit.
      if (inSight()) recordVisit(s, next)
      s.pull = next
      s.listed = listed
      s.readAt = readAt
      readRuns(s, next)
      const run = scope.value
      if (run && s.changes.get(run.key) === 'failed') void changesOf(s, next, run)
      // New commits need their changes read for the commits list's ticks too.
      if (heads.moved && ticksCommits(s)) {
        s.commitsRead = false
        void readCommits(s, next)
      }
    }
    return session.value === s
  } catch {
    // What's on screen stays as it was: the next refresh tries again.
    return false
  } finally {
    s.refreshing = null
  }
}

/** What a run of commits changed, or the whole pull request (null): null when it can't be read. */
function changesOf(s: Session, pull: PullHeads, run: Scope | null): Promise<Changes | null> {
  const key = keyOf(run)
  let read = s.reads.get(key)
  if (!read) {
    s.changes.set(key, null)
    const asked: Promise<{ changes: Changes; attributes?: string | null }> = run
      ? readRange(s.gh, pull.ref.repo, run.base, run.head).then((changes) => ({ changes }))
      : readChanges(s.gh, pull)
    // A read whose place a newer one took, as a refresh after a push does, leaves the page alone and gives nothing.
    const current: Promise<Changes | null> = asked.then(
      ({ changes, attributes }) => {
        if (s.reads.get(key) !== current) return null
        if (attributes !== undefined) s.attributes = attributes
        s.changes.set(key, changes)
        return changes
      },
      () => {
        if (s.reads.get(key) !== current) return null
        s.reads.delete(key)
        s.changes.set(key, 'failed')
        return null
      },
    )
    read = current
    s.reads.set(key, read)
  }
  return read
}

/** Reads what the whole pull request changed, then its files' texts. */
async function readWhole(s: Session, pull: Pull) {
  const found = await changesOf(s, pull, null)
  if (found) await readTextsOf(s, pull, toFiles(s, found, pull.headOid), null)
}

/** The checks and conflicts of the list's copy of a pull request, as far as it has one. */
type ListStatus = Partial<Pick<Item, 'checks' | 'merge'>>
const statusOf = (item: Item | undefined): ListStatus => (item ? { checks: item.checks, merge: item.merge } : {})

/** The list's copy of the pull request a ref names, before the page says its id. */
function listCopy(ref: IssueRef): Item | undefined {
  for (const item of items.value.values()) if (item.kind === 'pr' && sameRef(itemRef(item), ref)) return item
  return undefined
}

/**
 * Reads the texts of the files a run's diff shows, or all the changes': each file's two sides, and in all the changes
 * its copy from the last visit, together, so the top of the page fills first.
 */
function readTextsOf(s: Session, pull: Pull, files: PullFile[], run: Scope | null) {
  return readTextsInto(
    s,
    pull,
    files.flatMap((file) => [
      { at: file.oldAt },
      { at: file.newAt, path: file.path },
      { at: run ? null : visitedAt(s, file) },
    ]),
  )
}

/**
 * Reads the texts not asked for yet: a small first read, so the top of the page fills first, then the rest side by
 * side. A read that fails leaves its own files unreadable, not the whole diff. A file's new side may mark it generated.
 */
async function readTextsInto(s: Session, pull: Pull, wanted: { at: string | null; path?: string }[]) {
  const fresh = wanted.filter((each): each is { at: string; path?: string } => !!each.at && !s.asked.has(each.at))
  for (const { at } of fresh) s.asked.add(at)
  s.textsTotal += fresh.length
  const reads: (typeof fresh)[] = []
  for (let start = 0, size = 24; start < fresh.length; start += size, size = BLOBS_PER_READ)
    reads.push(fresh.slice(start, start + size))
  await Promise.all(
    reads.map(async (read) => {
      const answers = await readTexts(
        s.gh,
        pull.ref.repo,
        read.map((each) => each.at),
      )
      read.forEach(({ at, path }, index) => {
        const { content, version } = answers[index]
        s.texts.set(at, content)
        if (version !== undefined) s.versions.set(at, version)
        if (path && 'text' in content && isGenerated.value(path, content.text)) s.marked.add(path)
      })
      s.textsDone += read.length
    }),
  )
}

/**
 * What each commit changed and its files' first versions, for the commits list's ticks: once a session, a commit at a
 * time, then the versions without their texts. Commits GitHub listed only some files of never read viewed whole. Stops
 * once another pull request opens.
 */
async function readCommits(s: Session, pull: Pull) {
  if (s.commitsRead) return
  s.commitsRead = true
  const firsts: string[] = []
  const coming = (at: string) => s.asked.has(at) && !s.texts.has(at)
  for (const run of pull.commits.flatMap((_, index) => runOf(pull.commits, index, index) ?? [])) {
    if (session.value !== s) return
    const found = await changesOf(s, pull, run)
    for (const file of found && !found.capped ? toFiles(s, found, run.head) : [])
      if (file.oldAt && !s.versions.has(file.oldAt) && !coming(file.oldAt)) firsts.push(file.oldAt)
  }
  if (session.value !== s) return
  for (const [at, version] of await readVersions(s.gh, pull.ref.repo, firsts)) s.versions.set(at, version)
}

// What the open session holds, as what's on screen reads it.
const current = <T>(read: (s: Session) => T, otherwise: T) =>
  computed(() => (session.value ? read(session.value) : otherwise))

export const pull = current((s) => (s.pull === 'failed' ? null : s.pull), null)
export const problem = current((s) => s.problem, null)
/** Every check on the last commit, once here, and whether they're on their way or couldn't be read. */
export const runs = current((s) => (s.runs === 'failed' ? null : s.runs), null)
export const runsState = current((s) => (s.runs === 'failed' ? 'failed' : s.runs ? 'ready' : 'loading'), 'loading')
const lastVisit = current((s) => s.lastVisit, null)
export const textsDone = current((s) => s.textsDone, 0)
export const textsTotal = current((s) => s.textsTotal, 0)

// --- Files ----------------------------------------------------------------------------------------------------------

export interface PullFile extends FileChange {
  generated: boolean
  /** The commit the diff shows it at: the head, or the last of the commits shown. */
  at: string
  /** The commit its old side is read at: where the base and the head meet, or the commit before those shown. */
  base: string
  /** Expressions of its two sides' texts, null for a side it doesn't have. */
  oldAt: string | null
  newAt: string | null
}

/** Which of the pull request's files are generated. */
const isGenerated = computed(() => generatedRules(session.value?.attributes ?? null, settings.generated))

/** Files from the base, or the commit before a run of commits, to `head`. */
function toFiles(s: Session, found: Changes, head: string): PullFile[] {
  return found.files
    .map((file) => {
      const { old, new: next } = sides(file, found.mergeBase, head)
      const generated = isGenerated.value(file.path) ?? s.marked.has(file.path)
      return { ...file, at: head, base: found.mergeBase, oldAt: old, newAt: next, generated }
    })
    .toSorted((a, b) => comparePaths(a.path, b.path))
}

// Folders before files at each level, as a file tree lists them.
function comparePaths(a: string, b: string): number {
  const pa = a.split('/')
  const pb = b.split('/')
  for (let index = 0; index < Math.min(pa.length, pb.length); index++) {
    const lastA = index === pa.length - 1
    const lastB = index === pb.length - 1
    if (pa[index] !== pb[index]) {
      if (lastA !== lastB) return lastA ? 1 : -1
      return pa[index].localeCompare(pb[index])
    }
  }
  return pa.length - pb.length
}

/** A run's files, or the whole pull request's (null): read, on their way (null), or not to be had. */
function filesOf(run: Scope | null): Read<PullFile[]> {
  const s = session.value
  const found = s?.changes.get(keyOf(run))
  if (!s || !pull.value || !found) return null
  return found === 'failed' ? 'failed' : toFiles(s, found, run?.head ?? pull.value.headOid)
}

/** Every file the pull request changes, whatever commits the diff shows. */
const allFiles = computed(() => {
  const found = filesOf(null)
  return Array.isArray(found) ? found : []
})

// --- Commits shown --------------------------------------------------------------------------------------------------

/** A run of the pull request's commits, by place in its list, from the commit before the first to the last. */
export interface Scope {
  key: string
  base: string
  head: string
  from: number
  to: number
  commits: Commit[]
}

/** The commits the diff shows, as the address names them. Null for all the changes, or for commits it can't find. */
export const scope = computed<Scope | null>(() => {
  const named = pullScope.value
  const commits = pull.value?.commits ?? []
  if (!named || !commits.length) return null
  const at = (sha: string) => commits.findIndex((commit) => commit.oid.startsWith(sha))
  let from: number
  let to: number
  const { before, last } = named
  if (before) {
    to = at(last)
    // The run starts after a commit of the pull request's, or with the first, after the commit before it.
    const after = at(before)
    from = after >= 0 ? after + 1 : commits[0].parent?.startsWith(before) ? 0 : -1
  } else from = to = at(last)
  return from < 0 || to < from ? null : runOf(commits, from, to)
})

/** A run's key, or all the changes' (null). */
const keyOf = (run: Scope | null) => run?.key ?? ALL

/** Where a run starting at the `from`th commit starts: the commit before it. A root commit has none. */
const baseOf = (commits: Commit[], from: number) => commits[from].parent ?? commits[from - 1]?.oid ?? null

/** The run of commits from the `from`th to the `to`th, or null from a root commit. */
function runOf(commits: Commit[], from: number, to: number): Scope | null {
  const base = baseOf(commits, from)
  const head = commits[to].oid
  return base ? { key: `${base}..${head}`, base, head, from, to, commits: commits.slice(from, to + 1) } : null
}

/** Shows a run of commits, from the `from`th to the `to`th, or one alone. All of them shows all the changes. */
export function showCommits(from: number, to = from) {
  const commits = pull.value?.commits ?? []
  const [first, last] = from <= to ? [from, to] : [to, from]
  if (!commits[first] || !commits[last]) return
  const base = baseOf(commits, first)
  if (!base || (first === 0 && last === commits.length - 1 && commits.length > 1)) pullScope.value = null
  else pullScope.value = { before: first === last ? null : base, last: commits[last].oid }
}
export function showAllChanges() {
  pullScope.value = null
}

/** The commits `[` and `]` show: the one before or after those shown, alone. From all the changes, the first. */
export const commitSteps = computed(() => {
  const count = pull.value?.commits.length ?? 0
  const shown = scope.value
  const previous = shown ? shown.from - 1 : -1
  const next = shown ? shown.to + 1 : 0
  return { previous: previous >= 0 ? previous : null, next: next < count ? next : null }
})
export function stepCommits(by: -1 | 1) {
  const to = by === 1 ? commitSteps.value.next : commitSteps.value.previous
  if (to !== null) showCommits(to)
}

/** The files the diff can show: the pull request's, or those the commits shown changed. */
const files = computed(() => filesOf(scope.value))

// The diff shown reads its files' texts once its files are known, whoever read them.
watch(scope, (run) => {
  const s = session.value
  if (s && pull.value) void changesOf(s, pull.value, run)
})
watch(files, (found) => {
  const s = session.value
  if (s && pull.value && Array.isArray(found)) void readTextsOf(s, pull.value, found, scope.value)
})
export const filesState = computed(() => (files.value === 'failed' ? 'failed' : files.value ? 'ready' : 'loading'))
/** Whether GitHub listed only the first files a run of commits changed, or the whole pull request (null). */
function cappedOf(run: Scope | null) {
  const found = session.value?.changes.get(keyOf(run))
  return !!found && found !== 'failed' && found.capped
}
export const filesCapped = computed(() => cappedOf(scope.value))

const listed = computed(() => (Array.isArray(files.value) ? files.value : []))
export const generatedFiles = computed(() => listed.value.filter((file) => file.generated))
export const showGenerated = computed({
  get: () => session.value?.showGenerated ?? false,
  set: (value) => {
    if (session.value) session.value.showGenerated = value
  },
})
/** Files as the tree and the diff show them: without the generated ones, unless asked for. */
const shownOf = (found: PullFile[]) => (showGenerated.value ? found : found.filter((file) => !file.generated))
export const shownFiles = computed(() => shownOf(listed.value))

/** The pull request's lines added and removed, without generated files, whatever commits the diff shows. */
export const totals = computed(() => sizeOf(allFiles.value))
/** The same for the commits shown. */
export const shownTotals = computed(() => sizeOf(listed.value))

function sizeOf(list: PullFile[]) {
  const counted = list.filter((file) => !file.generated)
  return {
    additions: counted.reduce((sum, file) => sum + file.additions, 0),
    deletions: counted.reduce((sum, file) => sum + file.deletions, 0),
    files: counted.length,
    left: list.length - counted.length,
  }
}

// --- Diffs ----------------------------------------------------------------------------------------------------------

const EMPTY: Content = { text: '' }

/** A side's text: here, on its way (undefined), or empty for a side the file doesn't have. */
export function contentOf(at: string | null): Content | undefined {
  return at === null ? EMPTY : session.value?.texts.get(at)
}

/**
 * The file's diff, once both its sides are in. Null while they load. Otherwise why it can't be shown: a binary file, a
 * text too long for GitHub to give, or a side GitHub couldn't read.
 */
export function diffOf(file: PullFile): FileDiff | null | 'binary' | 'tooBig' | 'failed' {
  const s = session.value
  const old = contentOf(file.oldAt)
  const next = contentOf(file.newAt)
  if (!s || !old || !next) return null
  if ('binary' in old || 'binary' in next) return 'binary'
  if ('tooBig' in old || 'tooBig' in next) return 'tooBig'
  if (!('text' in old) || !('text' in next)) return 'failed'
  const visit = visitOf(file)
  if (visit === 'loading') return null
  const key = `${file.oldAt}|${file.newAt}|${settings.ignoreSpace}|${!!visit}`
  let diff = s.diffs.get(key)
  if (!diff) {
    diff = diffFiles({ old: old.text, new: next.text, ignoreSpace: settings.ignoreSpace, visited: visit?.text })
    s.diffs.set(key, diff)
  }
  return diff
}

// --- Since the last visit -------------------------------------------------------------------------------------------

/** Whether the marks since the last visit show: there was one, and the diff shows the whole pull request. */
const marking = computed(() => !!lastVisit.value && !scope.value)

/** A file as it was at the last visit, when that visit saw an earlier head than now. */
function visitedAt(s: Session, file: { path: string }): string | null {
  const head = s.lastVisit?.head
  const now = s.pull && s.pull !== 'failed' ? s.pull.headOid : null
  return head && head !== now ? blobAt(head, file.path) : null
}

/**
 * The file's new side as the last visit saw it: its text, null when it wasn't there. 'loading' while it's read, and
 * undefined when there are no marks or it can't be told.
 */
function visitOf(file: PullFile): { text: string | null } | 'loading' | undefined {
  const s = session.value
  if (!s || !marking.value) return undefined
  const at = visitedAt(s, file)
  // The same head as now: whatever the file says now was seen.
  const then = at ? s.texts.get(at) : file.newAt ? contentOf(file.newAt) : { missing: true as const }
  if (!then) return 'loading'
  if ('missing' in then) return { text: null }
  return 'text' in then ? { text: then.text } : undefined
}

/** Changed since the last visit: the file is new since, gone since, or its text differs from then. */
export function freshFile(file: PullFile): boolean {
  const visit = visitOf(file)
  if (!visit || visit === 'loading') return false
  const now = file.newAt ? contentOf(file.newAt) : { text: null }
  return !!now && 'text' in now && now.text !== visit.text
}

/** When something counts as new since the last visit. */
export const markTime = computed(() => lastVisit.value?.at ?? null)
export const isFresh = (time: string) => markTime.value !== null && Date.parse(time) > markTime.value

/**
 * The commits after the last visit's head: all of them when that head is gone, as after a force push. When the head
 * may be past the commits listed, which are a long pull request's first 100, those newer than the visit.
 */
const freshCommits = computed(() => {
  const read = pull.value
  const head = lastVisit.value?.head
  if (!read || !head) return new Set<string>()
  const { commits } = read
  const at = commits.findIndex((commit) => commit.oid === head)
  if (at < 0 && read.commitCount > commits.length)
    return new Set(commits.filter((commit) => isFresh(commit.at)).map((commit) => commit.oid))
  return new Set(commits.slice(at + 1).map((commit) => commit.oid))
})
export const freshCommit = (commit: Commit) => freshCommits.value.has(commit.oid)
/** Where the new commits start, when some came since the last visit and not all of them. */
export const firstFreshCommit = computed(() => {
  const count = freshCommits.value.size
  const total = pull.value?.commits.length ?? 0
  return count && count < total ? total - count : null
})

/** What's new since the last visit: commits, comments (replies in threads too), and files. Null on a first visit. */
export const freshCounts = computed(() => {
  if (!pull.value || markTime.value === null) return null
  const talk = shownEntries.value.filter((entry) => isPost(entry) && isFresh(entry.at))
  const replies = shownThreads.value
    .flatMap((thread) => thread.comments.slice(1))
    .filter((comment) => isFresh(comment.createdAt))
  return {
    commits: freshCommits.value.size,
    comments: talk.length + replies.length,
    files: allFiles.value.filter((file) => (showGenerated.value || !file.generated) && freshFile(file)).length,
  }
})

// --- Viewed ---------------------------------------------------------------------------------------------------------

const seenNow = computed(() => (openPull.value ? seenAll[refKey(openPull.value)] : undefined))

/** A file's version at a `commit:path`, NO_FILE for a side it doesn't have, or undefined while it isn't known. */
const versionAt = (s: Session, at: string | null) => (at === null ? NO_FILE : s.versions.get(at))
/** A file's version as a diff leaves it. */
const lastVersion = (file: PullFile) => (file.newAt ? file.blob : NO_FILE)

/** The pull request's own files, by path, and by the path a renamed one came from: all the changes start them. */
const wholeFiles = computed(() => {
  const byPath = new Map<string, PullFile>()
  for (const file of allFiles.value) {
    byPath.set(file.path, file)
    if (file.oldPath) byPath.set(file.oldPath, file)
  }
  return byPath
})

/**
 * A file's change in a run's diff, from its first version to its last, or in all the changes (null), from BASE. Null
 * while a run's first version isn't known.
 */
function changeOf(s: Session, file: PullFile, run: Scope | null) {
  const from = run ? versionAt(s, file.oldAt) : BASE
  return from === undefined ? null : { from, to: lastVersion(file) }
}

/** A file's version at the pull request's base, once known. */
function baseVersion(s: Session, file: PullFile) {
  const whole = wholeFiles.value.get(file.path)
  return whole && versionAt(s, whole.oldAt)
}

const viewedOnGitHub = computed(() => new Map(pull.value?.files.map((file) => [file.path, file.viewedOnGitHub])))

/** GitHub's own tick on a file, which is on all the changes: VIEWED, DISMISSED once a change took it off, or none. */
function gitHubOf(file: PullFile) {
  const whole = wholeFiles.value.get(file.path)
  return whole && { state: viewedOnGitHub.value.get(whole.path), at: lastVersion(whole) }
}

// A file's ticks by path. Only a list is ticks: the record's object has names of its own, like `constructor`.
function ticksAt(record: Record<string, string[]> | undefined, path: string | null | undefined): string[] {
  const ticks = record && path ? record[path] : undefined
  return Array.isArray(ticks) ? ticks : []
}

/** A file's own ticks, under its path in a diff. */
function ownOf(file: PullFile): FileTicks {
  const seen = seenNow.value
  return { ticked: ticksAt(seen?.ticked, file.path), unticked: ticksAt(seen?.unticked, file.path) }
}

/** The ticks a file reads by besides its own: those under its names before or after a rename, and GitHub's own tick. */
function othersOf(file: PullFile): string[] {
  const whole = wholeFiles.value.get(file.path)
  const names = new Set([file.oldPath, whole?.path, whole?.oldPath])
  names.delete(file.path)
  const ticks = [...names].flatMap((name) => ticksAt(seenNow.value?.ticked, name))
  const onGitHub = gitHubOf(file)
  return onGitHub?.state === 'VIEWED' ? [...ticks, changeKey(BASE, onGitHub.at)] : ticks
}

/** How a file's change in a run's diff, or all the changes' (null), reads, or undefined while that can't be told. */
function readingOf(file: PullFile, run: Scope | null): Reading | undefined {
  const s = session.value
  const change = s && changeOf(s, file, run)
  if (!s || !change) return undefined
  return readFile(ownOf(file), othersOf(file), change, baseVersion(s, file), gitHubOf(file)?.state === 'DISMISSED')
}

const readings = computed(() => new Map(listed.value.map((file) => [file.path, readingOf(file, scope.value)])))

/** How a file of the diff shown reads: viewed, viewed but changed since (so no longer ticked), or not. */
export const viewedState = (file: PullFile): Reading => readings.value.get(file.path) ?? null
/** Whether a file of the diff shown takes a tick: once its first version is known, in a run of commits. */
export const canTick = (file: PullFile) => readings.value.get(file.path) !== undefined

/** Ticks files of the diff shown viewed, or unticks them. A tick on a commit starts the commits list's reads. */
export function setViewed(picked: PullFile[], on: boolean) {
  const s = session.value
  const seen = seenNow.value
  const run = scope.value
  if (!s || !seen) return
  for (const file of picked) {
    const change = changeOf(s, file, run)
    if (!change) continue
    const next = tickFile(ownOf(file), othersOf(file), change, baseVersion(s, file), on)
    keep(seen.ticked, file.path, next.ticked)
    keep(seen.unticked, file.path, next.unticked)
  }
  if (on && run && pull.value) void readCommits(s, pull.value)
}

/** Unticks files of the diff shown when they're all viewed, and ticks them otherwise. */
export const toggleViewed = (picked: PullFile[]) => setViewed(picked, !allViewed(picked))

// A file without ticks leaves no trace.
function keep(record: Record<string, string[]>, path: string, ticks: readonly string[]) {
  if (ticks.length) record[path] = [...ticks]
  else delete record[path]
}

/** Whether files all read viewed by `read`. None isn't viewed. */
const allOf = (found: PullFile[], read: (file: PullFile) => Reading | undefined) =>
  found.length > 0 && found.every((file) => read(file) === 'viewed')

/** Whether files of the diff shown all read viewed, as a folder's. */
export const allViewed = (found: PullFile[]) => allOf(found, viewedState)

/** How many of the files shown are viewed, of how many, once there are some. */
export const viewed = computed(() => {
  const of = shownFiles.value.length
  return of ? { n: shownFiles.value.filter((file) => viewedState(file) === 'viewed').length, of } : null
})

/** Whether a run's diff, or all the changes', reads viewed whole: every file it shows, and none GitHub left out. */
function viewedThrough(run: Scope | null) {
  const found = filesOf(run)
  return Array.isArray(found) && !cappedOf(run) && allOf(shownOf(found), (file) => readingOf(file, run))
}

/** Whether all the changes are viewed, and the commits viewed whole, of those whose changes are read. */
export const viewedWhole = computed(() => {
  const commits = pull.value?.commits ?? []
  const done = commits.filter((_, index) => {
    const run = runOf(commits, index, index)
    return !!run && viewedThrough(run)
  })
  return { all: viewedThrough(null), commits: new Set(done.map((commit) => commit.oid)) }
})

/** One file at a time, or all in one scroll: this pull request's choice, or the setting. */
export const fileMode = computed<FileMode>(() => seenNow.value?.files ?? settings.files)
export function setFileMode(mode: FileMode) {
  if (seenNow.value) seenNow.value.files = mode
}

// --- The conversation and its threads -------------------------------------------------------------------------------

/** The conversation, without the bots' posts Settings hide. */
export const shownEntries = computed(() =>
  (pull.value?.entries ?? []).filter((entry) => !isPost(entry) || postShown(entry.post.author)),
)
/** The review threads, without the bots' ones Settings hide. */
const shownThreads = computed(() =>
  (pull.value?.threads ?? []).filter((thread) => postShown(thread.comments[0]?.author)),
)

// A thread's line is a line of the file as the pull request leaves it. In a run of commits, threads show on the files
// those commits leave as they are now, on the new side; elsewhere their lines would point at other code.
export const threadsByPath = computed(() => {
  const map = new Map<string, ReviewThread[]>()
  const now = scope.value ? new Map(allFiles.value.map((file) => [file.path, file.blob])) : null
  const shown = now && new Map(listed.value.map((file) => [file.path, file.blob]))
  for (const thread of shownThreads.value) {
    if (shown && (thread.side !== 'new' || !shown.has(thread.path) || shown.get(thread.path) !== now.get(thread.path)))
      continue
    map.set(thread.path, [...(map.get(thread.path) ?? []), thread])
  }
  return map
})

/** Makes a thread's file one the diff shows: all the changes when the commits shown hide it, generated files too. */
export function showThreadsFile(thread: ReviewThread) {
  if (scope.value && !threadsByPath.value.get(thread.path)?.includes(thread)) showAllChanges()
  showGenerated.value ||= allFiles.value.some((file) => file.path === thread.path && file.generated)
}

const inSight = () => globalThis.document?.visibilityState !== 'hidden'

/** Where the list's copy of the open pull request and the page differ in checks and conflicts. */
function differences(item: Item, shown: Pull) {
  return { checks: item.checks !== shown.checks, merge: item.merge !== null && item.merge !== shown.merge }
}

/**
 * The list's copy of the open pull request when it says the page is behind, as after a new comment, a push, or checks
 * that finished: null when it doesn't, or when there's no copy or no page yet. The checks and conflicts the list reads
 * now and then can be older than the page's, so only those that changed in the list since the page's read started
 * count, or, without a copy then, those a sync since brought.
 */
const behindBy = computed(() => {
  const s = session.value
  const shown = pull.value
  const item = shown && items.value.get(shown.id)
  if (!s || !shown || !item) return null
  const differ = differences(item, shown)
  const known = s.listed
  const news = (field: keyof ListStatus) =>
    differ[field] && (field in known ? item[field] !== known[field] : (status.value.syncedAt ?? 0) > s.readAt)
  const behind = item.updatedAt > shown.updatedAt || (item.state === 'open' && (news('checks') || news('merge')))
  return behind ? `${shown.id} ${item.updatedAt} ${item.checks} ${item.merge}` : null
})

// Where a copy agrees with the page, as one that caught up with it, is what the next copies' news count from.
watch(
  () => pull.value && items.value.get(pull.value.id),
  (item) => {
    const s = session.value
    const shown = pull.value
    if (!s || !item || !shown) return
    const differ = differences(item, shown)
    const agreed: ListStatus = {
      ...(differ.checks ? {} : { checks: item.checks }),
      ...(differ.merge ? {} : { merge: item.merge }),
    }
    const known = { ...s.listed, ...agreed }
    if (JSON.stringify(known) !== JSON.stringify(s.listed)) s.listed = known
  },
)

/** Reads the open pull request again when the list says it's behind, once its tab is in sight. */
function catchUp() {
  const s = session.value
  const copy = behindBy.value
  if (!s || !copy || copy === s.readFor || !inSight()) return
  s.readFor = copy
  void refreshPull().then((done) => {
    if (!done && s.readFor === copy) s.readFor = null
  })
}

// Every sync reads the list's copy again: whichever comes first, the page or the copy, they're compared once both are
// here, and again after each sync while a read for the copy failed.
watch([behindBy, () => status.value.syncedAt], catchUp)
globalThis.document?.addEventListener('visibilitychange', catchUp)

// Opens the pull request the address names, once a workspace can read it.
watch(
  [() => openPull.value && refKey(openPull.value), client],
  () => {
    if (openPull.value && client.value) void open(openPull.value, client.value)
    else session.value = null
  },
  { immediate: true },
)
