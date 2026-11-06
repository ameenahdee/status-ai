import { jsPDF } from 'jspdf'
import { SECTIONS, itemsOf, metaLines } from './sections.js'

export function downloadPdf(r, meta = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 48
  const maxW = W - M * 2
  const info = metaLines(meta)
  const headH = 70 + info.length * 14
  doc.setFillColor(53, 16, 68)
  doc.rect(0, 0, W, headH, 'F')
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(20)
  doc.text(r.title || 'Project Status Report', M, 42, { maxWidth: maxW })
  doc.setFont('helvetica', 'normal').setFontSize(10)
  info.forEach((l, i) => doc.text(l, M, 62 + i * 14, { maxWidth: maxW }))
  doc.setTextColor(252, 231, 243)
  doc.text('Status AI', W - M, headH - 12, { align: 'right' })

  let y = headH + 34
  const ensure = (h) => {
    if (y + h > H - M) {
      doc.addPage()
      y = M
    }
  }
  for (const s of SECTIONS) {
    ensure(40)
    doc.setTextColor(217, 76, 155).setFont('helvetica', 'bold').setFontSize(12)
    doc.text(s.label, M, y)
    y += 8
    doc.setDrawColor(217, 76, 155)
    doc.line(M, y, M + 36, y)
    y += 16
    doc.setTextColor(36, 27, 41).setFont('helvetica', 'normal').setFontSize(10.5)
    for (const item of itemsOf(r, s)) {
      const lines = doc.splitTextToSize(item, s.text ? maxW : maxW - 14)
      lines.forEach((line, i) => {
        ensure(15)
        if (!s.text && i === 0) doc.text('•', M + 2, y)
        doc.text(line, s.text ? M : M + 14, y)
        y += 15
      })
      if (!s.text) y += 3
    }
    y += 14
  }
  const name = (meta.projectName || r.title || 'status-report').replace(/[^\w-]+/g, '-').toLowerCase()
  doc.save(`${name}${meta.isSample ? '-sample' : ''}.pdf`)
}
