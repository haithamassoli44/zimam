// A diff line's text in pieces, each with its syntax color and whether it changed within the line.
import type { Span } from './diff'
import type { Token } from './highlight'

export interface Piece {
  text: string
  color?: string
  italic?: boolean
  bold?: boolean
  changed?: boolean
}

export function paint(text: string, tokens: Token[] | null | undefined, words: Span[] | null): Piece[] {
  const runs: Token[] = tokens && tokens.map((token) => token.content).join('') === text ? tokens : [{ content: text }]
  if (!words?.length) return runs.map(toPiece)
  const pieces: Piece[] = []
  let at = 0
  let word = 0
  for (const run of runs) {
    let offset = 0
    while (offset < run.content.length) {
      const position = at + offset
      while (word < words.length && words[word].to <= position) word++
      const span = words[word]
      const inside = !!span && span.from <= position
      const limit = inside ? span.to : span ? span.from : Infinity
      const end = Math.min(run.content.length, offset + (limit - position))
      pieces.push({ ...toPiece(run), text: run.content.slice(offset, end), changed: inside })
      offset = end
    }
    at += run.content.length
  }
  return pieces
}

function toPiece(token: Token): Piece {
  const style = token.fontStyle ?? 0
  return { text: token.content, color: token.color, italic: (style & 1) !== 0, bold: (style & 2) !== 0 }
}
