// Storage schema: version, structural validators, and the version 1 -> 2 migration.
// Pure functions only (no React, no storage access), so everything here is unit-testable.
//
// Conventions used for values that may not be known:
//   * `null`            = there is no value (not set / does not apply)
//   * `provenance`      = says HOW a report's historical values are known. "unknown" is never guessed:
//        'recorded'       captured at the time it happened
//        'recovered'      derived with certainty during migration (see migrateReport)
//        'unknown'        existed once but was never stored and cannot be reconstructed reliably
//        'not-applicable' does not exist for this kind of report (for example no AI output for a demo report)

export const CURRENT_VERSION = 2
export const STATUSES = ['On Track', 'At Risk', 'Blocked', 'Off Track']

// A report can only be saved and shared once the PM has finalised one of the four statuses. "Not set", an empty
// value and "Insufficient Information" are not final statuses.
export const isFinalStatus = (s) => STATUSES.includes(s)

// Who may change a project's status. An AI *recommendation* is deliberately NOT a source: only a status
// the PM has confirmed ('ai-confirmed') or set ('manual', 'report') is ever recorded as a change.
export const STATUS_CHANGE_SOURCES = ['manual', 'report', 'ai-confirmed']
export const PROVENANCE = ['recorded', 'recovered', 'unknown', 'not-applicable']

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
export const isStr = (v) => typeof v === 'string'
const optStr = (v) => v == null || isStr(v)
const optStrList = (v) => v == null || (Array.isArray(v) && v.every(isStr))
const LIST_KEYS = ['completedActivities', 'workInProgress', 'blockers', 'risks', 'nextSteps', 'executiveActionRequired']

export const isIsoTimestamp = (v) => isStr(v) && !Number.isNaN(Date.parse(v))
export const isIsoDay = (v) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

// ---- structural validators (what the app needs in order not to crash; valid records are never altered) ----
export const validContent = (c) =>
  isObject(c) && optStr(c.title) && optStr(c.executiveSummary) && LIST_KEYS.every((k) => optStrList(c[k]))

export const validProject = (p) =>
  isObject(p) && isStr(p.id) && p.id !== '' && isStr(p.name) && isStr(p.startDate) &&
  optStr(p.description) && optStr(p.owner) && optStr(p.audience)

// Version 1 shape (what browsers hold today): generatedAt was a required string (it was the save time).
export const validReportV1 = (r) =>
  isObject(r) && isStr(r.id) && r.id !== '' && isStr(r.projectId) && isStr(r.generatedAt) &&
  optStr(r.title) && optStr(r.originalUpdate) && optStr(r.periodStart) && optStr(r.periodEnd) && validContent(r.content)

// Version 2 shape: savedAt is required, generatedAt may be null, generatedContent may be null.
export const validReportV2 = (r) =>
  isObject(r) && isStr(r.id) && r.id !== '' && isStr(r.projectId) && isStr(r.savedAt) &&
  (r.generatedAt == null || isStr(r.generatedAt)) &&
  optStr(r.title) && optStr(r.originalUpdate) && optStr(r.periodStart) && optStr(r.periodEnd) &&
  validContent(r.content) && (r.generatedContent == null || validContent(r.generatedContent)) &&
  (r.provenance == null || isObject(r.provenance)) && validGeneration(r.generation) &&
  validAssessment(r.assessment) && validStatusDecision(r.statusDecision) &&
  validWhatsChanged(r.whatsChanged) && validWhatsChanged(r.generatedWhatsChanged)

// ---- project health assessment ----
// "Insufficient Information" is an assessment outcome, NOT a project status (it can never become a project's status).
export const INSUFFICIENT = 'Insufficient Information'
export const ASSESSMENT_OUTCOMES = [...STATUSES, INSUFFICIENT]
export const EVIDENCE_SOURCES = ['update', 'description', 'confirmedStatus']
export const DECISION_ACTIONS = ['confirmed', 'overridden', 'no-recommendation']

const validEvidence = (e) => isObject(e) && EVIDENCE_SOURCES.includes(e.source) && isStr(e.quote)

// What the AI recommended, exactly as it was shown to the PM. Null / absent = no assessment was made.
export const validAssessment = (a) =>
  a == null ||
  (isObject(a) && ASSESSMENT_OUTCOMES.includes(a.outcome) && isStr(a.explanation) &&
    Array.isArray(a.evidence) && a.evidence.every(validEvidence) &&
    Array.isArray(a.missingInformation) && a.missingInformation.every(isStr))

// What the PM decided. `status` is the status the PM chose for the report (null = none); `action` says how that
// relates to the AI's recommendation. Only this decision, never the recommendation, can change a project's status.
export const validStatusDecision = (d) =>
  d == null ||
  (isObject(d) && (d.status == null || STATUSES.includes(d.status)) && DECISION_ACTIONS.includes(d.action) && isStr(d.decidedAt))

// Keeps a well-formed assessment (as a copy) and drops anything else. Never repairs or guesses.
export function cleanAssessment(a) {
  if (a == null || !validAssessment(a)) return null
  return {
    outcome: a.outcome,
    explanation: a.explanation,
    evidence: a.evidence.map((e) => ({ source: e.source, quote: e.quote })),
    missingInformation: [...a.missingInformation],
    checks: isObject(a.checks) ? structuredClone(a.checks) : undefined,
  }
}

// ---- What Changed Since Last Report ----
// A comparison with the previous report of the same project. It is stakeholder-facing (the `text` of each item),
// and keeps its `evidence` quotes for the PM only. status: 'none' (no previous report), 'compared', or
// 'unavailable' (a previous report existed but a reliable comparison could not be made). Only 'compared' has items
// and a baseline, so a comparison can never be stored without the report it was made against.
export const CHANGE_CATEGORIES = ['newDevelopments', 'completedResolved', 'continuingBlockers', 'risks', 'progress', 'nextSteps', 'executiveActions']
export const CHANGE_STATES = ['new', 'continuing', 'resolved', 'changed', 'unclear']
export const WHATS_CHANGED_STATUSES = ['none', 'compared', 'unavailable']

// Project health movement: the PM-finalised status of the previous report against the PM-finalised status of this
// one. It is worked out by the app, never by the AI, and an AI recommendation is never used as either status.
//   moved / unchanged             both statuses are known
//   previous-not-recorded         the previous report has no finalised status (for example an older report)
//   current-not-set               the PM has not finalised this report's status yet (nothing is shown or exported)
export const HEALTH_CHANGES = ['moved', 'unchanged', 'previous-not-recorded', 'current-not-set']
export function computeHealthMovement(previous, current) {
  const p = isFinalStatus(previous) ? previous : null
  const c = isFinalStatus(current) ? current : null
  const change = !c ? 'current-not-set' : !p ? 'previous-not-recorded' : p === c ? 'unchanged' : 'moved'
  return { previous: p, current: c, change }
}
const validHealthMovement = (m) =>
  isObject(m) && (m.previous == null || STATUSES.includes(m.previous)) && (m.current == null || STATUSES.includes(m.current)) && HEALTH_CHANGES.includes(m.change)

const validChange = (c) =>
  isObject(c) && CHANGE_CATEGORIES.includes(c.category) && CHANGE_STATES.includes(c.state) && isStr(c.text) && c.text.trim() !== '' &&
  (c.evidence == null || (isObject(c.evidence) && optStr(c.evidence.current) && optStr(c.evidence.previous)))

export const validWhatsChanged = (w) =>
  w == null ||
  (isObject(w) && WHATS_CHANGED_STATUSES.includes(w.status) &&
    (w.notes == null || (Array.isArray(w.notes) && w.notes.every(isStr))) &&
    Array.isArray(w.items) && w.items.every(validChange) &&
    (w.healthMovement == null || (w.status === 'compared' && validHealthMovement(w.healthMovement))) &&
    (w.status === 'compared'
      ? isObject(w.baseline) && isStr(w.baseline.periodEnd) && optStr(w.baseline.reportId) && optStr(w.baseline.periodStart)
      : w.baseline == null && w.items.length === 0))

// Keeps a well-formed comparison (as a copy) and drops anything else. Never repairs or guesses.
export function cleanWhatsChanged(w) {
  if (w == null || !validWhatsChanged(w)) return null
  return {
    status: w.status,
    baseline: w.baseline ? { reportId: w.baseline.reportId ?? null, periodStart: w.baseline.periodStart ?? '', periodEnd: w.baseline.periodEnd } : null,
    notes: [...(w.notes ?? [])],
    ...(w.healthMovement ? { healthMovement: { previous: w.healthMovement.previous ?? null, current: w.healthMovement.current ?? null, change: w.healthMovement.change } } : {}),
    items: w.items.map((i) => ({ category: i.category, state: i.state, text: i.text, evidence: i.evidence ? { current: i.evidence.current ?? null, previous: i.evidence.previous ?? null } : null })),
  }
}

// How the PM's chosen status relates to the AI's recommendation:
//   confirmed          the AI recommended a status and the PM chose that same status
//   overridden         the AI recommended a status and the PM chose something else (or no status)
//   no-recommendation  the AI said "Insufficient Information", so there was nothing to confirm
export function decisionAction(assessment, chosenStatus) {
  if (assessment.outcome === INSUFFICIENT) return 'no-recommendation'
  return (chosenStatus || null) === assessment.outcome ? 'confirmed' : 'overridden'
}

// What produced a live report: the AI model and the prompt version. null = not known / not applicable (see
// `provenance.generation`). A record without the field at all is read the same way: unknown, never guessed.
export const validGeneration = (g) => g == null || (isObject(g) && optStr(g.model) && optStr(g.promptVersion))

// Normalises generation metadata handed to addReport: each value is kept only if it is a non-empty string.
// Returns null when neither is known, so nothing is ever filled in by guesswork.
export function cleanGeneration(g) {
  const pick = (v) => (isStr(v) && v.trim() !== '' ? v : null)
  const model = pick(g?.model)
  const promptVersion = pick(g?.promptVersion)
  return model || promptVersion ? { model, promptVersion } : null
}

export const validHistoryEntry = (h) =>
  isObject(h) && isStr(h.id) && h.id !== '' && isStr(h.projectId) && isStr(h.at) &&
  isStr(h.source) && STATUS_CHANGE_SOURCES.includes(h.source) &&
  (h.previousStatus == null || isStr(h.previousStatus)) && (h.newStatus == null || isStr(h.newStatus)) &&
  (h.reportId == null || isStr(h.reportId)) &&
  (h.reportDeleted == null || typeof h.reportDeleted === 'boolean') && (h.reportDeletedAt == null || isStr(h.reportDeletedAt))

export const emptyState = () => ({ version: CURRENT_VERSION, projects: [], reports: [], statusHistory: [] })

// Stored `version` as a number; anything missing or malformed is treated as the original version 1.
export const storedVersion = (parsed) => (Number.isInteger(parsed?.version) && parsed.version >= 1 ? parsed.version : 1)

// ---- migration 1 -> 2 ----

// A report saved by version 1. Everything is kept exactly as it was; new fields are only ever ADDED.
export function migrateReport(r) {
  if ('savedAt' in r) return r // already version-2 shaped: leave it alone (keeps migration idempotent)
  const live = !r.demo && !r.sampleCopy
  // A live report whose content was never edited still IS the AI's output, so that can be recovered
  // with certainty. Once edited, the original was overwritten and is gone: it stays unknown.
  const neverEdited = r.updatedAt == null
  const recoverable = live && neverEdited
  return {
    ...r,
    // Version 1 stamped `generatedAt` when the report was SAVED (the AI's own time was never kept).
    savedAt: r.generatedAt,
    generatedAt: null,
    generatedContent: recoverable ? structuredClone(r.content) : null,
    // Version 1 never recorded the model or the prompt, and they cannot be reconstructed.
    generation: null,
    provenance: {
      generatedAt: live ? 'unknown' : 'not-applicable',
      generatedContent: !live ? 'not-applicable' : recoverable ? 'recovered' : 'unknown',
      generation: live ? 'unknown' : 'not-applicable',
    },
  }
}

// One anchor entry per project that already has a status: it states WHEN the current status was set and
// by what, and is honest that the earlier status was never recorded. Demo projects get theirs from the
// demo data instead; projects with no usable record of when/how the status was set get none (nothing
// is fabricated).
export function migrationHistoryFor(project) {
  const src = project.statusSource
  if (project.demo || !project.status || !isObject(src) || !isIsoTimestamp(src.at)) return null
  const type = src.type === 'report' ? 'report' : src.type === 'manual' ? 'manual' : null
  if (!type) return null
  return {
    id: `status-migrated-${project.id}`, // deterministic: re-running the migration cannot create a second one
    projectId: project.id,
    previousStatus: null,
    previousStatusKnown: false,
    newStatus: project.status,
    at: src.at,
    source: type,
    reportId: type === 'report' && isStr(src.reportId) ? src.reportId : null,
    migrated: true,
  }
}

// `state` holds already-validated version-1 projects and reports. Returns a version-2 state; nothing is dropped.
export function migrateV1toV2(state) {
  const existing = Array.isArray(state.statusHistory) ? state.statusHistory : []
  const have = new Set(existing.map((h) => h.id))
  const added = []
  const projects = state.projects.map((p) => {
    const entry = migrationHistoryFor(p)
    if (!entry || have.has(entry.id)) return p
    added.push(entry)
    return { ...p, statusSource: { ...p.statusSource, historyId: entry.id } }
  })
  return {
    ...state,
    version: CURRENT_VERSION,
    projects,
    reports: state.reports.map(migrateReport),
    statusHistory: [...existing, ...added],
  }
}
