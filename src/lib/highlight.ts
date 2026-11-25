// Syntax colors for the diff, with Shiki. The colors are CSS variables, set in style.css for each theme.
import type { HighlighterCore, ThemedToken } from 'shiki/core'

export type Token = Pick<ThemedToken, 'content' | 'color' | 'fontStyle'>

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  vue: 'vue',
  json: 'json',
  jsonc: 'jsonc',
  json5: 'json5',
  md: 'markdown',
  mdc: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  css: 'css',
  scss: 'scss',
  html: 'html',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  rb: 'ruby',
  erb: 'erb',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  toml: 'toml',
  sql: 'sql',
  graphql: 'graphql',
  gql: 'graphql',
  xml: 'xml',
  svg: 'xml',
  php: 'php',
  cs: 'csharp',
  dart: 'dart',
}

const BY_NAME: Record<string, string> = {
  Dockerfile: 'docker',
  Gemfile: 'ruby',
  Rakefile: 'ruby',
  Makefile: 'make',
}

export function languageOf(path: string): string | null {
  const name = path.split('/').pop() ?? ''
  if (BY_NAME[name]) return BY_NAME[name]
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return BY_EXTENSION[extension] ?? null
}

let core: Promise<HighlighterCore> | null = null

// A load that fails, say for a chunk a deploy renamed, is tried again the next time.
function highlighter(): Promise<HighlighterCore> {
  core ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ])
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: 'zimam', variablePrefix: '--shiki-', fontStyle: true })],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
  })()
  core.catch(() => (core = null))
  return core
}

const loading = new Map<string, Promise<void>>()

async function ensure(lang: string): Promise<HighlighterCore> {
  const h = await highlighter()
  if (!h.getLoadedLanguages().includes(lang)) {
    let wait = loading.get(lang)
    if (!wait) {
      wait = import('shiki/langs').then(async ({ bundledLanguages }) => {
        const load = bundledLanguages[lang as keyof typeof bundledLanguages]
        if (load) await h.loadLanguage(load)
      })
      loading.set(lang, wait)
      wait.catch(() => loading.delete(lang))
    }
    await wait
  }
  return h
}

// Highlighting a long file holds up the page, so files past this many lines stay plain.
const MAX_LINES = 6000
// Tokens last as long as their text does.
const cache = new WeakMap<{ text: string }, Promise<Token[][] | null>>()

/** The tokens of each line of a text, or null when it isn't highlighted. */
export function tokenize(content: { text: string }, lang: string | null): Promise<Token[][] | null> {
  if (!lang) return Promise.resolve(null)
  const cached = cache.get(content)
  if (cached) return cached
  const { text } = content
  const answer = (async () => {
    if (text.split('\n', MAX_LINES + 1).length > MAX_LINES) return null
    const h = await ensure(lang)
    if (!h.getLoadedLanguages().includes(lang)) return null
    // Let the page paint between files.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const lines = h.codeToTokensBase(text, { lang, theme: 'zimam' })
    return lines.map((line) =>
      line.map((token) => ({ content: token.content, color: token.color, fontStyle: token.fontStyle })),
    )
  })().catch(() => {
    cache.delete(content)
    return null
  })
  cache.set(content, answer)
  return answer
}
