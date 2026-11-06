import { useSyncExternalStore } from 'react'
import { buildDemo } from './demo.js'

// All MVP data lives in this browser's localStorage. Shape is future-friendly:
// stable UUIDs, ISO timestamps, original updates and reporting periods preserved.
const KEY = 'statusai.v1'
export const STATUSES = ['On Track', 'At Risk', 'Blocked', 'Off Track']

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    if (Array.isArray(s?.projects) && Array.isArray(s?.reports)) return s
  } catch {
    /* fall through to empty state */
  }
  return { version: 1, projects: [], reports: [] }
}

let state = load()
const listeners = new Set()

function commit(next) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch (e) {
    console.warn('Could not persist data to localStorage', e)
  }
  listeners.forEach((l) => l())
}

export const useStore = () =>
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )

const now = () => new Date().toISOString()

export const actions = {
  createProject({ name, startDate, description = '', owner = '', audience = '' }) {
    const project = {
      id: uid(),
      name: name.trim(),
      startDate,
      description: description.trim().slice(0, 500),
      owner: owner.trim(),
      audience: audience.trim(),
      status: null, // never invented: set by the Project Manager (or from a report they save)
      statusSource: null,
      createdAt: now(),
    }
    commit({ ...state, projects: [project, ...state.projects] })
    return project
  },

  updateProject(id, { name, startDate, description, owner, audience }) {
    commit({
      ...state,
      projects: state.projects.map((p) =>
        p.id === id
          ? {
              ...p,
              name: name.trim(),
              startDate,
              description: description.trim(),
              owner: owner.trim(),
              audience: audience.trim(),
            }
          : p,
      ),
    })
  },

  setProjectStatus(id, status, source = { type: 'manual' }) {
    commit({
      ...state,
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, status: status || null, statusSource: status ? { ...source, at: now() } : null } : p,
      ),
    })
  },

  addReport({ projectId, title, originalUpdate, periodStart, periodEnd, content, projectStatusAtReport }) {
    const report = {
      id: uid(),
      projectId,
      title,
      originalUpdate, // never modified after creation
      periodStart,
      periodEnd,
      generatedAt: now(), // separate from the reporting period
      updatedAt: null,
      source: 'ai',
      projectStatusAtReport: projectStatusAtReport || null,
      content,
    }
    commit({ ...state, reports: [report, ...state.reports] })
    return report
  },

  // Only the generated content can change; originalUpdate and dates are immutable here.
  updateReportContent(id, content) {
    commit({
      ...state,
      reports: state.reports.map((r) =>
        r.id === id ? { ...r, content, title: content.title || r.title, updatedAt: now() } : r,
      ),
    })
  },

  deleteReport(id) {
    commit({ ...state, reports: state.reports.filter((r) => r.id !== id) })
  },

  // Demo workspace: illustrative records, flagged `demo: true`, fixed IDs (no duplicates on reload).
  loadDemo() {
    const demo = buildDemo(new Date())
    const haveP = new Set(state.projects.map((p) => p.id))
    const haveR = new Set(state.reports.map((r) => r.id))
    const newP = demo.projects.filter((p) => !haveP.has(p.id))
    const newR = demo.reports.filter((r) => !haveR.has(r.id))
    if (newP.length || newR.length)
      commit({ ...state, projects: [...state.projects, ...newP], reports: [...state.reports, ...newR] })
    return { addedProjects: newP.length, addedReports: newR.length }
  },

  // Removes ONLY demo records. A report the user saved against a demo project is the user's own
  // data, so that project is kept and becomes a normal (non-demo) project.
  resetDemo() {
    const userReportProjectIds = new Set(state.reports.filter((r) => !r.demo).map((r) => r.projectId))
    const removedReports = state.reports.filter((r) => r.demo).length
    const demoProjects = state.projects.filter((p) => p.demo)
    const kept = demoProjects.filter((p) => userReportProjectIds.has(p.id))
    const removedProjects = demoProjects.length - kept.length
    commit({
      ...state,
      projects: state.projects
        .filter((p) => !p.demo || userReportProjectIds.has(p.id))
        .map((p) => (p.demo ? { ...p, demo: false } : p)),
      reports: state.reports.filter((r) => !r.demo),
    })
    return { removedProjects, removedReports, keptProjects: kept.length }
  },
}

export const hasDemo = (s) => s.projects.some((p) => p.demo) || s.reports.some((r) => r.demo)

export const reportsFor = (s, projectId) =>
  s.reports.filter((r) => r.projectId === projectId).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
