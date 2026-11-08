import { useEffect, useRef, useState } from 'react'
import { SECTIONS, itemsOf, isEmptySection, toLines, fromLines, fmtPeriod, fmtStamp, reportStamp } from './sections.js'
import { copyReport, emailReport, exportPdf, metaOf } from './exporters.js'
import { actions } from './store.js'
import { navigate } from './router.js'

const STATUS_META = {
  'On Track': { cls: 'ok', glyph: '●' },
  'At Risk': { cls: 'warn', glyph: '▲' },
  Blocked: { cls: 'bad', glyph: '■' },
  'Off Track': { cls: 'off', glyph: '✕' },
}

export function StatusBadge({ status, empty = 'Status not set' }) {
  const m = STATUS_META[status]
  if (!m) return <span className="status none">{empty}</span>
  return (
    <span className={`status ${m.cls}`}>
      <span aria-hidden="true">{m.glyph}</span> {status}
    </span>
  )
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// children may be a function receiving `close`, which plays the exit transition before unmounting.
export function Modal({ title, onClose, children }) {
  const [closing, setClosing] = useState(false)
  const close = () => {
    if (prefersReducedMotion()) onClose()
    else setClosing(true)
  }
  const handlers = useRef({ close, onClose })
  useEffect(() => {
    handlers.current = { close, onClose }
  })

  // After the exit transition has played, actually unmount
  useEffect(() => {
    if (!closing) return undefined
    const t = setTimeout(() => handlers.current.onClose(), 180)
    return () => clearTimeout(t)
  }, [closing])

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && handlers.current.close()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden' // no background scroll behind the dialog
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('keydown', k)
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div className={`backdrop ${closing ? 'closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      {(close) => (
        <>
          <p className="muted">{message}</p>
          <div className="actions end">
            <button className="ghost" onClick={close}>Cancel</button>
            <button className="danger-btn" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// Brief, polite confirmation (e.g. "Report saved"); clears itself
export function Toast({ message, onDone, tone = 'ok' }) {
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })
  useEffect(() => {
    if (!message) return undefined
    const t = setTimeout(() => doneRef.current(), 3500)
    return () => clearTimeout(t)
  }, [message])
  if (!message) return null
  const warn = tone === 'warn'
  return (
    <div className={`toast ${warn ? 'warn' : ''}`} role={warn ? 'alert' : 'status'}>
      <span aria-hidden="true">{warn ? '!' : '✓'}</span> {message}
    </div>
  )
}

export const DemoBadge = ({ label = 'Demo' }) => <span className="demo-badge" title="Illustrative content, not generated live">{label}</span>

export function Menu({ items, label = 'Actions' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const k = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>⋯</button>
      {/* always mounted so it can fade/scale; hidden items are removed from tab order via visibility */}
      <ul role="menu" className={`menu-list ${open ? 'open' : ''}`} aria-hidden={!open}>
        {items.map((it) => (
          <li key={it.label} role="none">
            <button role="menuitem" className={it.danger ? 'danger' : ''} onClick={() => { setOpen(false); it.onClick() }}>
              {it.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Read-only or editable view of the seven sections
export function ReportBody({ content, editing, onChange }) {
  return (
    <div className="rbody">
      {editing && (
        <input className="title-input" value={content.title || ''} onChange={(e) => onChange('title', e.target.value)} aria-label="Report title" />
      )}
      {SECTIONS.map((s) => {
        const empty = isEmptySection(content, s)
        return (
          <div key={s.key} className={`sec ${s.key === 'executiveActionRequired' ? 'action' : ''}`}>
            <h3>{s.label}</h3>
            {editing ? (
              <textarea
                rows={s.text ? 4 : Math.max(2, (content[s.key]?.length || 0) + 1)}
                value={s.text ? content[s.key] || '' : toLines(content[s.key])}
                onChange={(e) => onChange(s.key, s.text ? e.target.value : fromLines(e.target.value))}
                placeholder={s.text ? '' : 'One item per line'}
                aria-label={s.label}
              />
            ) : s.text ? (
              <p className={empty ? 'faint' : ''}>{itemsOf(content, s)[0]}</p>
            ) : (
              <ul className={empty ? 'faint' : ''}>
                {itemsOf(content, s).map((i, n) => <li key={n}>{i}</li>)}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Copy / Email / PDF buttons for any content + meta
export function ExportButtons({ content, meta }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <button className="ghost" onClick={async () => { await copyReport(content, meta); setCopied(true); setTimeout(() => setCopied(false), 1800) }}>
        {copied ? 'Copied ✓' : 'Copy report'}
      </button>
      <button className="ghost" onClick={() => emailReport(content, meta)}>Email draft</button>
      <button className="ghost" onClick={() => exportPdf(content, meta)}>Export PDF</button>
    </>
  )
}

export function ReportCard({ report, project }) {
  const [confirm, setConfirm] = useState(false)
  const [note, setNote] = useState('')
  const meta = metaOf(report, project)
  const flash = (t) => { setNote(t); setTimeout(() => setNote(''), 1800) }
  return (
    <article className="card rcard">
      <div className="rcard-top">
        <a className="rcard-title" href={`#/reports/${report.id}`}>{report.title}{report.demo && <> <DemoBadge label={report.sampleCopy ? 'Sample copy' : 'Demo'} /></>}</a>
        <Menu
          label={`Actions for ${report.title}`}
          items={[
            { label: 'Open report', onClick: () => navigate(`/reports/${report.id}`) },
            { label: 'Edit report', onClick: () => navigate(`/reports/${report.id}?edit=1`) },
            { label: 'Copy report', onClick: async () => { await copyReport(report.content, meta); flash('Copied ✓') } },
            { label: 'Export PDF', onClick: () => exportPdf(report.content, meta) },
            { label: 'Email draft', onClick: () => emailReport(report.content, meta) },
            { label: 'Delete report', danger: true, onClick: () => setConfirm(true) },
          ]}
        />
      </div>
      <p className="rcard-project">{project?.name || 'Unknown project'}</p>
      <p className="excerpt">{itemsOf(report.content, SECTIONS[0])[0]}</p>
      <dl className="facts">
        <div><dt>Period</dt><dd>{fmtPeriod(report.periodStart, report.periodEnd)}</dd></div>
        <div><dt>{reportStamp(report).label}</dt><dd>{fmtStamp(reportStamp(report).iso)}</dd></div>
      </dl>
      <div className="rcard-foot">
        <StatusBadge status={report.projectStatusAtReport} empty="Status not recorded" />
        {note && <span className="faint">{note}</span>}
      </div>
      {confirm && (
        <ConfirmDialog
          title="Delete this report?"
          message={`“${report.title}” will be permanently removed from this browser. This cannot be undone.`}
          onCancel={() => setConfirm(false)}
          onConfirm={() => { actions.deleteReport(report.id); setConfirm(false) }}
        />
      )}
    </article>
  )
}

export const EmptyState = ({ title, children }) => (
  <div className="empty">
    <h3>{title}</h3>
    <div>{children}</div>
  </div>
)
