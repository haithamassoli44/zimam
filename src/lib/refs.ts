/** Where an issue lives: `owner/name#number`, the way GitHub writes a reference. */
export interface IssueRef {
  repo: string
  number: number
}

const REF = /^([\w.-]+\/[\w.-]+)#([1-9]\d{0,8})$/

export function parseRef(text: string | null | undefined): IssueRef | null {
  const match = REF.exec(text ?? '')
  return match ? { repo: match[1], number: Number(match[2]) } : null
}

export const formatRef = (ref: IssueRef) => `${ref.repo}#${ref.number}`

/** What tells a reference apart. GitHub doesn't mind the case of a repository's name, so neither does this. */
export const refKey = (ref: IssueRef) => formatRef(ref).toLowerCase()

export const sameRef = (a: IssueRef | null, b: IssueRef | null) =>
  !!a && !!b && a.number === b.number && refKey(a) === refKey(b)

export const issueUrl = (ref: IssueRef) => `https://github.com/${ref.repo}/issues/${ref.number}`
