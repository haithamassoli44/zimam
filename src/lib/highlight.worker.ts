// Syntax tokens for the diff, worked out off the page's thread: a long file held the page up for a while. Each line's
// tokens come back as their lengths, colors and styles, which the line's own text spells out again: see highlight.ts.
import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { bundledLanguages } from 'shiki/langs'

import type { Asked, Answer } from './highlight'

const core = createHighlighterCore({
  themes: [createCssVariablesTheme({ name: 'zimam', variablePrefix: '--shiki-', fontStyle: true })],
  langs: [],
  engine: createJavaScriptRegexEngine({ forgiving: true }),
})

addEventListener('message', async (event: MessageEvent<Asked>) => {
  const { id, text, lang } = event.data
  let answer: Answer = { id, colors: [], lines: null }
  try {
    const h = await core
    const load = bundledLanguages[lang as keyof typeof bundledLanguages]
    if (load && !h.getLoadedLanguages().includes(lang)) await h.loadLanguage(load)
    if (h.getLoadedLanguages().includes(lang)) {
      const colors: string[] = []
      const index = new Map<string, number>()
      const lines = h.codeToTokensBase(text, { lang, theme: 'zimam' }).map((line) =>
        line.flatMap((token) => {
          const color = token.color ?? ''
          let at = index.get(color)
          if (at === undefined) index.set(color, (at = colors.push(color) - 1))
          return [token.content.length, at, token.fontStyle ?? 0]
        }),
      )
      answer = { id, colors, lines }
    }
  } catch {
    answer = { id, colors: [], lines: null, failed: true }
  }
  postMessage(answer)
})
