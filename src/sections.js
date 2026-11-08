export const NOT_SPECIFIED = 'Not specified in the submitted update.'
export const NO_ACTION = 'No executive action required at this time.'

export const SECTIONS = [
  { key: 'executiveSummary', label: 'Executive Summary', text: true },
  { key: 'completedActivities', label: 'Completed Activities' },
  { key: 'workInProgress', label: 'Work in Progress' },
  { key: 'blockers', label: 'Blockers' },
  { key: 'risks', label: 'Risks' },
  { key: 'nextSteps', label: 'Next Steps' },
  { key: 'executiveActionRequired', label: 'Executive Action Required', empty: NO_ACTION },
]

// Items to display/export for a section; all seven sections always show something.
export function itemsOf(r, s) {
  if (s.text) return [r?.[s.key]?.trim() || NOT_SPECIFIED]
  const list = (r?.[s.key] || []).filter(Boolean)
  return list.length ? list : [s.empty || NOT_SPECIFIED]
}
export const isEmptySection = (r, s) => (s.text ? !r?.[s.key]?.trim() : !(r?.[s.key] || []).filter(Boolean).length)

// ---- dates ----
const pad = (n) => String(n).padStart(2, '0')
export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
export const fmtStamp = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
export const fmtPeriod = (start, end) => (start || end ? `${fmtDate(start)} – ${fmtDate(end)}` : 'Not set')

// The date to show for a report, and what to call it. Only a live report whose AI generation time was
// actually recorded is called "Generated". Sample, demo and sample-copy reports are illustrative, and a live
// report saved before generation times were kept shows when it was saved, never a guessed generation time.
export function reportStamp(r) {
  if (r?.sampleCopy) return { label: 'Saved', iso: r.savedAt }
  if (r?.demo) return { label: 'Dated', iso: r.savedAt }
  if (r?.generatedAt) return { label: 'Generated', iso: r.generatedAt }
  return { label: 'Saved', iso: r?.savedAt }
}
export const dateLabel = (r) => reportStamp(r).label

// ---- What Changed Since Last Report (the eighth section) ----
export const WHATS_CHANGED_HEADING = "What Changed Since Last Report"
export const NO_PREVIOUS_MESSAGE = 'No previous report available for comparison.'
export const COMPARISON_UNAVAILABLE_MESSAGE = 'A comparison with the previous report could not be completed reliably.'
export const NO_CHANGES_MESSAGE = 'No changes could be established from the submitted update.'
const CHANGE_GROUPS = [
  ['newDevelopments', 'New developments'],
  ['completedResolved', 'Completed or resolved'],
  ['continuingBlockers', 'Continuing blockers'],
  ['risks', 'Changing risks'],
  ['progress', 'Progress'],
  ['nextSteps', 'Next steps'],
  ['executiveActions', 'Executive actions'],
]
export const CHANGE_STATE_LABEL = { new: 'New', continuing: 'Continuing', resolved: 'Resolved', changed: 'Update', unclear: 'Status unclear' }

// Only what stakeholders may see: no evidence quotes. Anything that is not a valid comparison gives null.
export function stakeholderChanges(wc) {
  if (!wc || typeof wc !== 'object' || !['none', 'compared', 'unavailable'].includes(wc.status)) return null
  return {
    status: wc.status,
    baseline: wc.baseline ? { periodStart: wc.baseline.periodStart, periodEnd: wc.baseline.periodEnd } : null,
    notes: Array.isArray(wc.notes) ? [...wc.notes] : [],
    healthMovement: wc.healthMovement ? { previous: wc.healthMovement.previous ?? null, current: wc.healthMovement.current ?? null, change: wc.healthMovement.change } : null,
    items: Array.isArray(wc.items) ? wc.items.map((i, index) => ({ index, category: i.category, state: i.state, text: i.text })) : [],
  }
}

// One plain sentence about project health movement, from the two PM-finalised statuses only. Nothing is shown
// until the PM has finalised this report's status.
export function healthMovementText(m) {
  if (!m || m.change === 'current-not-set' || !m.current) return null
  if (m.change === 'moved') return `Project Health moved from ${m.previous} to ${m.current}.`
  if (m.change === 'unchanged') return `Project Health is unchanged: ${m.current}.`
  return `Project Health is ${m.current}. The previous report's status was not recorded.`
}

// What to show for the eighth section, as plain data shared by the screen, copy, email and PDF.
export function whatsChangedView(wc) {
  if (!wc) return null
  const base = { heading: WHATS_CHANGED_HEADING, message: null, baseline: null, notes: [], groups: [] }
  if (wc.status === 'none') return { ...base, message: NO_PREVIOUS_MESSAGE }
  if (wc.status !== 'compared') return { ...base, message: COMPARISON_UNAVAILABLE_MESSAGE }
  const items = wc.items || []
  const groups = CHANGE_GROUPS.map(([key, label]) => ({
    key,
    label,
    items: items.map((i, index) => ({ i, index })).filter(({ i }) => i.category === key).map(({ i, index }) => ({ index: i.index ?? index, state: i.state, stateLabel: CHANGE_STATE_LABEL[i.state] || '', text: i.text })),
  })).filter((g) => g.items.length)
  const health = healthMovementText(wc.healthMovement)
  const healthGroup = health ? [{ key: 'projectHealth', label: 'Project health', items: [{ index: -1, fixed: true, state: 'health', stateLabel: '', text: health }] }] : []
  return {
    ...base,
    baseline: wc.baseline ? `Compared with the report for ${fmtPeriod(wc.baseline.periodStart, wc.baseline.periodEnd)}.` : null,
    notes: wc.notes || [],
    message: groups.length ? null : NO_CHANGES_MESSAGE,
    groups: [...healthGroup, ...groups],
  }
}

// meta: { projectName, periodStart, periodEnd, generatedAt, savedAt, isSample, projectHealth, whatsChanged }
export function metaLines(meta = {}) {
  const lines = []
  if (meta.isSample) lines.push('SAMPLE REPORT – illustrative output, not generated live')
  if (meta.projectName) lines.push(`Project: ${meta.projectName}`)
  // The PM's final status is the only health information stakeholders receive.
  if (meta.projectHealth) lines.push(`Project Health: ${meta.projectHealth}`)
  lines.push(`Reporting period: ${fmtPeriod(meta.periodStart, meta.periodEnd)}`)
  if (!meta.isSample) {
    if (meta.generatedAt) lines.push(`Generated: ${fmtStamp(meta.generatedAt)}`)
    else if (meta.savedAt) lines.push(`Saved: ${fmtStamp(meta.savedAt)}`)
  }
  return lines
}

export function reportToText(r, meta) {
  const out = [r.title || 'Project Status Report', ...metaLines(meta), '']
  for (const s of SECTIONS) {
    out.push(s.label.toUpperCase())
    const items = itemsOf(r, s)
    out.push(...(s.text ? items : items.map((i) => `- ${i}`)))
    out.push('')
  }
  // Eighth section, after the existing seven. Only present for reports that were generated with a comparison.
  const wc = whatsChangedView(meta?.whatsChanged)
  if (wc) {
    out.push(wc.heading)
    if (wc.baseline) out.push(wc.baseline)
    if (wc.message) out.push(wc.message)
    for (const g of wc.groups) {
      out.push(g.label)
      out.push(...g.items.map((i) => `- ${i.stateLabel ? `${i.stateLabel}: ` : ''}${i.text}`))
    }
    out.push(...wc.notes.map((n) => `Note: ${n}`))
    out.push('')
  }
  return out.join('\n').trim()
}

// Textarea content <-> list of items
export const toLines = (arr) => (arr || []).join('\n')
export const fromLines = (s) =>
  s.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean)
