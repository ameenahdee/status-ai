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

// Sample, demo and sample-copy reports are illustrative, so they are never labelled "Generated".
export const dateLabel = (r) => (r?.sampleCopy ? 'Saved' : r?.demo ? 'Dated' : 'Generated')

// meta: { projectName, periodStart, periodEnd, generatedAt, isSample }
export function metaLines(meta = {}) {
  const lines = []
  if (meta.isSample) lines.push('SAMPLE REPORT – illustrative output, not generated live')
  if (meta.projectName) lines.push(`Project: ${meta.projectName}`)
  lines.push(`Reporting period: ${fmtPeriod(meta.periodStart, meta.periodEnd)}`)
  if (meta.generatedAt && !meta.isSample) lines.push(`Generated: ${fmtStamp(meta.generatedAt)}`)
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
