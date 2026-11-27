// Zimam's own diff of two whole files, with what the reader saw at their last visit marked.
import { diffArrays, diffWordsWithSpace } from 'diff'

export type LineKind = 'same' | 'add' | 'del'

/** A stretch of a line that changed within it, as character offsets. */
export interface Span {
  from: number
  to: number
}

export interface Line {
  kind: LineKind
  /** Line numbers, from 1, on each side. */
  old: number | null
  new: number | null
  text: string
  /** What changed inside a changed line that has a partner on the other side. */
  words: Span[] | null
  /** For a changed line, once there is a last visit: whether it was already there then. */
  seen: boolean | null
  /** A changed line that is its side's last, without a line end after it. */
  noEnd?: true
}

export interface FileDiff {
  /** Every line of the file, old and new interleaved: what's the same, then each change's removed and added lines. */
  lines: Line[]
  /** Where each change starts, as indexes into `lines`. */
  changes: number[]
  additions: number
  deletions: number
  /** Too many changes to diff line by line in time: shown as all removed, then all added. */
  rewritten: boolean
}

// Lines keep a Windows line end for the comparison, so a file that only changed its line ends shows as changed, but a
// line's text leaves it out, as the syntax highlighter's lines do. A last line without a line end after it carries a
// mark instead, so adding or removing the file's last line end shows as a change too, as Git shows it.
const NO_END = '\u0000'
const splitLines = (text: string) => {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  else lines[lines.length - 1] += NO_END
  return lines
}
const textOf = (line: string) => {
  const text = line.endsWith(NO_END) ? line.slice(0, -1) : line
  return text.endsWith('\r') ? text.slice(0, -1) : text
}

// Ignoring white space ignores the last line end too.
const normalize = (line: string) => line.replace(NO_END, '').trim().replace(/\s+/g, ' ')

type Op = { kind: LineKind; count: number }

// jsdiff's Myers diff is quadratic in the edit size, so the common start and end are taken off first, and a diff that
// runs too long is given up on.
function lineOps(a: string[], b: string[], ignoreSpace: boolean): Op[] | null {
  const ka = ignoreSpace ? a.map(normalize) : a
  const kb = ignoreSpace ? b.map(normalize) : b
  let start = 0
  while (start < ka.length && start < kb.length && ka[start] === kb[start]) start++
  let end = 0
  while (end < ka.length - start && end < kb.length - start && ka[ka.length - 1 - end] === kb[kb.length - 1 - end])
    end++
  const ops: Op[] = []
  if (start) ops.push({ kind: 'same', count: start })
  const middleA = ka.slice(start, ka.length - end)
  const middleB = kb.slice(start, kb.length - end)
  if (middleA.length || middleB.length) {
    const parts = diffArrays(middleA, middleB, { timeout: 1500 })
    if (!parts) return null
    for (const part of parts)
      ops.push({ kind: part.added ? 'add' : part.removed ? 'del' : 'same', count: part.count ?? part.value.length })
  }
  if (end) ops.push({ kind: 'same', count: end })
  return ops
}

/** Which lines of `b` are new against `a`, and which lines of `a` are gone in `b`, by line number. */
function delta(a: string[], b: string[]): { added: Set<number>; removed: Set<number> } | null {
  const ops = lineOps(a, b, false)
  if (!ops) return null
  const added = new Set<number>()
  const removed = new Set<number>()
  let ia = 1
  let ib = 1
  for (const op of ops) {
    for (let index = 0; index < op.count; index++) {
      if (op.kind === 'add') added.add(ib++)
      else if (op.kind === 'del') removed.add(ia++)
      else {
        ia++
        ib++
      }
    }
  }
  return { added, removed }
}

// Word highlights only where they help: lines of a sensible length, in changes of a sensible size.
const WORDS_MAX_LINE = 400
const WORDS_MAX_CHANGE = 60

function wordSpans(a: string, b: string): [Span[], Span[]] | null {
  if (a.length > WORDS_MAX_LINE || b.length > WORDS_MAX_LINE) return null
  const parts = diffWordsWithSpace(a, b)
  const left: Span[] = []
  const right: Span[] = []
  let ia = 0
  let ib = 0
  let same = 0
  for (const part of parts) {
    const size = part.value.length
    if (part.added) right.push({ from: ib, to: (ib += size) })
    else if (part.removed) left.push({ from: ia, to: (ia += size) })
    else {
      ia += size
      ib += size
      same += size
    }
  }
  // Lines that share almost nothing read better whole.
  if (same < Math.min(a.length, b.length) * 0.4) return null
  return [left, right]
}

export interface DiffInput {
  old: string | null
  new: string | null
  ignoreSpace?: boolean
  /** The new side as it was at the last visit: undefined without a visit, null when the file wasn't there then. */
  visited?: string | null
}

export function diffFiles({ old, new: next, ignoreSpace = false, visited }: DiffInput): FileDiff {
  const a = old === null ? [] : splitLines(old)
  const b = next === null ? [] : splitLines(next)
  let ops = lineOps(a, b, ignoreSpace)
  const rewritten = !ops
  ops ??= [
    { kind: 'del', count: a.length },
    { kind: 'add', count: b.length },
  ]

  // What changed since the visit, against the new side then. A removed line counts as seen when it was already gone.
  let sinceVisit: { added: Set<number>; removed: Set<number> } | null = null
  let goneAtVisit: Set<number> | null = null
  if (visited !== undefined) {
    const then = visited === null ? [] : splitLines(visited)
    sinceVisit = delta(then, b)
    goneAtVisit = delta(a, then)?.removed ?? null
  }

  const lines: Line[] = []
  const changes: number[] = []
  let ia = 0
  let ib = 0
  let additions = 0
  let deletions = 0
  const pushDel = () => {
    const number = ++ia
    const seen = visited === undefined ? null : goneAtVisit ? goneAtVisit.has(number) : false
    const line: Line = { kind: 'del', old: number, new: null, text: textOf(a[number - 1]), words: null, seen }
    if (a[number - 1].endsWith(NO_END)) line.noEnd = true
    lines.push(line)
    deletions++
    return line
  }
  const pushAdd = () => {
    const number = ++ib
    const seen = visited === undefined ? null : sinceVisit ? !sinceVisit.added.has(number) : false
    const line: Line = { kind: 'add', old: null, new: number, text: textOf(b[number - 1]), words: null, seen }
    if (b[number - 1].endsWith(NO_END)) line.noEnd = true
    lines.push(line)
    additions++
    return line
  }
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]
    if (op.kind === 'same') {
      for (let n = 0; n < op.count; n++) {
        lines.push({ kind: 'same', old: ia + 1, new: ib + 1, text: textOf(b[ib]), words: null, seen: null })
        ia++
        ib++
      }
      continue
    }
    if (lines.at(-1)?.kind !== 'del' || op.kind === 'del') changes.push(lines.length)
    const made = Array.from({ length: op.count }, op.kind === 'del' ? pushDel : pushAdd)
    const nextOp = ops[index + 1]
    if (op.kind === 'del' && nextOp?.kind === 'add') {
      const dels = made
      const adds = Array.from({ length: nextOp.count }, pushAdd)
      if (dels.length <= WORDS_MAX_CHANGE && adds.length <= WORDS_MAX_CHANGE) {
        for (let n = 0; n < Math.min(dels.length, adds.length); n++) {
          const spans = wordSpans(dels[n].text, adds[n].text)
          if (spans) [dels[n].words, adds[n].words] = spans
        }
      }
      index++
    }
  }
  return { lines, changes, additions, deletions, rewritten }
}

/** A run of lines shown, or a run of unchanged ones folded away. */
export type Block = { kind: 'lines'; from: number; to: number } | { kind: 'gap'; from: number; to: number }

/**
 * Which lines show: every change and every anchor, like a thread's line, with `context` lines around it, and the lines
 * unfolded by hand. Both by index into the diff's lines.
 */
export function visibleBlocks(
  diff: FileDiff,
  context: number,
  { anchors = [], open = [] }: { anchors?: Iterable<number>; open?: Iterable<number> },
): Block[] {
  const total = diff.lines.length
  const shown = new Uint8Array(total)
  const around = (index: number) => {
    for (let n = Math.max(0, index - context); n <= Math.min(total - 1, index + context); n++) shown[n] = 1
  }
  for (let index = 0; index < total; index++) if (diff.lines[index].kind !== 'same') around(index)
  for (const index of anchors) around(index)
  for (const index of open) if (index < total) shown[index] = 1
  const blocks: Block[] = []
  let index = 0
  while (index < total) {
    const kind = shown[index] ? 'lines' : 'gap'
    const from = index
    while (index < total && (shown[index] ? 'lines' : 'gap') === kind) index++
    blocks.push({ kind, from, to: index })
  }
  return blocks
}

/** One row of a split view: the old line on the left, the new on the right, each with its index in `lines`. */
export interface SplitRow {
  left: Line | null
  right: Line | null
  leftAt: number | null
  rightAt: number | null
  /** The index of the row's first line, for keys and folding. */
  at: number
}

export function splitRows(lines: Line[], from: number, to: number): SplitRow[] {
  const rows: SplitRow[] = []
  let index = from
  while (index < to) {
    const line = lines[index]
    if (line.kind === 'same') {
      rows.push({ left: line, right: line, leftAt: index, rightAt: index, at: index })
      index++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (index < to && lines[index].kind === 'del') dels.push(index++)
    while (index < to && lines[index].kind === 'add') adds.push(index++)
    for (let n = 0; n < Math.max(dels.length, adds.length); n++) {
      const leftAt = dels[n] ?? null
      const rightAt = adds[n] ?? null
      rows.push({
        left: leftAt === null ? null : lines[leftAt],
        right: rightAt === null ? null : lines[rightAt],
        leftAt,
        rightAt,
        at: leftAt ?? rightAt,
      })
    }
  }
  return rows
}
