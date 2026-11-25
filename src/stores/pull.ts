// PROTOTYPE: the pull request page's state. Not reviewed for production.
import { computed, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'

import { blobAt, sides, type Changes, type Content, type FileChange } from '@/lib/changes'
import { RUN_STATES, type CheckRuns } from '@/lib/checks'
import { diffFiles, type FileDiff } from '@/lib/diff'
import { attributeRules, generatedByPath, generatedText, patternTest } from '@/lib/generated'
import { forgetTokens } from '@/lib/highlight'
import { isPost, type Pull, type ReviewThread } from '@/lib/pull'
import { refKey, type IssueRef } from '@/lib/refs'
import type { FileMode } from '@/types'

import { checkRuns, loaded, pullChanges, pullRange, pullRequest, pullTexts } from './data'
import { activeWorkspace, postLook, settings } from './settings'
import { openPull, pullScope } from './view'

// --- Prototype switches ---------------------------------------------------------------------------------------------

export const THREAD_LOOKS = ['inline', 'margin', 'column'] as const
export type ThreadLook = (typeof THREAD_LOOKS)[number]

const PROTO_KEY = 'zimam:proto'
function readProto(): { threads: ThreadLook } {
  try {
    const raw = JSON.parse(localStorage.getItem(PROTO_KEY) ?? '{}')
    return { threads: THREAD_LOOKS.includes(raw.threads) ? raw.threads : 'inline' }
  } catch {
    return { threads: 'inline' }
  }
}
export const proto = reactive(readProto())
watch(proto, () => {
  try {
    localStorage.setItem(PROTO_KEY, JSON.stringify(proto))
  } catch {
    // Without storage, the switches last until the tab closes.
  }
})

// --- What the reader saw: visits, viewed files, and a pull request's own file mode ----------------------------------

interface Seen {
  /** The last visit: when, and the head commit then. */
  at: number
  head: string
  /** Viewed files, by path, with the blob that was viewed. */
  viewed: Record<string, string>
  files?: FileMode
}

const seenKey = () => `zimam:seen:${activeWorkspace.value?.id ?? ''}`
function readSeen(): Record<string, Seen> {
  try {
    return JSON.parse(localStorage.getItem(seenKey()) ?? '{}')
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
  try {
    localStorage.setItem(seenKey(), JSON.stringify(seenAll))
  } catch {
    // As above.
  }
})

// --- Loading --------------------------------------------------------------------------------------------------------

export const pull = shallowRef<Pull | null>(null)
export const problem = ref<string | null>(null)
export const changes = shallowRef<Changes | null>(null)
export const changesProblem = ref<string | null>(null)
/** File texts by `commit:path`. */
export const texts = shallowReactive(new Map<string, Content>())
export const textsDone = ref(0)
export const textsTotal = ref(0)

/** Every check on the last commit, read with the pull request. */
export const runs = shallowRef<CheckRuns | null>(null)
export const runsFailed = ref(false)
/** The checks grouped by how they ended, the ones that need a look first. */
export const runGroups = computed(() =>
  RUN_STATES.map((state) => ({ state, runs: runs.value?.runs.filter((run) => run.state === state) ?? [] })).filter(
    (group) => group.runs.length,
  ),
)

/** The visit before this one, which the marks count from. Null on a first visit. */
const lastVisit = ref<{ at: number; head: string } | null>(null)
// The visit before this session's first look at each pull request. Reading one again in the session, or reloading the
// workspace, keeps counting from there.
const sessionVisits = new Map<string, { at: number; head: string } | null>()
/** PROTOTYPE: a pretend last visit, at one of the pull request's commits, to show the marks. */
export const pretend = ref<string | null>(null)

let ticket = 0

async function load(which: IssueRef) {
  const mine = ++ticket
  pull.value = null
  problem.value = null
  changes.value = null
  changesProblem.value = null
  texts.clear()
  textsDone.value = 0
  textsTotal.value = 0
  pretend.value = null
  runs.value = null
  runsFailed.value = false
  markedGenerated.clear()
  ranges.clear()
  asked.clear()
  diffs.clear()
  forgetTokens()
  let answer: Pull
  try {
    answer = await pullRequest(which)
  } catch (error) {
    if (mine === ticket) problem.value = error instanceof Error ? error.message : 'failed'
    return
  }
  if (mine !== ticket) return
  const key = refKey(which)
  const before = seenAll[key]
  if (!sessionVisits.has(key)) sessionVisits.set(key, before ? { at: before.at, head: before.head } : null)
  lastVisit.value = sessionVisits.get(key) ?? null
  seenAll[key] = { ...before, viewed: before?.viewed ?? {}, at: Date.now(), head: answer.headOid }
  pull.value = answer
  if (answer.checks)
    checkRuns(answer).then(
      (found) => mine === ticket && (runs.value = found),
      () => mine === ticket && (runsFailed.value = true),
    )

  try {
    const found = await pullChanges(which.repo, {
      number: which.number,
      baseOid: answer.baseOid,
      headOid: answer.headOid,
      changedFiles: answer.changedFiles,
    })
    if (mine !== ticket) return
    changes.value = found
    // Each file's two sides and its copy from the last visit, together, so the top of the page fills first.
    await readInto(
      which.repo,
      files.value.flatMap((file) =>
        [file.oldAt, file.newAt, visitedAt(file)].filter((expression) => expression !== null),
      ),
      mine,
    )
  } catch (error) {
    if (mine === ticket) changesProblem.value = error instanceof Error ? error.message : 'failed'
  }
}

async function readInto(repo: string, wanted: string[], mine: number) {
  const missing = wanted.filter((expression) => !texts.has(expression))
  textsTotal.value += missing.length
  // A small first batch, so the top of the page fills first, then the rest side by side.
  const batches: string[][] = []
  for (let start = 0, size = 24; start < missing.length; start += size, size = 100)
    batches.push(missing.slice(start, start + size))
  await Promise.all(
    batches.map(async (batch) => {
      // A batch that fails leaves its files unreadable, not the whole diff.
      const answers: Content[] = await pullTexts(repo, batch).catch(() => batch.map(() => ({ failed: true }) as const))
      if (mine !== ticket) return
      batch.forEach((expression, index) => {
        texts.set(expression, answers[index])
        markIfGenerated(expression, answers[index])
      })
      textsDone.value += batch.length
    }),
  )
}

/** The head the marks count from: the pretend visit, or the real one. */
const markHead = computed(() => pretend.value ?? lastVisit.value?.head ?? null)

/** A file as it was at the last visit, when that visit saw an earlier head than now. */
function visitedAt(file: { path: string }): string | null {
  const head = markHead.value
  return head && pull.value && head !== pull.value.headOid ? blobAt(head, file.path) : null
}

/** Reads each file's copy from the last visit, when a pretend visit moves it. */
async function loadVisited(mine: number) {
  const current = pull.value
  if (!current) return
  await readInto(
    current.ref.repo,
    files.value.flatMap((file) => visitedAt(file) ?? []),
    mine,
  )
}

export function reloadPull() {
  if (openPull.value) void load(openPull.value)
}

// --- Files ----------------------------------------------------------------------------------------------------------

export interface PullFile extends FileChange {
  generated: boolean
  /** Expressions of its two sides' texts. */
  oldAt: string | null
  newAt: string | null
}

const customTests = computed(() => settings.generated.map(patternTest))

// Files whose path doesn't tell but whose head text marks them generated, noted as the texts come in. The list changes
// only when one turns up, not with every batch of texts.
const markedGenerated = shallowReactive(new Set<string>())
// Any side's text counts: the head's, or the last commit of the run of commits shown.
function markIfGenerated(expression: string, content: Content) {
  if (!('text' in content)) return
  const path = expression.slice(expression.indexOf(':') + 1)
  if (generatedText(path, content.text)) markedGenerated.add(path)
}

/** Files from the base, or the commit before a run of commits, to `head`. The head's .gitattributes speaks for all. */
function toFiles(found: Changes, head: string): PullFile[] {
  const rules = attributeRules(changes.value?.attributes ?? null)
  return found.files
    .map((file) => {
      const { old, new: next } = sides(file, found.mergeBase, head)
      const byPath = generatedByPath(file.path, rules, customTests.value)
      return { ...file, oldAt: old, newAt: next, generated: byPath ?? markedGenerated.has(file.path) }
    })
    .toSorted((a, b) => comparePaths(a.path, b.path))
}

/** Every file the pull request changes, whatever commits the diff shows. */
const allFiles = computed<PullFile[]>(() =>
  changes.value && pull.value ? toFiles(changes.value, pull.value.headOid) : [],
)

// --- Commits shown ----------------------------------------------------------------------------------------------------

/** A run of the pull request's commits, by place in its list, from the commit before the first to the last. */
export interface Scope {
  key: string
  base: string
  head: string
  from: number
  to: number
}

/** The commits the diff shows, as the address names them. Null for all the changes, or for commits it can't find. */
export const scope = computed<Scope | null>(() => {
  const named = pullScope.value
  const commits = pull.value?.commits ?? []
  if (!named || !commits.length) return null
  const at = (sha: string) => commits.findIndex((commit) => commit.oid.startsWith(sha))
  let from: number
  let to: number
  if (named.includes('..')) {
    const [before, last] = named.split('..')
    to = at(last)
    // The run starts after a commit of the pull request's, or with the first, after the commit before it.
    const after = at(before)
    from = after >= 0 ? after + 1 : commits[0].parent?.startsWith(before) ? 0 : -1
  } else from = to = at(named)
  if (from < 0 || to < from) return null
  const base = commits[from].parent ?? commits[from - 1]?.oid
  if (!base) return null
  return { key: `${base}..${commits[to].oid}`, base, head: commits[to].oid, from, to }
})

/** Shows a run of commits, from the `from`th to the `to`th, or one alone. All of them shows all the changes. */
export function showCommits(from: number, to = from) {
  const commits = pull.value?.commits ?? []
  const [first, last] = from <= to ? [from, to] : [to, from]
  if (!commits[first] || !commits[last]) return
  if (first === 0 && last === commits.length - 1 && commits.length > 1) pullScope.value = null
  else if (first === last) pullScope.value = commits[first].oid
  else pullScope.value = `${commits[first].parent ?? commits[first - 1]?.oid}..${commits[last].oid}`
}
export function showAllChanges() {
  pullScope.value = null
}

/** The commit before or after those shown, alone. From all the changes, the first commit comes next. */
export function stepCommits(by: -1 | 1) {
  const count = pull.value?.commits.length ?? 0
  const shown = scope.value
  const next = !shown ? (by === 1 ? 0 : -1) : by === 1 ? shown.to + 1 : shown.from - 1
  if (next >= 0 && next < count) showCommits(next)
}

// What runs of commits changed, by their key, read when first shown. Each lasts while the pull request is open.
const ranges = shallowReactive(new Map<string, Changes | 'failed'>())
const asked = new Set<string>()
watch(scope, async (shown) => {
  const current = pull.value
  if (!shown || !current || asked.has(shown.key)) return
  asked.add(shown.key)
  const mine = ticket
  try {
    const found = await pullRange(current.ref.repo, shown.base, shown.head)
    if (mine !== ticket) return
    ranges.set(shown.key, found)
    await readInto(
      current.ref.repo,
      toFiles(found, shown.head).flatMap((file) => [file.oldAt, file.newAt].filter((at) => at !== null)),
      mine,
    )
  } catch {
    if (mine === ticket) ranges.set(shown.key, 'failed')
  }
})

/** What the shown commits changed: read, still on its way (null), or not to be had. */
const scopeChanges = computed(() => (scope.value ? (ranges.get(scope.value.key) ?? null) : null))

/** The files the diff can show: the pull request's, or those the commits shown changed. */
export const files = computed<PullFile[]>(() => {
  const shown = scope.value
  if (!shown) return allFiles.value
  const found = scopeChanges.value
  return found && found !== 'failed' ? toFiles(found, shown.head) : []
})

/** Whether the diff's files are still on their way, or couldn't be read. */
export const filesState = computed<'loading' | 'failed' | 'ready'>(() => {
  if (scope.value) return scopeChanges.value === 'failed' ? 'failed' : scopeChanges.value ? 'ready' : 'loading'
  return changesProblem.value ? 'failed' : changes.value ? 'ready' : 'loading'
})
/** GitHub listed only the first files the shown commits changed. */
export const filesCapped = computed(() => {
  const found = scopeChanges.value
  return !!found && found !== 'failed' && !!found.capped
})

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

export const showGenerated = ref(false)
watch(openPull, () => (showGenerated.value = false))

export const generatedFiles = computed(() => files.value.filter((file) => file.generated))
/** The files the tree and the diff show. */
export const shownFiles = computed(() =>
  showGenerated.value ? files.value : files.value.filter((file) => !file.generated),
)

/** The pull request's lines added and removed, without generated files, whatever commits the diff shows. */
export const totals = computed(() => sizeOf(allFiles.value))
/** The same for the commits shown. */
export const shownTotals = computed(() => sizeOf(files.value))

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

export function contentOf(at: string | null): Content | undefined {
  return at === null ? { text: '' } : texts.get(at)
}

const diffs = new Map<string, FileDiff>()

/**
 * The file's diff, once both its sides are in. Null while they load. Otherwise why it can't be shown: a binary file, a
 * text too long for GitHub to give, or a side GitHub couldn't read.
 */
export function diffOf(file: PullFile): FileDiff | null | 'binary' | 'tooBig' | 'failed' {
  const old = contentOf(file.oldAt)
  const next = contentOf(file.newAt)
  if (!old || !next) return null
  if ('binary' in old || 'binary' in next) return 'binary'
  if ('tooBig' in old || 'tooBig' in next) return 'tooBig'
  if (!('text' in old) || !('text' in next)) return 'failed'
  // A run of commits shows its own changes, with no marks from the last visit.
  const marked = !scope.value
  const at = marked ? visitedAt(file) : null
  let visited: string | null | undefined
  if (at) {
    const then = texts.get(at)
    if (!then) return null
    // Not there then: every change is new. A copy that couldn't be read says nothing either way.
    visited = 'text' in then ? then.text : 'missing' in then ? null : undefined
  } else if (marked && markHead.value) visited = next.text
  const key = `${file.oldAt}|${file.newAt}|${settings.ignoreSpace}|${marked && markHead.value}`
  let diff = diffs.get(key)
  if (!diff) {
    diff = diffFiles({
      old: file.status === 'added' ? null : old.text,
      new: file.status === 'removed' ? null : next.text,
      ignoreSpace: settings.ignoreSpace,
      visited,
    })
    diffs.set(key, diff)
  }
  return diff
}

// --- Viewed ---------------------------------------------------------------------------------------------------------

const seenNow = computed(() => (openPull.value ? seenAll[refKey(openPull.value)] : undefined))

type ViewedState = 'viewed' | 'changed' | null

/**
 * Viewed, viewed but changed since (so no longer ticked), or not. GitHub's own tick counts too. A tick is for a file as
 * the whole pull request leaves it, so the commits shown alone have none, as on GitHub.
 */
export function viewedState(file: PullFile): ViewedState {
  if (scope.value) return null
  const blob = seenNow.value?.viewed[file.path]
  // '-' marks a file the reader unticked here, whatever GitHub says.
  if (blob === '-') return null
  if (blob) return blob === file.blob ? 'viewed' : 'changed'
  const onGitHub = pull.value?.files.find((each) => each.path === file.path)?.viewedOnGitHub
  if (onGitHub === 'VIEWED') return 'viewed'
  if (onGitHub === 'DISMISSED') return 'changed'
  return null
}

export function toggleViewed(file: PullFile) {
  const seen = seenNow.value
  if (!seen || scope.value) return
  if (viewedState(file) === 'viewed') {
    seen.viewed[file.path] = '-'
  } else seen.viewed[file.path] = file.blob
}

export const viewedCount = computed(() => shownFiles.value.filter((file) => viewedState(file) === 'viewed').length)

/** One file at a time, or all in one scroll: this pull request's choice, or the setting. */
export const fileMode = computed<FileMode>(() => seenNow.value?.files ?? settings.files)
export function setFileMode(mode: FileMode) {
  if (seenNow.value) seenNow.value.files = mode
}

/** The file one-at-a-time shows, by path. */
export const currentFile = ref<string | null>(null)
watch(shownFiles, (list) => {
  if (!list.some((file) => file.path === currentFile.value)) currentFile.value = list[0]?.path ?? null
})

/** Changed since the last visit: the file is new since, or its text differs from then. Unmarked in a run of commits. */
export const freshFile = (file: PullFile) => !scope.value && changedSinceVisit(file)

function changedSinceVisit(file: PullFile): boolean {
  const at = visitedAt(file)
  const then = at ? texts.get(at) : undefined
  const now = file.newAt ? texts.get(file.newAt) : undefined
  if (!then) return false
  // Deleted since the visit, if it was there then.
  if (!file.newAt) return 'text' in then
  if ('missing' in then) return true
  return !!now && 'text' in then && 'text' in now && then.text !== now.text
}

/** When something counts as new since the last visit. */
export const markTime = computed(() => {
  if (pretend.value && pull.value) {
    const commit = pull.value.commits.find((each) => each.oid === pretend.value)
    return commit ? Date.parse(commit.at) : null
  }
  return lastVisit.value?.at ?? null
})
export const isFresh = (time: string) => markTime.value !== null && Date.parse(time) > markTime.value

/** What's new since the last visit: commits, comments (replies in threads too), and files. Null on a first visit. */
export const freshCounts = computed(() => {
  const current = pull.value
  if (!current || markTime.value === null) return null
  const talk = shownEntries.value.filter((entry) => isPost(entry) && isFresh(entry.at))
  const replies = shownThreads.value
    .flatMap((thread) => thread.comments.slice(1))
    .filter((comment) => isFresh(comment.createdAt))
  return {
    commits: current.commits.filter((commit) => isFresh(commit.at)).length,
    comments: talk.length + replies.length,
    files: allFiles.value.filter((file) => (showGenerated.value || !file.generated) && changedSinceVisit(file)).length,
  }
})

// --- Threads --------------------------------------------------------------------------------------------------------

/** The conversation, without the bots' posts Settings hide. */
export const shownEntries = computed(() =>
  (pull.value?.entries ?? []).filter((entry) => !isPost(entry) || postLook(entry.post.author) !== 'hide'),
)
/** The review threads, without the bots' ones Settings hide. */
const shownThreads = computed(() =>
  (pull.value?.threads ?? []).filter((thread) => postLook(thread.comments[0]?.author) !== 'hide'),
)

/** The file at the top of the diff, or the one shown alone, for the tree to mark. */
export const activeFile = ref<string | null>(null)
/** A file asked for from the tree. The files view brings it into view and clears this. */
export const fileAsked = shallowRef<string | null>(null)

/** A thread asked for from the conversation. The file it's on opens it, brings its line into view, and clears this. */
export const jumpTo = shallowRef<ReviewThread | null>(null)
export function jump(thread: ReviewThread) {
  if (scope.value && !threadsByPath.value.get(thread.path)?.includes(thread)) showAllChanges()
  showGenerated.value ||= allFiles.value.some((file) => file.path === thread.path && file.generated)
  currentFile.value = thread.path
  jumpTo.value = thread
}

// The header folds as the reader scrolls the diff, but not when the diff moves on its own, so it keeps the time of that.
let selfScrolledAt = 0
/** Brings part of the diff into view on the diff's own account: a file, a change, or a thread's line. */
export function reveal(element: Element, block: ScrollLogicalPosition) {
  selfScrolledAt = performance.now()
  element.scrollIntoView({ block })
}
/** Whether the diff's latest scroll was its own, from reveal(), and not the reader's. */
export const scrolledBySelf = () => performance.now() - selfScrolledAt < 400

// A thread's line is a line of the file as the pull request leaves it. In a run of commits, threads show on the files
// those commits leave as they are now, on the new side; elsewhere their lines would point at other code.
export const threadsByPath = computed(() => {
  const map = new Map<string, ReviewThread[]>()
  const now = scope.value ? new Map(allFiles.value.map((file) => [file.path, file.blob])) : null
  const shown = now && new Map(files.value.map((file) => [file.path, file.blob]))
  for (const thread of shownThreads.value) {
    if (shown && (thread.side !== 'new' || !shown.has(thread.path) || shown.get(thread.path) !== now.get(thread.path)))
      continue
    map.set(thread.path, [...(map.get(thread.path) ?? []), thread])
  }
  return map
})

// Loads the pull request the address names, once the workspace is open. Last, so everything load() uses exists.
watch(pretend, () => void loadVisited(ticket))

watch(
  [() => openPull.value && refKey(openPull.value), loaded],
  () => {
    if (openPull.value && loaded.value) void load(openPull.value)
  },
  { immediate: true },
)
