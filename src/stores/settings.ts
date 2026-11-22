import { computed, reactive, watch } from 'vue'

import { defaultFilters, fromQuery, toQuery, type Filters } from '@/lib/filters'
import { COUNTS } from '@/lib/repos'
import { randomId } from '@/lib/text'
import {
  DENSITIES,
  INVOLVEMENTS,
  LOCALES,
  ROW_PARTS,
  SOURCE_KINDS,
  THEMES,
  type Preset,
  type Settings,
  type Source,
  type SourceKind,
  type View,
  type Workspace,
} from '@/types'

const STORAGE_KEY = 'zimam:settings'

export const WORKSPACE_PARAM = 'w'

// Settings saved before a version are brought up to date by `upgrade`.
const VERSION = 2

function defaults(): Settings {
  const arabic = globalThis.navigator?.languages?.some((language) => language.startsWith('ar')) ?? false
  return {
    version: VERSION,
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

const isView = (view: Partial<View> | null): view is View =>
  typeof view?.id === 'string' && typeof view.query === 'string'

const isSource = (source: Partial<Source> | null): source is Source =>
  SOURCE_KINDS.includes(source?.kind as SourceKind) && typeof source?.name === 'string'

const isIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.every((id) => typeof id === 'string')

const pick = <T>(known: readonly T[], value: T | undefined, fallback: T) =>
  value !== undefined && known.includes(value) ? value : fallback

// Stored, imported and other tabs' settings all come in through here, so they get the same defaults and checks.
function parse(raw: unknown): Settings {
  const data = (raw ?? {}) as Partial<Settings>
  const base = defaults()
  const workspaces = (Array.isArray(data.workspaces) ? data.workspaces : []).filter(isWorkspace)
  for (const ws of workspaces) {
    ws.views = ws.views.filter(isView)
    ws.sources = ws.sources.filter(isSource)
    if (!isIds(ws.pinned)) ws.pinned = []
    for (const source of ws.sources) if (source.only !== undefined && !isIds(source.only)) delete source.only
    upgrade(ws, typeof data.version === 'number' ? data.version : 1)
  }
  return {
    version: VERSION,
    locale: pick(LOCALES, data.locale, base.locale),
    theme: pick(THEMES, data.theme, base.theme),
    density: pick(DENSITIES, data.density, base.density),
    show: Object.fromEntries(ROW_PARTS.map((part) => [part, data.show?.[part] ?? true])) as Settings['show'],
    workspaces,
    activeWorkspaceId: typeof data.activeWorkspaceId === 'string' ? data.activeWorkspaceId : null,
  }
}

// The repositories page counts what the first views hold, and opens them from its counts.
const PRESET_FILTERS: Record<Preset, Partial<Filters>> = {
  open: {},
  issues: COUNTS.issues.filters,
  prs: { ...COUNTS.prs.filters, sort: 'ready' },
  awaiting: COUNTS.awaiting.filters,
  mine: { me: [...INVOLVEMENTS] },
  quiet: { updated: ['stale'], sort: 'quiet' },
  archive: { state: [], status: ['archived'] },
}

function presetQuery(preset: Preset): string {
  return toQuery({ ...defaultFilters(), ...PRESET_FILTERS[preset] })
}

// Version 2 split "awaiting review" into reviews GitHub requires and those it doesn't, sorted open pull requests by how
// ready they are, and added a view of what involves the person.
function upgrade(ws: Workspace, from: number) {
  if (from >= 2) return
  const plainPrs = toQuery({ ...defaultFilters(), kind: ['pr'] })
  for (const view of ws.views) {
    // Written again as today's filters would write it, so renamed values match their views.
    view.query = view.preset === 'prs' && view.query === plainPrs ? presetQuery('prs') : toQuery(fromQuery(view.query))
  }
  if (ws.views.some((view) => view.preset) && !ws.views.some((view) => view.preset === 'mine')) {
    const awaiting = ws.views.findIndex((view) => view.preset === 'awaiting')
    const at = awaiting === -1 ? ws.views.length : awaiting + 1
    ws.views.splice(at, 0, { id: randomId(), preset: 'mine', query: presetQuery('mine') })
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

const loaded = read(stored)
export const settings = reactive<Settings>(loaded ?? defaults())

// What this tab last wrote or took from another tab. Writing that back would bounce between tabs that have
// different workspaces open.
let known = stored

function save() {
  const json = JSON.stringify(settings)
  if (json === known) return
  known = json
  try {
    localStorage.setItem(STORAGE_KEY, json)
  } catch {
    // As above: without storage, settings last until the tab closes.
  }
}

// Settings an older version saved are saved again as they are now, so their upgrade happens once. Settings that
// couldn't be read are left alone.
if (loaded) save()

const requested = new URLSearchParams(globalThis.location?.search).get(WORKSPACE_PARAM)
if (requested && settings.workspaces.some((ws) => ws.id === requested)) settings.activeWorkspaceId = requested

watch(settings, save, { deep: true })

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

interface WorkspaceFields {
  name: string
  token: string
  sources: Source[]
}

// A workspace always has a name: an emptied one falls back to its first source.
const nameFor = (name: string, sources: Source[]) => name.trim() || sources[0]?.name || 'Zimam'

export function createWorkspace(fields: WorkspaceFields) {
  const views = (Object.keys(PRESET_FILTERS) as Preset[]).map((preset) => ({
    id: randomId(),
    preset,
    query: presetQuery(preset),
  }))
  const ws: Workspace = { id: randomId(), ...fields, name: nameFor(fields.name, fields.sources), views, pinned: [] }
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
