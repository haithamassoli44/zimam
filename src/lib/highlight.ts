// Syntax colors for the diff, with Shiki. The colors are CSS variables, set in style.css for each theme.
import type { ThemedToken } from 'shiki/core'

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

/** What the page asks the highlighting worker: a text, in a language. */
export interface Asked {
  id: number
  text: string
  lang: string
}

/**
 * What the worker answers: each line's tokens as three numbers each, their length, their color among `colors`, and
 * their font style. Null when the language couldn't be highlighted, and `failed` when that may pass, as when its
 * grammar didn't load: then the text is asked about again the next time.
 */
export interface Answer {
  id: number
  colors: string[]
  lines: number[][] | null
  failed?: true
}

let worker: Worker | null = null
let asked = 0
const waiting = new Map<number, { content: { text: string }; done: (tokens: Token[][] | null) => void }>()

// A worker that fails to start, say for a chunk a deploy renamed, leaves what it was asked plain, and is started again
// the next time.
function highlighter(): Worker {
  if (worker) return worker
  const started = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
  started.addEventListener('message', (event: MessageEvent<Answer>) => {
    const { id, colors, lines, failed } = event.data
    const asking = waiting.get(id)
    waiting.delete(id)
    if (!asking) return
    if (failed) cache.delete(asking.content)
    asking.done(lines && spell(asking.content.text, colors, lines))
  })
  started.addEventListener('error', () => {
    if (worker === started) worker = null
    started.terminate()
    for (const asking of waiting.values()) {
      cache.delete(asking.content)
      asking.done(null)
    }
    waiting.clear()
  })
  worker = started
  return started
}

/** Each line's tokens, their text cut from the line's own. */
function spell(text: string, colors: string[], lines: number[][]): Token[][] {
  const texts = text.split('\n')
  return lines.map((line, index) => {
    const own = texts[index] ?? ''
    const tokens: Token[] = []
    for (let at = 0, start = 0; at < line.length; at += 3) {
      const end = start + line[at]
      tokens.push({ content: own.slice(start, end), color: colors[line[at + 1]] || undefined, fontStyle: line[at + 2] })
      start = end
    }
    return tokens
  })
}

// Highlighting a long file holds up even the worker, and its answer the page, so files past this many lines stay plain.
const MAX_LINES = 6000
// Tokens last as long as their text does.
const cache = new WeakMap<{ text: string }, Promise<Token[][] | null>>()

/** The tokens of each line of a text, or null when it isn't highlighted. */
export function tokenize(content: { text: string }, lang: string | null): Promise<Token[][] | null> {
  if (!lang) return Promise.resolve(null)
  const cached = cache.get(content)
  if (cached) return cached
  const { text } = content
  const answer =
    text.split('\n', MAX_LINES + 1).length > MAX_LINES
      ? Promise.resolve(null)
      : new Promise<Token[][] | null>((resolve) => {
          const id = ++asked
          waiting.set(id, { content, done: resolve })
          highlighter().postMessage({ id, text, lang } satisfies Asked, [])
        })
  cache.set(content, answer)
  return answer
}
