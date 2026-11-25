// The files a pull request changes, read whole so Zimam can diff them itself.
import type { GitHub } from './github'
import type { Pull } from './pull'

export type FileStatus = 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed'

/** A file's text at a commit. `missing`: no such file there. `failed`: GitHub couldn't give it. */
export type Content = { text: string } | { binary: true } | { tooBig: number } | { missing: true } | { failed: true }

/** The expression GitHub reads a file at a commit by. */
export const blobAt = (commit: string, path: string) => `${commit}:${path}`

export interface FileChange {
  path: string
  /** Where a renamed or copied file came from. */
  oldPath: string | null
  status: FileStatus
  additions: number
  deletions: number
  /** The file's blob at the head, or at the base for a removed file. A viewed tick holds it, to see the file change. */
  blob: string
}

export interface Changes {
  mergeBase: string
  files: FileChange[]
  /** GitHub listed only the first files: 300 for a run of commits, 3,000 for a pull request. */
  capped: boolean
}

/** A changed file as GitHub's REST API lists it. */
interface RestFile {
  filename: string
  previous_filename?: string
  status: FileStatus
  additions: number
  deletions: number
  sha: string
}

const toFile = (raw: RestFile): FileChange => ({
  path: raw.filename,
  oldPath: raw.previous_filename ?? null,
  status: raw.status,
  additions: raw.additions,
  deletions: raw.deletions,
  blob: raw.sha,
})

// A comparison lists its first 300 files and no more, on any page.
const COMPARED = 300

/**
 * What changed from `base` to `head`, as a run of commits from the commit before it to its last: where they meet, and
 * their first 300 files. One REST request.
 */
export async function readRange(gh: GitHub, repo: string, base: string, head: string): Promise<Changes> {
  const answer = await gh.rest<{ merge_base_commit: { sha: string }; files?: RestFile[] }>(
    `/repos/${repo}/compare/${base}...${head}?per_page=1`,
  )
  const files = (answer.files ?? []).map(toFile)
  return { mergeBase: answer.merge_base_commit.sha, files, capped: files.length >= COMPARED }
}

// A pull request lists its files 100 a page, up to 3,000.
const PAGE = 100
const PAGES = 30

/**
 * The merge base and the changed files, with the repository's .gitattributes at the head, its own word on which files
 * are generated: one REST request for up to 300 files, then one per 100 more.
 */
export async function readChanges(gh: GitHub, pull: Pull): Promise<{ changes: Changes; attributes: string | null }> {
  const { repo, number } = pull.ref
  const compared = await readRange(gh, repo, pull.baseOid, pull.headOid)
  // A pull request lists all its files, when a comparison has only the first.
  let changes: Changes = { ...compared, capped: false }
  if (pull.changedFiles > compared.files.length) {
    const files: FileChange[] = []
    for (let page = 1; page <= PAGES; page++) {
      const batch = await gh.rest<RestFile[]>(`/repos/${repo}/pulls/${number}/files?per_page=${PAGE}&page=${page}`)
      files.push(...batch.map(toFile))
      if (batch.length < PAGE) break
    }
    changes = { mergeBase: compared.mergeBase, files, capped: files.length >= PAGE * PAGES }
  }
  const [attributes] = await readTexts(gh, repo, [blobAt(pull.headOid, '.gitattributes')])
  return { changes, attributes: 'text' in attributes ? attributes.text : null }
}

/** How many texts one read takes: 100 still cost a point. GitHub cuts a text off at 512,000 bytes. */
export const TEXTS_PER_READ = 100

/** The texts at `commit:path` expressions, in order: TEXTS_PER_READ at most. */
export async function readTexts(gh: GitHub, repo: string, batch: string[]): Promise<Content[]> {
  const [owner, name] = repo.split('/')
  const variables: Record<string, string> = { owner, name }
  const fields = batch.map((expression, index) => {
    variables[`e${index}`] = expression
    return `f${index}: object(expression: $e${index}) { ... on Blob { text isBinary isTruncated byteSize } }`
  })
  const declared = batch.map((_, index) => `$e${index}: String!`).join(', ')
  const query = `query($owner: String!, $name: String!, ${declared}) { repository(owner: $owner, name: $name) { ${fields.join(' ')} } }`
  const { data, errors } = await gh.request<{
    repository: Record<
      string,
      { text: string | null; isBinary: boolean; isTruncated: boolean; byteSize: number } | null
    > | null
  }>(query, variables)
  // A text GitHub can't give comes back as an error at its place, beside the others.
  const failed = new Set(errors.map((error) => error.path?.[1]))
  return batch.map((_, index): Content => {
    const blob = data.repository?.[`f${index}`]
    if (failed.has(`f${index}`)) return { failed: true }
    if (!blob) return { missing: true }
    if (blob.isBinary) return { binary: true }
    if (blob.isTruncated) return { tooBig: blob.byteSize }
    return { text: blob.text ?? '' }
  })
}

/** What each side of each file reads, as expressions: the old side at the merge base, the new side at the head. */
export function sides(file: FileChange, mergeBase: string, head: string): { old: string | null; new: string | null } {
  return {
    old: file.status === 'added' ? null : blobAt(mergeBase, file.oldPath ?? file.path),
    new: file.status === 'removed' ? null : blobAt(head, file.path),
  }
}
