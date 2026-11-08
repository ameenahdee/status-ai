import { useSyncExternalStore } from 'react'
import { buildDemo } from './demo.js'
import {
  CURRENT_VERSION, STATUSES, STATUS_CHANGE_SOURCES, emptyState, storedVersion, migrateV1toV2, isObject, isIsoTimestamp,
  validContent, validProject, validReportV1, validReportV2, validHistoryEntry, cleanGeneration,
  cleanAssessment, decisionAction, isFinalStatus, cleanWhatsChanged, computeHealthMovement,
} from './schema.js'

// All MVP data lives in this browser's localStorage under one key. The stored object carries a
// `version` (see schema.js) so older data can be migrated safely. Records have stable UUIDs, ISO
// timestamps, and keep original information separate from human-edited output.
const KEY = 'statusai.v1'
// Stored data that cannot be loaded is copied here (never deleted) before the app starts afresh.
const SET_ASIDE_KEY = 'statusai.v1.set-aside'
// A one-time copy of the data exactly as it was before a schema migration (never overwritten).
const PRE_MIGRATION_KEY = 'statusai.v1.pre-v2'
export { STATUSES }
export const DESCRIPTION_MAX = 500
// One rule for every write path, so the limit never depends on which form or caller was used.
const capDescription = (d) => d.trim().slice(0, DESCRIPTION_MAX)

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// Keeps valid records (first one wins if an id repeats) and counts the rest.
function keepValid(list, valid) {
  const seen = new Set()
  const kept = []
  let dropped = 0
  for (const item of list) {
    if (valid(item) && !seen.has(item.id)) {
      seen.add(item.id)
      kept.push(item)
    } else dropped += 1
  }
  return { kept, dropped }
}

const UNREADABLE = { unreadable: true, projects: 0, reports: 0 }

function load() {
  let raw
  try {
    raw = localStorage.getItem(KEY)
  } catch {
    return { state: emptyState(), readBlocked: true } // storage exists but cannot be read right now
  }
  if (raw == null || raw === '') return { state: emptyState() }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { state: emptyState(), setAside: raw, notice: UNREADABLE }
  }
  if (!isObject(parsed) || !Array.isArray(parsed.projects) || !Array.isArray(parsed.reports))
    return { state: emptyState(), setAside: raw, notice: UNREADABLE }

  const version = storedVersion(parsed)
  // Written by a NEWER version of the app: this version cannot interpret it safely, and saving would
  // overwrite fields it does not know about. Leave it exactly where it is and write nothing.
  if (version > CURRENT_VERSION) return { state: emptyState(), newerVersion: true }

  const p = keepValid(parsed.projects, validProject)
  const r = keepValid(parsed.reports, version < 2 ? validReportV1 : validReportV2)
  const historyIsList = parsed.statusHistory == null || Array.isArray(parsed.statusHistory)
  const h = keepValid(historyIsList ? (parsed.statusHistory ?? []) : [], validHistoryEntry)
  const droppedHistory = h.dropped + (historyIsList ? 0 : 1)

  let next = { ...parsed, projects: p.kept, reports: r.kept, statusHistory: h.kept }
  const migrated = version < CURRENT_VERSION
  if (migrated) next = migrateV1toV2(next)

  const out = { state: next, migrated }
  if (p.dropped + r.dropped + droppedHistory) {
    out.setAside = raw
    out.notice = {
      unreadable: false,
      projects: p.dropped,
      reports: r.dropped,
      ...(droppedHistory ? { statusHistory: droppedHistory } : {}),
    }
  } else if (migrated) {
    out.preMigrationBackup = raw
  }
  return out
}

const loaded = load()
let state = loaded.state
// While true, nothing is written: the existing stored data could not be read, could not be backed
// up, or was written by a newer version, so writing would risk overwriting it.
let writesBlocked = !!(loaded.readBlocked || loaded.newerVersion)
// Whether what is on screen is really persisted. `ok:false` must never be presented as "saved".
let persistence = loaded.readBlocked
  ? { ok: false, reason: 'read-blocked', notice: null }
  : loaded.newerVersion
    ? { ok: false, reason: 'newer-version', notice: null }
    : { ok: true, reason: null, notice: loaded.notice ?? null }
if (loaded.setAside != null) {
  const block = (reason) => {
    writesBlocked = true
    persistence = { ok: false, reason, notice: loaded.notice ?? null }
  }
  let existing = null
  let slotReadable = true
  try {
    existing = localStorage.getItem(SET_ASIDE_KEY)
  } catch {
    slotReadable = false
  }
  if (!slotReadable) {
    block('cannot-preserve') // cannot tell whether an earlier backup is there, so assume there is
  } else if (existing != null && existing !== '' && existing !== loaded.setAside) {
    // An earlier backup exists and holds something different. It must never be replaced, and the new
    // unreadable data cannot be saved anywhere else, so stop writing: the next save would destroy it.
    block('backup-exists')
  } else if (existing !== loaded.setAside) {
    try {
      localStorage.setItem(SET_ASIDE_KEY, loaded.setAside)
    } catch {
      block('cannot-preserve')
    }
  }
  // (existing === loaded.setAside: this exact data is already safely backed up, so carrying on is fine)
}
if (loaded.preMigrationBackup != null && !writesBlocked) {
  // The migration only ADDS fields, so this is a safety net rather than a requirement: a copy of the
  // data as it was before, kept once and never overwritten. If it cannot be stored we carry on.
  try {
    const existing = localStorage.getItem(PRE_MIGRATION_KEY)
    if (existing == null || existing === '') localStorage.setItem(PRE_MIGRATION_KEY, loaded.preMigrationBackup)
  } catch {
    /* non-essential */
  }
}

const listeners = new Set()
const subscribe = (cb) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function setPersistence(next) {
  // keep the same object when nothing changed, so subscribers do not re-render needlessly
  if (next.ok !== persistence.ok || next.reason !== persistence.reason) persistence = next
}

function commit(next) {
  state = next
  if (!writesBlocked) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
      setPersistence({ ok: true, reason: null, notice: persistence.notice })
    } catch (e) {
      console.warn('Could not persist data to localStorage', e)
      setPersistence({ ok: false, reason: 'write-failed', notice: persistence.notice })
    }
  }
  listeners.forEach((l) => l())
}

export const useStore = () => useSyncExternalStore(subscribe, () => state)

// { ok, reason: null | 'write-failed' | 'read-blocked' | 'cannot-preserve' | 'backup-exists' | 'newer-version',
//   notice: null | {unreadable, projects, reports, statusHistory?} }
export const getPersistence = () => persistence
export const usePersistence = () => useSyncExternalStore(subscribe, () => persistence)

const now = () => new Date().toISOString()

export const actions = {
  createProject({ name, startDate, description = '', owner = '', audience = '' }) {
    const project = {
      id: uid(),
      name: name.trim(),
      startDate,
      description: capDescription(description),
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
              description: capDescription(description),
              owner: owner.trim(),
              audience: audience.trim(),
            }
          : p,
      ),
    })
  },

  // Changes a project's CONFIRMED status and records the change in the status history. Only a status the
  // PM set or confirmed is ever recorded: `source.type` must be 'manual', 'report' or 'ai-confirmed'. An AI
  // recommendation is not a source, so a recommendation alone can never change a status.
  // Returns the history entry, or null when nothing changed (same status, or unknown project).
  setProjectStatus(id, status, source = { type: 'manual' }) {
    const to = status || null
    if (to !== null && !STATUSES.includes(to)) throw new Error(`Unknown project status: ${status}`)
    if (!STATUS_CHANGE_SOURCES.includes(source?.type)) throw new Error(`Unsupported status change source: ${source?.type}`)
    if (source.type === 'report' && !(typeof source.reportId === 'string' && source.reportId))
      throw new Error('A status set from a report must name that report')
    const project = state.projects.find((p) => p.id === id)
    if (!project || (project.status ?? null) === to) return null // nothing to record, and no rewriting of when/how it was set
    const at = now()
    const entry = {
      id: uid(),
      projectId: id,
      previousStatus: project.status ?? null,
      previousStatusKnown: true,
      newStatus: to,
      at,
      source: source.type,
      reportId: typeof source.reportId === 'string' ? source.reportId : null,
    }
    commit({
      ...state,
      projects: state.projects.map((p) =>
        p.id === id ? { ...p, status: to, statusSource: to ? { ...source, at, historyId: entry.id } : null } : p,
      ),
      statusHistory: [...state.statusHistory, entry],
    })
    return entry
  },

  // Saves a live AI report. Three versions of the content are kept apart:
  //   originalUpdate   what the PM submitted (immutable)
  //   generatedContent the report exactly as the AI produced it (immutable)
  //   content          the current, human-reviewed version (the only one edits change)
  // and three timestamps: generatedAt (when the AI generated it), savedAt (first saved), updatedAt (last edited).
  // `generation` ({model, promptVersion}, as reported by the server) is stored as received and never inferred.
  //
  // `assessment` is the AI's health recommendation, stored exactly as it was shown and never changed afterwards.
  // `statusDecision` records what the PM chose (projectStatusAtReport) and how that relates to it. Both are
  // null when no assessment was made. The recommendation itself never changes any project status.
  //
  // A newly saved report MUST carry a status the PM has finalised (one of the four statuses). This guards the store
  // itself, not just the screen. It applies only to this path (reports the user generates and saves): demo data,
  // sample copies (saveSampleCopy) and records already in storage are not saved through here and are unaffected.
  addReport({ projectId, title, originalUpdate, periodStart, periodEnd, content, generatedContent, generatedAt, generation, assessment, whatsChanged, generatedWhatsChanged, projectStatusAtReport }) {
    if (!isFinalStatus(projectStatusAtReport))
      throw new Error('A report cannot be saved until the project status has been finalised (On Track, At Risk, Blocked or Off Track).')
    const generatedAtValue = isIsoTimestamp(generatedAt) ? generatedAt : null // never substituted with the save time
    const aiOutput = validContent(generatedContent) ? structuredClone(generatedContent) : null
    const generationValue = cleanGeneration(generation)
    const assessmentValue = cleanAssessment(assessment)
    const decidedAt = now()
    const statusDecision = assessmentValue
      ? { status: projectStatusAtReport || null, action: decisionAction(assessmentValue, projectStatusAtReport), decidedAt }
      : null
    const report = {
      id: uid(),
      projectId,
      title,
      originalUpdate, // never modified after creation
      periodStart,
      periodEnd,
      generatedAt: generatedAtValue,
      savedAt: now(),
      updatedAt: null,
      source: 'ai',
      // the status the PM confirmed for this report; later changes to the project never rewrite it
      projectStatusAtReport: projectStatusAtReport || null,
      generatedContent: aiOutput,
      generation: generationValue,
      assessment: assessmentValue,
      statusDecision,
      // What Changed Since Last Report: the final version (the PM may remove items) and as the AI produced it.
      whatsChanged: withHealthMovement(cleanWhatsChanged(whatsChanged), state.reports, projectStatusAtReport),
      generatedWhatsChanged: withoutHealthMovement(cleanWhatsChanged(generatedWhatsChanged)),
      content: structuredClone(content),
      provenance: {
        generatedAt: generatedAtValue ? 'recorded' : 'unknown',
        generatedContent: aiOutput ? 'recorded' : 'unknown',
        generation: generationValue ? 'recorded' : 'unknown',
      },
    }
    commit({ ...state, reports: [report, ...state.reports] })
    return report
  },

  // "Save a Copy" of a sample/demo report into a demo project. The copy is a separate record with a
  // deep-cloned body, so the original is never touched. It is flagged demo (removed by Reset Demo
  // Workspace) and sampleCopy (never presented as live AI output, so it has no AI generation time or output).
  saveSampleCopy({ projectId, content, originalUpdate, periodStart, periodEnd, copiedFrom, projectStatusAtReport = null }) {
    const report = {
      id: uid(),
      projectId,
      title: content.title || 'Sample report',
      originalUpdate,
      periodStart,
      periodEnd,
      generatedAt: null,
      savedAt: now(), // when the copy was saved; shown as "Saved", never "Generated"
      updatedAt: null,
      source: 'sample-copy',
      demo: true,
      sampleCopy: true,
      copiedFrom,
      projectStatusAtReport,
      generatedContent: null,
      content: structuredClone(content),
      generation: null,
      provenance: { generatedAt: 'not-applicable', generatedContent: 'not-applicable', generation: 'not-applicable' },
    }
    commit({ ...state, reports: [report, ...state.reports] })
    return report
  },

  // Try again to persist what is currently in memory (after a failed write). While writes are blocked
  // to protect unreadable stored data, this deliberately writes nothing.
  retrySave() {
    commit(state)
    return persistence
  },

  // Changes the PM-finalised status of a SAVED report (Edit report). Only the PM can do this, to one of the four
  // statuses; an AI recommendation is never used. Returns the status-history entry, or null when nothing changed
  // (same status, unknown report, or a demo report / sample copy, which never touch real status history).
  //   * the report's projectStatusAtReport (and its decision record, relative to the untouched AI recommendation) change
  //   * a status-history entry is ALWAYS recorded: previous status, new status, time and the report
  //   * the PROJECT's current status changes only if it currently comes from this report (otherwise a later manual
  //     change, or a newer report, would be overwritten by editing an old one)
  //   * saved comparisons that show health movement for this report, or against it, are recalculated, so none shows an
  //     outdated movement. Nothing else in a comparison changes.
  updateReportStatus(reportId, status) {
    if (!isFinalStatus(status)) throw new Error('A report status must be On Track, At Risk, Blocked or Off Track.')
    const report = state.reports.find((r) => r.id === reportId)
    if (!report || report.demo || report.sampleCopy) return null
    const previous = isFinalStatus(report.projectStatusAtReport) ? report.projectStatusAtReport : null
    if (previous === status) return null
    const at = now()
    const project = state.projects.find((p) => p.id === report.projectId)
    const src = project?.statusSource
    const fromThisReport = !!project && (src?.type === 'report' || src?.type === 'ai-confirmed') && src.reportId === reportId
    const changesProject = fromThisReport && project.status !== status
    const before = fromThisReport ? project.status ?? null : previous
    const entry = {
      id: uid(),
      projectId: report.projectId,
      previousStatus: before,
      previousStatusKnown: before !== null,
      newStatus: status,
      at,
      source: 'report',
      reportId,
      reportEdit: true, // the status of a saved report was edited
      projectStatusChanged: changesProject,
    }
    let reports = state.reports.map((r) =>
      r.id === reportId
        ? {
            ...r,
            projectStatusAtReport: status,
            updatedAt: at,
            // the AI recommendation stays exactly as it was; only the PM's decision record follows the new status
            statusDecision: r.assessment ? { ...(r.statusDecision ?? {}), status, action: decisionAction(r.assessment, status), decidedAt: at } : r.statusDecision ?? null,
          }
        : r,
    )
    reports = refreshHealthMovement(reports, reportId)
    commit({
      ...state,
      reports,
      projects: changesProject
        ? state.projects.map((p) => (p.id === project.id ? { ...p, status, statusSource: { type: 'report', reportId, at, historyId: entry.id } } : p))
        : state.projects,
      statusHistory: [...state.statusHistory, entry],
    })
    return entry
  },

  // Only the current (human-reviewed) content can change. originalUpdate, generatedContent, the reporting
  // period and generatedAt / savedAt are immutable here; updatedAt records the edit.
  updateReportContent(id, content) {
    commit({
      ...state,
      reports: state.reports.map((r) =>
        r.id === id ? { ...r, content: structuredClone(content), title: content.title || r.title, updatedAt: now() } : r,
      ),
    })
  },

  // Deleting a report never rewrites the record of what happened. Status-history entries that point at it are
  // KEPT and marked `reportDeleted` (their reportId stays, so it is still clear which report it was). The
  // project's current status and statusSource are left exactly as they are. Unknown id: nothing changes.
  deleteReport(id) {
    if (!state.reports.some((r) => r.id === id)) return commit({ ...state })
    const at = now()
    commit({
      ...state,
      reports: state.reports.filter((r) => r.id !== id),
      statusHistory: state.statusHistory.map((h) =>
        h.reportId === id && !h.reportDeleted ? { ...h, reportDeleted: true, reportDeletedAt: at } : h,
      ),
    })
  },

  // Demo workspace: illustrative records, flagged `demo: true`, fixed IDs (no duplicates on reload).
  loadDemo() {
    const demo = buildDemo(new Date())
    const haveP = new Set(state.projects.map((p) => p.id))
    const haveR = new Set(state.reports.map((r) => r.id))
    const haveH = new Set(state.statusHistory.map((h) => h.id))
    const newP = demo.projects.filter((p) => !haveP.has(p.id))
    const newR = demo.reports.filter((r) => !haveR.has(r.id))
    const projects = [...state.projects, ...newP]
    // demo status history is only attached to projects that are still demo projects
    const demoIds = new Set(projects.filter((p) => p.demo).map((p) => p.id))
    const newH = demo.statusHistory.filter((h) => !haveH.has(h.id) && demoIds.has(h.projectId))
    // a demo report that was deleted and is now restored (same fixed id) is no longer "deleted"
    const restored = new Set(newR.map((r) => r.id))
    const history = state.statusHistory.map((h) => {
      if (!h.reportDeleted || !restored.has(h.reportId)) return h
      const { reportDeleted: _d, reportDeletedAt: _a, ...rest } = h
      return rest
    })
    const historyChanged = history.some((h, i) => h !== state.statusHistory[i])
    if (newP.length || newR.length || newH.length || historyChanged)
      commit({ ...state, projects, reports: [...state.reports, ...newR], statusHistory: [...history, ...newH] })
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
    const removedHistoryIds = new Set(state.statusHistory.filter((h) => h.demo).map((h) => h.id))
    commit({
      ...state,
      projects: state.projects
        .filter((p) => !p.demo || userReportProjectIds.has(p.id))
        .map((p) => {
          if (!p.demo) return p
          // the project is now the user's own: it must not point at demo history that has just been removed
          const { historyId, ...src } = p.statusSource ?? {}
          return { ...p, demo: false, statusSource: p.statusSource ? (removedHistoryIds.has(historyId) ? src : p.statusSource) : p.statusSource }
        }),
      reports: state.reports.filter((r) => !r.demo),
      statusHistory: state.statusHistory.filter((h) => !h.demo),
    })
    return { removedProjects, removedReports, keptProjects: kept.length }
  },
}

// Project health movement is added here, by the app, from two PM-finalised statuses: the status finalised on the
// report this was compared with, and the status the PM has just finalised. Whatever the caller sent is ignored,
// and no AI recommendation is ever used.
function withHealthMovement(wc, reports, currentStatus) {
  if (!wc || wc.status !== 'compared') return wc && { ...wc, healthMovement: undefined }
  const base = reports.find((r) => r.id === wc.baseline?.reportId)
  return { ...wc, healthMovement: computeHealthMovement(base?.projectStatusAtReport, currentStatus) }
}
// After a report's status changes: its own movement (against what it was compared with) and the movement of every
// saved report that was compared WITH it are recalculated from the two PM-finalised statuses.
function refreshHealthMovement(reports, changedId) {
  const byId = new Map(reports.map((r) => [r.id, r]))
  return reports.map((r) => {
    const wc = r.whatsChanged
    if (!wc || wc.status !== 'compared') return r
    if (r.id !== changedId && wc.baseline?.reportId !== changedId) return r
    const base = byId.get(wc.baseline?.reportId)
    return { ...r, whatsChanged: { ...wc, healthMovement: computeHealthMovement(base?.projectStatusAtReport, r.projectStatusAtReport) } }
  })
}
const withoutHealthMovement = (wc) => {
  if (!wc) return wc
  const { healthMovement: _ignored, ...rest } = wc
  return rest
}

export const hasDemo = (s) => s.projects.some((p) => p.demo) || s.reports.some((r) => r.demo)

// A project's reports, most recently SAVED first. (This is display order only: it is not reporting-period
// order. For historical selection use history.js, which orders by period end.)
export const reportsFor = (s, projectId) =>
  s.reports.filter((r) => r.projectId === projectId).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
