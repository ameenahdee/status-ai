// Reading project history from stored data. Pure functions (no React, no storage), used by the
// upcoming "What Changed" feature. They never modify anything.
//
// Rules (agreed for historical report selection):
//   1. Only reports of the SAME project are compared.
//   2. Chronological order comes from the reporting-period END date, never from display order or save time.
//   3. Demo reports and saved sample copies are EXCLUDED (they are illustrative, not project history).
//   4. Exact duplicate periods are handled explicitly (collapsed to the most recently saved, and flagged).
//   5. Overlapping periods are flagged.
//   6. Back-filled reports (saved late, for an earlier period) are never treated as the latest report.
//   7. Nothing here infers that an item missing from a later report was resolved: this module only
//      chooses WHICH report to compare against; it says nothing about content.

import { isIsoDay } from './schema.js'

// A report that counts as the project's real reporting history.
export const isHistoryEligible = (r) => !r?.demo && !r?.sampleCopy

// Usable for ordering: a valid period end (and, if a start is present, one that is not after the end).
export const hasUsablePeriod = (r) =>
  isIsoDay(r?.periodEnd) && (!r.periodStart || (isIsoDay(r.periodStart) && r.periodStart <= r.periodEnd))

// Deterministic order: period end, then period start, then save time, then id (so ties are never arbitrary).
const byPeriod = (a, b) =>
  a.periodEnd.localeCompare(b.periodEnd) ||
  (a.periodStart || '').localeCompare(b.periodStart || '') ||
  (a.savedAt || '').localeCompare(b.savedAt || '') ||
  a.id.localeCompare(b.id)

const sameWindow = (a, b) => a.periodEnd === b.periodEnd && (a.periodStart || '') === (b.periodStart || '')
const overlaps = (a, b) => (a.periodStart || a.periodEnd) <= b.periodEnd && (b.periodStart || b.periodEnd) <= a.periodEnd

// Newest period first by period END (display helper for "latest report"): includes every report it is given,
// but is still based on the period, so a back-filled report is never the latest.
export function latestByPeriod(reports) {
  const usable = reports.filter(hasUsablePeriod)
  if (usable.length) return [...usable].sort(byPeriod).at(-1)
  // nothing has a usable period: fall back to most recently saved so something sensible is shown
  return [...reports].sort((a, b) => (a.savedAt || '').localeCompare(b.savedAt || '')).at(-1) ?? null
}

// The project's reporting history, oldest period first, with flags for anything a person should review.
export function historyFor(state, projectId) {
  const all = state.reports.filter((r) => r.projectId === projectId && isHistoryEligible(r))
  const excluded = all.filter((r) => !hasUsablePeriod(r)).map((r) => r.id) // cannot be ordered
  const ordered = all.filter(hasUsablePeriod).sort(byPeriod)
  const latest = ordered.at(-1) ?? null
  const entries = ordered.map((report) => ({
    report,
    flags: {
      duplicatePeriodOf: ordered.filter((o) => o.id !== report.id && sameWindow(o, report)).map((o) => o.id),
      overlaps: ordered.filter((o) => o.id !== report.id && !sameWindow(o, report) && overlaps(o, report)).map((o) => o.id),
      // saved after a report that covers a LATER period
      backFilled: latest ? report.periodEnd < latest.periodEnd && ordered.some((o) => o.periodEnd > report.periodEnd && (o.savedAt || '') < (report.savedAt || '')) : false,
    },
  }))
  return { entries, latest, excluded }
}

// The latest real report for a project, chosen by period end (never by save time, display order or array position).
export const latestLiveReport = (state, projectId) => historyFor(state, projectId).latest

/**
 * The report a given report should be compared against.
 * `target` is a saved report (its id) or a candidate that is not saved yet: { projectId, periodStart, periodEnd, id? }.
 * Returns { status: 'found' | 'none' | 'unavailable', reason, report, needsReview, flags }.
 *   found        `report` is the previous report. `needsReview` is true if anything below makes it uncertain.
 *   none         no earlier report exists (so comparison is unavailable, and the caller must say so).
 *   unavailable  the target itself cannot be placed in history (demo/sample, or no usable period).
 * flags: { duplicatePeriods, overlapsPrevious, targetIsBackFilled, sharedEndDate }  (lists of report ids / booleans)
 */
export function previousReportFor(state, target) {
  const saved = target.id ? state.reports.find((r) => r.id === target.id) : null
  const t = saved ?? target
  const none = (status, reason) => ({ status, reason, report: null, needsReview: false, flags: { duplicatePeriods: [], overlapsPrevious: false, targetIsBackFilled: false, sharedEndDate: [] } })
  // Only an id was given and no such report exists (for example it has been deleted): nothing to compare.
  if (!saved && target.id && !target.projectId) return none('unavailable', 'report-not-found')
  if (!t.projectId) return none('unavailable', 'no-project')
  if (!isHistoryEligible(t)) return none('unavailable', 'not-live-report')
  if (!hasUsablePeriod(t)) return none('unavailable', 'no-usable-period')

  const others = state.reports.filter((r) => r.projectId === t.projectId && r.id !== t.id && isHistoryEligible(r) && hasUsablePeriod(r))
  const duplicatePeriods = others.filter((o) => sameWindow(o, t)).map((o) => o.id) // same period saved more than once
  const targetIsBackFilled = others.some((o) => o.periodEnd > t.periodEnd)

  // Candidates: strictly earlier period end, with exact-duplicate periods collapsed to the latest save.
  const earlier = others.filter((o) => o.periodEnd < t.periodEnd)
  const collapsed = []
  for (const r of [...earlier].sort(byPeriod)) {
    const i = collapsed.findIndex((c) => sameWindow(c, r))
    if (i === -1) collapsed.push(r)
    else if ((r.savedAt || '') >= (collapsed[i].savedAt || '')) collapsed[i] = r // newest save of that period represents it
  }
  const previous = collapsed.sort(byPeriod).at(-1) ?? null
  if (!previous) {
    return { ...none('none', 'no-earlier-report'), flags: { duplicatePeriods, overlapsPrevious: false, targetIsBackFilled, sharedEndDate: [] } }
  }
  const sharedEndDate = collapsed.filter((c) => c.id !== previous.id && c.periodEnd === previous.periodEnd).map((c) => c.id)
  const overlapsPrevious = overlaps(previous, t)
  const collapsedAway = earlier.filter((r) => sameWindow(r, previous) && r.id !== previous.id).map((r) => r.id)
  const flags = {
    duplicatePeriods: [...new Set([...duplicatePeriods, ...collapsedAway])],
    overlapsPrevious,
    targetIsBackFilled,
    sharedEndDate,
  }
  const needsReview = flags.duplicatePeriods.length > 0 || overlapsPrevious || targetIsBackFilled || sharedEndDate.length > 0
  return { status: 'found', reason: null, report: previous, needsReview, flags }
}

/**
 * Which saved report a NEW (or saved) report should be compared with for "What Changed Since Last Report".
 * It is exactly previousReportFor (same project, by period END, never demo or sample copies, never the report itself,
 * duplicates collapsed), plus plain-language notes for anything uncertain about that choice.
 * Returns { status: 'found' | 'none' | 'unavailable', report, notes: string[], reason }.
 */
export function comparisonBaselineFor(state, target) {
  const res = previousReportFor(state, target)
  if (res.status !== 'found') return { status: res.status === 'none' ? 'none' : 'unavailable', report: null, notes: [], reason: res.reason }
  const f = res.flags
  const notes = []
  if (f.duplicatePeriods.length) notes.push('More than one report exists for the previous reporting period; the most recently saved one was used.')
  if (f.overlapsPrevious) notes.push('The previous report\'s reporting period overlaps this one.')
  if (f.targetIsBackFilled) notes.push('A report for a later period already exists; this report was compared with the report before it.')
  if (f.sharedEndDate.length) notes.push('Several earlier reports end on the same date; the most recent period was used.')
  return { status: 'found', report: res.report, notes, reason: null }
}

// ONE active saved report per project for an identical reporting period (same project, same start, same end).
// Only real reports count: demo reports and sample copies are illustrative and never block anything. Overlapping
// but different periods are allowed. This is the single definition of "duplicate", used by the store (which enforces
// it when saving) and the composer (which warns before generating).
export const DUPLICATE_PERIOD_MESSAGE =
  'A report already exists for this project and reporting period. You can edit the existing report or delete it before creating another.'

export function findReportForPeriod(state, { projectId, periodStart, periodEnd, excludeId = null }) {
  if (!projectId || !isIsoDay(periodStart) || !isIsoDay(periodEnd)) return null
  return (
    state.reports.find(
      (r) => r.id !== excludeId && r.projectId === projectId && isHistoryEligible(r) && r.periodStart === periodStart && r.periodEnd === periodEnd,
    ) ?? null
  )
}

// Whether the report a status-history entry refers to can still be opened.
//   'none'         the entry was not tied to a report (for example a manual change)
//   'available'    the report exists
//   'deleted'      the report was deleted (the entry is kept and marked)
//   'unavailable'  the report is missing but was never marked deleted (for example older or restored data)
export function reportRefState(state, entry) {
  if (!entry?.reportId) return 'none'
  if (state.reports.some((r) => r.id === entry.reportId)) return 'available'
  return entry.reportDeleted ? 'deleted' : 'unavailable'
}

// A project's recorded status changes, oldest first (ties keep their recorded order). Links by id only.
export function statusHistoryFor(state, projectId) {
  return (state.statusHistory ?? [])
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.projectId === projectId)
    .sort((a, b) => a.entry.at.localeCompare(b.entry.at) || a.i - b.i)
    .map(({ entry }) => entry)
}
