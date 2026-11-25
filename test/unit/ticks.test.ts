import { describe, expect, it } from 'vitest'

import { NO_FILE } from '@/lib/changes'
import { BASE, changeKey, readChange, readFile, tickFile, type FileTicks } from '@/lib/ticks'

// A file's versions as a pull request takes it along: at the base, then after each of its commits.
const [base, first, second, third] = ['b0', 'b1', 'b2', 'b3']
const none: FileTicks = { ticked: [], unticked: [] }

describe('reading all the changes', () => {
  it('reads viewed once ticked, and changed once a push changes the file again', () => {
    const ticks = [changeKey(BASE, second)]
    expect(readChange(ticks, BASE, second)).toBe('viewed')
    expect(readChange(ticks, BASE, third)).toBe('changed')
    expect(readChange([], BASE, third)).toBeNull()
  })

  it('adds up ticks made commit by commit, once the file’s version at the base is known', () => {
    const ticks = [changeKey(base, first), changeKey(first, second), changeKey(second, third)]
    expect(readChange(ticks, BASE, third, base)).toBe('viewed')
    expect(readChange(ticks, BASE, third)).toBeNull()
  })

  it('reads commits ticked part of the way as not viewed, never as changed', () => {
    expect(readChange([changeKey(base, first)], BASE, third, base)).toBeNull()
  })

  it('picks up after a tick on all the changes with the commits ticked since', () => {
    expect(readChange([changeKey(BASE, second), changeKey(second, third)], BASE, third, base)).toBe('viewed')
  })
})

describe('reading a run of commits', () => {
  it('reads viewed when ticks lead from its first version to its last, and never changed', () => {
    const ticks = [changeKey(base, first), changeKey(first, second)]
    expect(readChange(ticks, base, second, base)).toBe('viewed')
    expect(readChange(ticks, first, second, base)).toBe('viewed')
    expect(readChange(ticks, base, third, base)).toBeNull()
    expect(readChange([changeKey(first, 'b2-amended')], first, second, base)).toBeNull()
  })

  it('counts a tick on all the changes for the one commit that changed the file', () => {
    const ticks = [changeKey(BASE, third)]
    expect(readChange(ticks, base, third, base)).toBe('viewed')
    // A commit after another that changed the file, or one leaving it before the head, saw only part of it.
    expect(readChange(ticks, first, third, base)).toBeNull()
    expect(readChange(ticks, base, first, base)).toBeNull()
  })

  it('reads a change that keeps the version, like a new mode, as viewed only once it is ticked', () => {
    expect(readChange([changeKey(base, first)], first, first, base)).toBeNull()
    expect(readChange([changeKey(first, first)], first, first, base)).toBe('viewed')
  })

  it('follows a file added, then removed', () => {
    const ticks = [changeKey(NO_FILE, first), changeKey(first, NO_FILE)]
    expect(readChange(ticks, NO_FILE, first, NO_FILE)).toBe('viewed')
    expect(readChange(ticks, first, NO_FILE, NO_FILE)).toBe('viewed')
    expect(readChange(ticks, BASE, NO_FILE, NO_FILE)).toBe('viewed')
  })
})

describe('ticking a file', () => {
  const allChanges = { from: BASE, to: third }

  it('unticks by hand a change that other ticks still count, and ticks it again', () => {
    const others = [changeKey(BASE, third)]
    const unticked = tickFile(none, others, allChanges, base, false)
    expect(readFile(unticked, others, allChanges, base)).toBeNull()
    const again = tickFile(unticked, others, allChanges, base, true)
    expect(readFile(again, others, allChanges, base)).toBe('viewed')
    expect(again.unticked).toEqual([])
  })

  it('lets a new tick on the file end what was unticked by hand', () => {
    // Commits 1 and 2 ticked add up to all the changes; all the changes unticked by hand; commit 2 ticked again.
    const commits = { ticked: [changeKey(base, first), changeKey(first, second)], unticked: [] }
    const toHead = { from: BASE, to: second }
    const held = tickFile(commits, [], toHead, base, false)
    expect(readFile(held, [], toHead, base)).toBeNull()
    const reread = tickFile(held, [], { from: first, to: second }, base, true)
    expect(readFile(reread, [], toHead, base)).toBe('viewed')
  })

  it('unticks its own tick without holding anything', () => {
    const ticked = tickFile(none, [], allChanges, base, true)
    expect(readFile(ticked, [], allChanges, base)).toBe('viewed')
    expect(tickFile(ticked, [], allChanges, base, false)).toEqual(none)
  })

  it('lets a tick on all the changes take the place of those on earlier heads, keeping the commits’', () => {
    const own = { ticked: [changeKey(BASE, first), changeKey(first, second)], unticked: [] }
    expect(tickFile(own, [], allChanges, base, true).ticked).toEqual([changeKey(first, second), changeKey(BASE, third)])
  })

  it('keeps a file’s latest ticks, each once: one for each of a pull request’s 100 commits', () => {
    let own = none
    for (let n = 0; n < 120; n++) own = tickFile(own, [], { from: `v${n}`, to: `v${n + 1}` }, base, true)
    expect(own.ticked).toHaveLength(100)
    expect(own.ticked.at(-1)).toBe(changeKey('v119', 'v120'))
    const again = tickFile(own, [], { from: 'v30', to: 'v31' }, base, true)
    expect(again.ticked).toHaveLength(100)
    expect(again.ticked.at(-1)).toBe(changeKey('v30', 'v31'))
  })

  it('takes an untick on all the changes from the ticks the commit reads too, GitHub’s among them', () => {
    const onGitHub = [changeKey(BASE, first)]
    const unticked = tickFile(none, onGitHub, { from: BASE, to: first }, base, false)
    expect(readFile(unticked, onGitHub, { from: base, to: first }, base)).toBeNull()
  })

  it('reads GitHub’s tick taken off after a change as changed, unless unticked here', () => {
    expect(readFile(none, [], { from: BASE, to: second }, base, true)).toBe('changed')
    const unticked = { ticked: [], unticked: [changeKey(BASE, first)] }
    expect(readFile(unticked, [], { from: BASE, to: second }, base, true)).toBeNull()
    expect(readFile(none, [], { from: base, to: second }, base, true)).toBeNull()
  })
})
