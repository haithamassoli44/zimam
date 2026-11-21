import { computed, reactive, watch } from 'vue'

import { defaultFilters, toQuery, type Filters } from '@/lib/filters'
import { randomId } from '@/lib/text'
import { DENSITIES, LOCALES, ROW_PARTS, THEMES, type Preset, type Settings, type Source, type Workspace } from '@/types'

const STORAGE_KEY = 'zimam:settings'

export const WORKSPACE_PARAM = 'w'

function defaults(): Settings {
  const arabic = globalThis.navigator?.languages?.some((language) => language.startsWith('ar')) ?? false
  return {
    locale: arabic ? 'ar' : 'en',
    theme: 'system',
    density: 'comfortable',
    show: Object.fromEntries(ROW_PARTS.map((part) => [part, true])) as Settings['show'],
    workspaces: [],
    activeWorkspaceId: null,
  }
}

const isWorkspace = (ws: Partial<Workspace>): ws is Workspace =>
  typeof ws?.id === 'string' && Array.isArray(ws.sources) && Array.isArray(ws.views)

const pick = <T>(known: readonly T[], value: T | undefined, fallback: T) =>
  value !== undefined && known.includes(value) ? value : fallback

// Stored, imported and other tabs' settings all come in through here, so they get the same defaults and checks.
function parse(raw: unknown): Settings {
  const data = (raw ?? {}) as Partial<Settings>
  const base = defaults()
  return {
    locale: pick(LOCALES, data.locale, base.locale),
    theme: pick(THEMES, data.theme, base.theme),
    density: pick(DENSITIES, data.density, base.density),
    show: Object.fromEntries(ROW_PARTS.map((part) => [part, data.show?.[part] ?? true])) as Settings['show'],
    workspaces: (Array.isArray(data.workspaces) ? data.workspaces : []).filter(isWorkspace),
    activeWorkspaceId: typeof data.activeWorkspaceId === 'string' ? data.activeWorkspaceId : null,
  }
}

function read(text: string | null): Settings | null {
  try {
    return text ? parse(JSON.parse(text)) : null
  } catch {
    return null
  }
}

let stored: string | null = null
try {
  stored = localStorage.getItem(STORAGE_KEY)
} catch {
  // Private windows can refuse storage. Zimam still works until the tab closes.
}

export const settings = reactive<Settings>(read(stored) ?? defaults())

const requested = new URLSearchParams(globalThis.location?.search).get(WORKSPACE_PARAM)
if (requested && settings.workspaces.some((ws) => ws.id === requested)) settings.activeWorkspaceId = requested

// What this tab last wrote or took from another tab. Writing that back would bounce between tabs that have
// different workspaces open.
let known = stored

watch(
  settings,
  () => {
    const json = JSON.stringify(settings)
    if (json === known) return
    known = json
    try {
      localStorage.setItem(STORAGE_KEY, json)
    } catch {
      // As above: without storage, settings last until the tab closes.
    }
  },
  { deep: true },
)

// Another tab saved its settings: take them, but keep the workspace this tab has open.
globalThis.addEventListener?.('storage', (event) => {
  if (event.key !== STORAGE_KEY) return
  const next = read(event.newValue)
  if (!next) return
  Object.assign(settings, { ...next, activeWorkspaceId: settings.activeWorkspaceId })
  known = JSON.stringify(settings)
})

export function exportSettings(): string {
  return JSON.stringify({ ...settings, workspaces: settings.workspaces.map((ws) => ({ ...ws, token: '' })) }, null, 2)
}

/** Takes settings from an exported file. Workspaces keep the tokens this browser already has for them. */
export function importSettings(text: string) {
  const next = parse(JSON.parse(text))
  if (!next.workspaces.length) throw new Error('No workspaces')
  const tokens = new Map(settings.workspaces.map((ws) => [ws.id, ws.token]))
  for (const ws of next.workspaces) ws.token ||= tokens.get(ws.id) ?? ''
  Object.assign(settings, next)
}

export const activeWorkspace = computed<Workspace | null>(
  () => settings.workspaces.find((ws) => ws.id === settings.activeWorkspaceId) ?? settings.workspaces[0] ?? null,
)

const PRESET_FILTERS: Record<Preset, Partial<Filters>> = {
  open: {},
  issues: { kind: ['issue'] },
  prs: { kind: ['pr'] },
  awaiting: { kind: ['pr'], review: ['pending'] },
  quiet: { updated: ['stale'], sort: 'quiet' },
  archive: { state: [], status: ['archived'] },
}

interface WorkspaceFields {
  name: string
  token: string
  sources: Source[]
}

// A workspace always has a name: an emptied one falls back to its first source.
const nameFor = (name: string, sources: Source[]) => name.trim() || sources[0]?.name || 'Zimam'

export function createWorkspace(fields: WorkspaceFields) {
  const views = Object.entries(PRESET_FILTERS).map(([preset, filters]) => ({
    id: randomId(),
    preset: preset as Preset,
    query: toQuery({ ...defaultFilters(), ...filters }),
  }))
  const ws: Workspace = { id: randomId(), ...fields, name: nameFor(fields.name, fields.sources), views }
  settings.workspaces.push(ws)
  settings.activeWorkspaceId = ws.id
}

export function updateWorkspace(id: string, fields: Partial<WorkspaceFields>) {
  const ws = settings.workspaces.find((other) => other.id === id)
  if (!ws) return
  Object.assign(ws, fields)
  ws.name = nameFor(ws.name, ws.sources)
}

export function removeWorkspace(id: string) {
  settings.workspaces = settings.workspaces.filter((ws) => ws.id !== id)
  if (settings.activeWorkspaceId === id) settings.activeWorkspaceId = settings.workspaces[0]?.id ?? null
}
