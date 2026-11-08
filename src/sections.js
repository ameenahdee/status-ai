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

// meta: { projectName, periodStart, periodEnd, generatedAt, savedAt, isSample }
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
  return out.join('\n').trim()
}

// Textarea content <-> list of items
export const toLines = (arr) => (arr || []).join('\n')
export const fromLines = (s) =>
  s.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean)
