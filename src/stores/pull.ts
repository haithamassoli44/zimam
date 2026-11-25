// The open pull request: what it is, what it changed, and what the reader saw of it before.
import { computed, reactive, shallowReactive, shallowRef, watch } from 'vue'

import { seenKey } from '@/lib/cache'
import {
  blobAt,
  readChanges,
  readRange,
  readTexts,
  sides,
  TEXTS_PER_READ,
  type Changes,
  type Content,
  type FileChange,
} from '@/lib/changes'
import { readCheckRuns, type CheckRuns } from '@/lib/checks'
import { diffFiles, type FileDiff } from '@/lib/diff'
import { generatedRules } from '@/lib/generated'
import type { GitHub } from '@/lib/github'
import { isPost, readPull, type Commit, type Pull, type ReviewThread } from '@/lib/pull'
import { refKey, type IssueRef } from '@/lib/refs'
import type { FileMode } from '@/types'

import { client } from './data'
import { activeWorkspace, postShown, settings } from './settings'
import { openPull, pullScope } from './view'

// --- What the reader saw: visits, viewed files, and a pull request's own file mode ----------------------------------

interface Seen {
  /** The last visit: when, and the head commit then. */
  at: number
  head: string
  /** Viewed files, by path, with the blob that was viewed, or UNTICKED. */
  viewed: Record<string, string>
  files?: FileMode
}

/** A file the reader unticked here, whatever GitHub says. */
const UNTICKED = '-'
// The pull requests a workspace remembers, the latest visited first.
const REMEMBERED = 500

function readSeen(): Record<string, Seen> {
  try {
    return JSON.parse(localStorage.getItem(seenKey(activeWorkspace.value?.id ?? '')) ?? '{}')
  } catch {
    return {}
  }
}
const seenAll = reactive<Record<string, Seen>>(readSeen())
watch(
  () => activeWorkspace.value?.id,
  () => {
    for (const key of Object.keys(seenAll)) delete seenAll[key]
    Object.assign(seenAll, readSeen())
  },
)
watch(seenAll, () => {
  const kept = Object.entries(seenAll)
    .toSorted(([, a], [, b]) => b.at - a.at)
    .slice(0, REMEMBERED)
  try {
    localStorage.setItem(seenKey(activeWorkspace.value?.id ?? ''), JSON.stringify(Object.fromEntries(kept)))
  } catch {
    // Without storage, what was seen lasts until the tab closes.
  }
})

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
  /** The repository's .gitattributes at the head, for generated files. */
  attributes: string | null
  /** File texts by `commit:path`, and those asked for, here or on their way. */
  texts: Map<string, Content>
  asked: Set<string>
  textsDone: number
  textsTotal: number
  /** Files whose new side's text marks them generated, by path. */
  marked: Set<string>
  showGenerated: boolean
  diffs: Map<string, FileDiff>
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
    attributes: null,
    texts: shallowReactive(new Map()),
    asked: new Set(),
    textsDone: 0,
    textsTotal: 0,
    marked: shallowReactive(new Set()),
    showGenerated: false,
    diffs: new Map(),
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
  let pull: Pull
  try {
    pull = await readPull(gh, ref)
  } catch (error) {
    s.problem = error instanceof Error ? error.message : 'failed'
    s.pull = 'failed'
    return
  }
  const key = refKey(ref)
  const before = seenAll[key]
  if (!sessionVisits.has(key)) sessionVisits.set(key, before ? { at: before.at, head: before.head } : null)
  s.lastVisit = sessionVisits.get(key) ?? null
  seenAll[key] = { ...before, viewed: before?.viewed ?? {}, at: Date.now(), head: pull.headOid }
  s.pull = pull
  if (pull.checks)
    readCheckRuns(gh, pull).then(
      (found) => (s.runs = found),
      () => (s.runs = 'failed'),
    )
  // What the address shows first, then the whole pull request, which the marks since the last visit count in.
  if (scope.value) void readRun(s, pull, scope.value)
  void readRun(s, pull, null)
}

export function reloadPull() {
  if (openPull.value && client.value) void open(openPull.value, client.value)
}

/** Reads what a run of commits changed, or the whole pull request (null), then its files' texts. Once a session. */
async function readRun(s: Session, pull: Pull, run: Scope | null) {
  const key = run?.key ?? ALL
  if (s.changes.has(key)) return
  s.changes.set(key, null)
  let found: Changes
  try {
    if (run) found = await readRange(s.gh, pull.ref.repo, run.base, run.head)
    else {
      const answer = await readChanges(s.gh, pull)
      s.attributes = answer.attributes
      found = answer.changes
    }
  } catch {
    s.changes.set(key, 'failed')
    return
  }
  s.changes.set(key, found)
  // Each file's two sides, and for the whole pull request its copy from the last visit, together, so the top of the
  // page fills first.
  const files = toFiles(s, found, run?.head ?? pull.headOid)
  await readTextsInto(
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
  for (let start = 0, size = 24; start < fresh.length; start += size, size = TEXTS_PER_READ)
    reads.push(fresh.slice(start, start + size))
  await Promise.all(
    reads.map(async (read) => {
      const answers: Content[] = await readTexts(
        s.gh,
        pull.ref.repo,
        read.map((each) => each.at),
      ).catch(() => read.map(() => ({ failed: true }) as const))
      read.forEach(({ at, path }, index) => {
        const content = answers[index]
        s.texts.set(at, content)
        if (path && 'text' in content && isGenerated.value(path, content.text)) s.marked.add(path)
      })
      s.textsDone += read.length
    }),
  )
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
      return { ...file, at: head, oldAt: old, newAt: next, generated }
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
  const found = s?.changes.get(run?.key ?? ALL)
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
  if (from < 0 || to < from) return null
  const base = baseOf(commits, from)
  if (!base) return null
  const key = `${base}..${commits[to].oid}`
  return { key, base, head: commits[to].oid, from, to, commits: commits.slice(from, to + 1) }
})

/** Where a run starting at the `from`th commit starts: the commit before it. A root commit has none. */
const baseOf = (commits: Commit[], from: number) => commits[from].parent ?? commits[from - 1]?.oid ?? null

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

watch(scope, (run) => {
  const s = session.value
  if (run && s && pull.value) void readRun(s, pull.value, run)
})

/** The files the diff can show: the pull request's, or those the commits shown changed. */
const files = computed(() => filesOf(scope.value))
export const filesState = computed(() => (files.value === 'failed' ? 'failed' : files.value ? 'ready' : 'loading'))
/** GitHub listed only the first files of the changes shown. */
export const filesCapped = computed(() => {
  const found = session.value?.changes.get(scope.value?.key ?? ALL)
  return !!found && found !== 'failed' && found.capped
})

const listed = computed(() => (Array.isArray(files.value) ? files.value : []))
export const generatedFiles = computed(() => listed.value.filter((file) => file.generated))
export const showGenerated = computed({
  get: () => session.value?.showGenerated ?? false,
  set: (value) => {
    if (session.value) session.value.showGenerated = value
  },
})
/** The files the tree and the diff show. */
export const shownFiles = computed(() =>
  showGenerated.value ? listed.value : listed.value.filter((file) => !file.generated),
)

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

/** Whether files take viewed ticks: a tick is for a file as the whole pull request leaves it, as on GitHub. */
export const ticking = computed(() => !scope.value)

type ViewedState = 'viewed' | 'changed' | null

const viewedOnGitHub = computed(() => new Map(pull.value?.files.map((file) => [file.path, file.viewedOnGitHub])))

/** Viewed, viewed but changed since (so no longer ticked), or not. GitHub's own tick counts too. */
export function viewedState(file: PullFile): ViewedState {
  if (!ticking.value) return null
  const blob = seenNow.value?.viewed[file.path]
  if (blob === UNTICKED) return null
  if (blob) return blob === file.blob ? 'viewed' : 'changed'
  const onGitHub = viewedOnGitHub.value.get(file.path)
  if (onGitHub === 'VIEWED') return 'viewed'
  if (onGitHub === 'DISMISSED') return 'changed'
  return null
}

export function toggleViewed(file: PullFile) {
  const seen = seenNow.value
  if (!seen || !ticking.value) return
  seen.viewed[file.path] = viewedState(file) === 'viewed' ? UNTICKED : file.blob
}

/** How many of the files shown are viewed, of how many, or null where files take no ticks. */
export const viewed = computed(() =>
  ticking.value
    ? { n: shownFiles.value.filter((file) => viewedState(file) === 'viewed').length, of: shownFiles.value.length }
    : null,
)

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

// Opens the pull request the address names, once a workspace can read it.
watch(
  [() => openPull.value && refKey(openPull.value), client],
  () => {
    if (openPull.value && client.value) void open(openPull.value, client.value)
    else session.value = null
  },
  { immediate: true },
)
