import { useState } from 'react'
import { useStore, actions, getPersistence, STATUSES } from './store.js'
import { navigate } from './router.js'
import { fmtPeriod, fmtStamp, reportStamp } from './sections.js'
import AssessmentPanel from './Assessment.jsx'
import WhatsChanged from './WhatsChanged.jsx'
import { ReportCard, ReportBody, ExportButtons, StatusBadge, ConfirmDialog, EmptyState, DemoBadge, Toast } from './ui.jsx'
import { metaOf } from './exporters.js'
import SaveCopyDialog from './SaveCopy.jsx'

const RECENT_DAYS = 14

export function ReportsPage() {
  const store = useStore()
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [now] = useState(() => Date.now())
  const byId = Object.fromEntries(store.projects.map((p) => [p.id, p]))

  const needle = q.trim().toLowerCase()
  const sorted = [...store.reports].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  const matches = sorted.filter((r) => {
    if (!needle) return true
    const hay = [r.title, byId[r.projectId]?.name, r.content.executiveSummary, r.projectStatusAtReport].join(' ').toLowerCase()
    return hay.includes(needle)
  })
  const cutoff = now - RECENT_DAYS * 86400000
  const shown = tab === 'recent' ? matches.filter((r) => new Date(r.savedAt).getTime() >= cutoff) : matches

  const groups = store.projects
    .map((p) => ({ p, items: matches.filter((r) => r.projectId === p.id) }))
    .filter((g) => g.items.length)

  return (
    <>
      <div className="pagehead">
        <h1>Reports</h1>
        <button className="primary" onClick={() => navigate('/reports/new')}>Create New Report</button>
      </div>
      <div className="filters">
        <div className="tabs" role="tablist">
          {[['all', 'All Reports'], ['recent', 'Recent Reports'], ['project', 'By Project']].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <input type="search" className="search" placeholder="Search reports…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search reports" />
      </div>

      {store.reports.length === 0 ? (
        <EmptyState title="No reports yet">
          <p className="muted">Reports you generate and save will appear here.</p>
          <button className="primary" onClick={() => navigate('/reports/new')}>Create New Report</button>
        </EmptyState>
      ) : tab === 'project' ? (
        groups.length === 0 ? <p className="muted">No reports match your search.</p> :
        groups.map(({ p, items }) => (
          <section key={p.id} className="group">
            <h2><a href={`#/projects/${p.id}`}>{p.name}</a> <span className="faint">({items.length})</span></h2>
            <div className="grid-cards">{items.map((r) => <ReportCard key={r.id} report={r} project={p} />)}</div>
          </section>
        ))
      ) : shown.length === 0 ? (
        <p className="muted">{tab === 'recent' && !needle ? `No reports generated in the last ${RECENT_DAYS} days.` : 'No reports match your search.'}</p>
      ) : (
        <div className="grid-cards">{shown.map((r) => <ReportCard key={r.id} report={r} project={byId[r.projectId]} />)}</div>
      )}
    </>
  )
}

export function ReportView({ id, startEditing, saved, copied }) {
  const store = useStore()
  const report = store.reports.find((r) => r.id === id)
  const [draft, setDraft] = useState(() => (startEditing ? structuredClone(report?.content ?? null) : null))
  const editing = draft !== null
  // the final Project Health status while editing (starts as the report's saved status)
  const [statusDraft, setStatusDraft] = useState(() => report?.projectStatusAtReport ?? '')
  const [confirm, setConfirm] = useState(false)
  const [copying, setCopying] = useState(false)
  // Never claim "saved" unless the data really was written to this browser's storage
  const [toast, setToast] = useState(() => {
    if (!saved && !copied) return null
    const text = saved ? 'Report saved to your project' : 'Sample copy saved to your demo workspace'
    return getPersistence().ok ? { text } : { text: 'Created, but NOT saved to this browser. See the warning above.', warn: true }
  })
  if (!report) return <EmptyState title="Report not found"><a href="#/reports">Back to reports</a></EmptyState>

  const project = store.projects.find((p) => p.id === report.projectId)
  const content = editing ? draft : report.content
  const begin = () => {
    setStatusDraft(report.projectStatusAtReport ?? '')
    setDraft(structuredClone(report.content))
  }
  // Illustrative reports (demo, sample copies) never carry a real status or touch real status history
  const canEditStatus = !report.demo && !report.sampleCopy

  return (
    <>
      <p className="crumbs">
        <a href="#/reports">Reports</a> / {project && <a href={`#/projects/${project.id}`}>{project.name}</a>}
      </p>
      <section className="card">
        <div className="toolbar">
          <div>
            <h1>{report.content.title || report.title}{report.demo && <> <DemoBadge label={report.sampleCopy ? 'Sample copy' : 'Demo'} /></>}</h1>
            <p className="meta-line">
              <a href={`#/projects/${report.projectId}`}>{project?.name || 'Unknown project'}</a>
              {' · '}Period: {fmtPeriod(report.periodStart, report.periodEnd)}
              {' · '}{reportStamp(report).label}: {fmtStamp(reportStamp(report).iso)}
              {report.updatedAt && <> · Edited: {fmtStamp(report.updatedAt)}</>}
            </p>
            <p className="meta-line">
              Project Health:{' '}
              {editing && canEditStatus ? (
                <select aria-label="Final project status" value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)}>
                  {!report.projectStatusAtReport && <option value="" disabled>Not recorded</option>}
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              ) : (
                <StatusBadge status={report.projectStatusAtReport} empty="Not recorded" />
              )}
            </p>
          </div>
          <div className="actions">
            {editing ? (
              <>
                <button className="ghost" onClick={() => setDraft(null)}>Cancel</button>
                <button className="primary" onClick={() => {
                  actions.updateReportContent(id, draft)
                  if (canEditStatus && statusDraft && statusDraft !== report.projectStatusAtReport) actions.updateReportStatus(id, statusDraft)
                  setDraft(null)
                  setToast(getPersistence().ok ? { text: 'Changes saved' } : { text: 'Changes made, but NOT saved to this browser. See the warning above.', warn: true })
                }}>Save changes</button>
              </>
            ) : (
              <>
                {report.demo && !report.sampleCopy && <button className="primary" onClick={() => setCopying(true)}>Save a Copy</button>}
                <button className="ghost" onClick={begin}>Edit</button>
                <ExportButtons content={report.content} meta={metaOf(report, project)} />
                <button className="ghost danger" onClick={() => setConfirm(true)}>Delete</button>
              </>
            )}
          </div>
        </div>
        {report.sampleCopy ? (
          <p className="preview-note demo-note">
            <strong>Sample copy · Demo experience.</strong> Illustrative output — not generated live. Saved from “{store.reports.find((r) => r.id === report.copiedFrom)?.title || 'the sample report'}”; edits to this copy don’t change the original.
          </p>
        ) : report.demo ? (
          <p className="preview-note demo-note">
            <strong>Sample report · Demo experience.</strong> Illustrative output — not generated live. Fictional content authored in advance, not produced by Gemini. Use “Save a Copy” to keep your own editable copy.
          </p>
        ) : null}
        <AssessmentPanel assessment={report.assessment} finalStatus={report.projectStatusAtReport} />
        <ReportBody content={content} editing={editing} onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
        {!report.demo && <WhatsChanged value={report.whatsChanged} />}
        <details className="orig">
          <summary>Original submitted update (read-only)</summary>
          <pre>{report.originalUpdate}</pre>
        </details>
      </section>
      <Toast message={toast?.text ?? ''} tone={toast?.warn ? 'warn' : 'ok'} onDone={() => setToast(null)} />
      {copying && (
        <SaveCopyDialog
          sourceKey={report.id}
          defaultProjectId={report.projectId}
          payload={{
            content: report.content,
            originalUpdate: report.originalUpdate,
            periodStart: report.periodStart,
            periodEnd: report.periodEnd,
            projectStatusAtReport: report.projectStatusAtReport,
          }}
          onClose={() => setCopying(false)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title="Delete this report?"
          message="This report will be permanently removed from this browser. This cannot be undone."
          onCancel={() => setConfirm(false)}
          onConfirm={() => { actions.deleteReport(id); navigate('/reports') }}
        />
      )}
    </>
  )
}
