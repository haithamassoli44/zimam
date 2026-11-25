import { describe, expect, it } from 'vitest'

import { diffFiles, splitRows, visibleBlocks, type Line } from '@/lib/diff'

const kinds = (lines: Line[]) => lines.map((line) => `${line.kind[0]}${line.old ?? ''}:${line.new ?? ''}`)

describe('diffFiles', () => {
  it('numbers each side, and counts and finds the changes', () => {
    const diff = diffFiles({ old: 'a\nb\nc\nd\n', new: 'a\nB\nc\nd\ne\n' })
    expect(kinds(diff.lines)).toEqual(['s1:1', 'd2:', 'a:2', 's3:3', 's4:4', 'a:5'])
    expect(diff.changes).toEqual([1, 5])
    expect([diff.additions, diff.deletions]).toEqual([2, 1])
  })

  it('shows a new file as all added and a removed one as all removed', () => {
    expect(kinds(diffFiles({ old: null, new: 'x\ny' }).lines)).toEqual(['a:1', 'a:2'])
    expect(kinds(diffFiles({ old: 'x\ny', new: null }).lines)).toEqual(['d1:', 'd2:'])
  })

  it('can leave out changes in whitespace alone', () => {
    const old = 'if (a) {\n  go()\n}\n'
    const next = 'if (a) {\n    go()\n}\n'
    expect(diffFiles({ old, new: next }).changes).toHaveLength(1)
    expect(diffFiles({ old, new: next, ignoreSpace: true }).changes).toEqual([])
  })

  it('marks the words that changed in a changed line', () => {
    const [removed, added] = diffFiles({ old: 'const width = 10\n', new: 'const width = 12\n' }).lines
    expect(removed.text.slice(removed.words![0].from, removed.words![0].to)).toBe('10')
    expect(added.text.slice(added.words![0].from, added.words![0].to)).toBe('12')
  })

  it('shows lines without their Windows line end, but a change of line ends still shows', () => {
    const same = diffFiles({ old: 'a\r\nb\r\n', new: 'a\r\nc\r\n' })
    expect(same.lines.map((line) => line.text)).toEqual(['a', 'b', 'c'])
    expect(diffFiles({ old: 'a\r\n', new: 'a\n' }).changes).toHaveLength(1)
  })

  describe('since the last visit', () => {
    const old = 'one\ntwo\nthree\n'
    const visited = 'one\nTWO\nthree\n'
    const next = 'one\nTWO\nthree\nfour\n'

    it('says nothing without a visit', () => {
      expect(diffFiles({ old, new: next }).lines.map((line) => line.seen)).toEqual([null, null, null, null, null])
    })

    it('marks the changes the last visit already had as seen, and the rest as new', () => {
      const seen = diffFiles({ old, new: next, visited }).lines.map((line) => [line.text, line.seen])
      expect(seen).toEqual([
        ['one', null],
        ['two', true],
        ['TWO', true],
        ['three', null],
        ['four', false],
      ])
    })

    it('counts every line added as new when the file wasn’t there then, and its old lines as already gone', () => {
      const lines = diffFiles({ old, new: next, visited: null }).lines.filter((line) => line.kind !== 'same')
      expect(lines.map((line) => [line.kind, line.seen])).toEqual([
        ['del', true],
        ['add', false],
        ['add', false],
      ])
    })
  })
})

describe('visibleBlocks', () => {
  const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`)
  const diff = diffFiles({ old: lines.join('\n'), new: lines.with(10, 'changed').join('\n') })

  it('shows each change with the lines around it, and folds the rest', () => {
    expect(visibleBlocks(diff, 2, {}).map((block) => [block.kind, block.from, block.to])).toEqual([
      ['gap', 0, 8],
      ['lines', 8, 14],
      ['gap', 14, 21],
    ])
  })

  it('shows an anchor with the same lines around it, and lines unfolded by hand alone', () => {
    const blocks = visibleBlocks(diff, 2, { anchors: [1], open: [19] })
    expect(blocks.filter((block) => block.kind === 'lines').map((block) => [block.from, block.to])).toEqual([
      [0, 4],
      [8, 14],
      [19, 20],
    ])
  })
})

describe('splitRows', () => {
  it('pairs removed lines with added ones, and knows where each came from', () => {
    const { lines } = diffFiles({ old: 'a\nb\nc\n', new: 'a\nB\nC\nD\n' })
    const rows = splitRows(lines, 0, lines.length)
    expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null, row.leftAt, row.rightAt])).toEqual([
      ['a', 'a', 0, 0],
      ['b', 'B', 1, 3],
      ['c', 'C', 2, 4],
      [null, 'D', null, 5],
    ])
  })
})
