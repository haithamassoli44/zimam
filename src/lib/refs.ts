/** Where an issue lives: `owner/name#number`, the way GitHub writes a reference. */
export interface IssueRef {
  repo: string
  number: number
}

// A repository's `owner/name` and an issue's number, as GitHub allows them.
const REPO = String.raw`[\w.-]+/[\w.-]+`
const NUMBER = String.raw`[1-9]\d{0,8}`
const REF = new RegExp(`^(${REPO})#(${NUMBER})$`)

export function parseRef(text: string | null | undefined): IssueRef | null {
  const match = REF.exec(text ?? '')
  return match ? { repo: match[1], number: Number(match[2]) } : null
}

export const formatRef = (ref: IssueRef) => `${ref.repo}#${ref.number}`

/** What tells a reference apart. GitHub doesn't mind the case of a repository's name, so neither does this. */
export const refKey = (ref: IssueRef) => formatRef(ref).toLowerCase()

export const sameRef = (a: IssueRef | null, b: IssueRef | null) =>
  !!a && !!b && a.number === b.number && refKey(a) === refKey(b)

// --- A pull request's page: GitHub's address, on Zimam's host ---

/** The parts of a pull request beside its diff. An address names one, as GitHub's names its tab; the conversation none. */
export const PULL_PARTS = ['files', 'conversation', 'commits', 'checks'] as const
export type PullPart = (typeof PULL_PARTS)[number]

/** The commits a diff shows: the last, and the commit before the first, which is the last's parent for one alone. */
export interface Run {
  before: string | null
  last: string
}

/** Where a pull request page is: the pull request, the part beside its diff, and the commits the diff shows. */
export interface PullAddress {
  ref: IssueRef
  part: PullPart
  run: Run | null
}

// The files and the commits can name the commits the diff shows, as GitHub's do: one commit, `/commits/<sha>`, or the
// changes from one commit to another, `/files/<sha>..<sha>`.
/** Whether a part's address names the commits the diff shows. */
export const namesRun = (part: PullPart) => part === 'files' || part === 'commits'
const SHA = '[0-9a-f]{7,40}'
const PULL_PATH = new RegExp(
  `^/(${REPO})/pull/(${NUMBER})(?:/(${PULL_PARTS.filter((part) => part !== 'conversation').join('|')})(?:/(?:(${SHA})\\.\\.)?(${SHA}))?)?/?$`,
)

// The app's own base, under which its addresses go.
const BASE = import.meta.env.BASE_URL.slice(0, -1)

/** The pull request page a path names, or null. */
export function parsePullPath(path: string): PullAddress | null {
  const match = PULL_PATH.exec(path.slice(BASE.length))
  if (!match) return null
  const part = (match[3] as PullPart | undefined) ?? 'conversation'
  const run = namesRun(part) && match[5] ? { before: match[4] ?? null, last: match[5] } : null
  return { ref: { repo: match[1], number: Number(match[2]) }, part, run }
}

/** A pull request page's path. Beside a part that doesn't name them, the commits shown stay out. */
export function pullPath({ ref, part, run }: PullAddress): string {
  const named = run && namesRun(part) ? `/${run.before ? `${run.before}..` : ''}${run.last}` : ''
  return `${BASE}/${ref.repo}/pull/${ref.number}${part === 'conversation' ? '' : `/${part}`}${named}`
}

// --- GitHub's own pages ---
export const issueUrl = (ref: IssueRef) => `https://github.com/${ref.repo}/issues/${ref.number}`
export const pullUrl = (ref: IssueRef) => `https://github.com/${ref.repo}/pull/${ref.number}`
/** A commit as its pull request shows it. */
export const commitUrl = (ref: IssueRef, oid: string) => `${pullUrl(ref)}/commits/${oid}`
/** A file as it is at a commit. */
export const blobUrl = (repo: string, oid: string, path: string) => `https://github.com/${repo}/blob/${oid}/${path}`
