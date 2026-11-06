import { reportToText } from './sections.js'

export const metaOf = (report, project) => ({
  projectName: project?.name,
  periodStart: report.periodStart,
  periodEnd: report.periodEnd,
  generatedAt: report.generatedAt,
})

export async function copyReport(content, meta) {
  const text = reportToText(content, meta)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const t = document.createElement('textarea')
    t.value = text
    document.body.appendChild(t)
    t.select()
    document.execCommand('copy')
    t.remove()
  }
}

export function emailReport(content, meta) {
  const subject = encodeURIComponent(content.title || 'Project Status Report')
  const body = encodeURIComponent(reportToText(content, meta))
  window.location.href = `mailto:?subject=${subject}&body=${body}`
}

// jsPDF is loaded lazily to keep the initial bundle small
export async function exportPdf(content, meta) {
  const { downloadPdf } = await import('./pdf.js')
  downloadPdf(content, meta)
}
