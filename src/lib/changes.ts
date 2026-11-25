// PROTOTYPE: the files a pull request changes, read whole so Zimam can diff them itself.
import type { GitHub } from './github'

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
  /** The repository's own word on generated files, from .gitattributes at the head. */
  attributes: string | null
  /** GitHub listed only the first files of a run of commits: it gives no more than 300 for a comparison. */
  capped?: boolean
}

type Raw = any // PROTOTYPE

const toFile = (raw: Raw): FileChange => ({
  path: raw.filename,
  oldPath: raw.previous_filename ?? null,
  status: raw.status,
  additions: raw.additions,
  deletions: raw.deletions,
  blob: raw.sha,
})

/** The merge base and the changed files: one REST request for up to 300 files, then one per 100 more. */
export async function readChanges(
  gh: GitHub,
  repo: string,
  pull: { number: number; baseOid: string; headOid: string; changedFiles: number },
): Promise<Changes> {
  const compare = await gh.rest<Raw>(`/repos/${repo}/compare/${pull.baseOid}...${pull.headOid}?per_page=1`)
  let files: FileChange[] = (compare.files ?? []).map(toFile)
  if (pull.changedFiles > files.length) {
    files = []
    for (let page = 1; page <= 30; page++) {
      const batch = await gh.rest<Raw[]>(`/repos/${repo}/pulls/${pull.number}/files?per_page=100&page=${page}`)
      files.push(...batch.map(toFile))
      if (batch.length < 100) break
    }
  }
  const [attributes] = await readTexts(gh, repo, [`${pull.headOid}:.gitattributes`])
  return {
    mergeBase: compare.merge_base_commit.sha,
    files,
    attributes: attributes && 'text' in attributes ? attributes.text : null,
  }
}

// A comparison lists its first 300 files and no more, on any page.
const COMPARED = 300

/** What a run of commits changed, from the commit before it to its last: one REST request. */
export async function readRange(gh: GitHub, repo: string, base: string, head: string): Promise<Changes> {
  const compare = await gh.rest<Raw>(`/repos/${repo}/compare/${base}...${head}?per_page=1`)
  const files: FileChange[] = (compare.files ?? []).map(toFile)
  return { mergeBase: compare.merge_base_commit.sha, files, attributes: null, capped: files.length >= COMPARED }
}

// 100 blobs at a time still cost a point. GitHub cuts a blob's text off at 512,000 bytes.
const BATCH = 100

/** The texts at `commit:path` expressions, in order. */
export async function readTexts(gh: GitHub, repo: string, expressions: string[]): Promise<Content[]> {
  const [owner, name] = repo.split('/')
  const out: Content[] = []
  for (let start = 0; start < expressions.length; start += BATCH) {
    const batch = expressions.slice(start, start + BATCH)
    const variables: Record<string, string> = { owner, name }
    const fields = batch.map((expression, index) => {
      variables[`e${index}`] = expression
      return `f${index}: object(expression: $e${index}) { ... on Blob { text isBinary isTruncated byteSize } }`
    })
    const declared = batch.map((_, index) => `$e${index}: String!`).join(', ')
    const query = `query($owner: String!, $name: String!, ${declared}) { repository(owner: $owner, name: $name) { ${fields.join(' ')} } }`
    const { data, errors } = await gh.request<Raw>(query, variables)
    const failed = new Set(errors.map((error) => error.path?.[1]))
    for (let index = 0; index < batch.length; index++) {
      const blob = data.repository?.[`f${index}`]
      if (failed.has(`f${index}`)) out.push({ failed: true })
      else if (!blob) out.push({ missing: true })
      else if (blob.isBinary) out.push({ binary: true })
      else if (blob.isTruncated) out.push({ tooBig: blob.byteSize })
      else out.push({ text: blob.text ?? '' })
    }
  }
  return out
}

/** What each side of each file reads, as expressions: the old side at the merge base, the new side at the head. */
export function sides(file: FileChange, mergeBase: string, head: string): { old: string | null; new: string | null } {
  return {
    old: file.status === 'added' ? null : blobAt(mergeBase, file.oldPath ?? file.path),
    new: file.status === 'removed' ? null : blobAt(head, file.path),
  }
}
