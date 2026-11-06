import { useState } from 'react'
import { useStore, actions } from './store.js'
import { navigate } from './router.js'
import { fmtPeriod, fmtStamp } from './sections.js'
import { ReportCard, ReportBody, ExportButtons, StatusBadge, ConfirmDialog, EmptyState, DemoBadge, Toast } from './ui.jsx'
import { metaOf } from './exporters.js'

const RECENT_DAYS = 14

export function ReportsPage() {
  const store = useStore()
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [now] = useState(() => Date.now())
  const byId = Object.fromEntries(store.projects.map((p) => [p.id, p]))

  const needle = q.trim().toLowerCase()
  const sorted = [...store.reports].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
  const matches = sorted.filter((r) => {
    if (!needle) return true
    const hay = [r.title, byId[r.projectId]?.name, r.content.executiveSummary, r.projectStatusAtReport].join(' ').toLowerCase()
    return hay.includes(needle)
  })
  const cutoff = now - RECENT_DAYS * 86400000
  const shown = tab === 'recent' ? matches.filter((r) => new Date(r.generatedAt).getTime() >= cutoff) : matches

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

export function ReportView({ id, startEditing, saved }) {
  const store = useStore()
  const report = store.reports.find((r) => r.id === id)
  const [draft, setDraft] = useState(() => (startEditing ? structuredClone(report?.content ?? null) : null))
  const editing = draft !== null
  const [confirm, setConfirm] = useState(false)
  const [toast, setToast] = useState(saved ? 'Report saved to your project' : '')
  if (!report) return <EmptyState title="Report not found"><a href="#/reports">Back to reports</a></EmptyState>

  const project = store.projects.find((p) => p.id === report.projectId)
  const content = editing ? draft : report.content
  const begin = () => setDraft(structuredClone(report.content))

  return (
    <>
      <p className="crumbs">
        <a href="#/reports">Reports</a> / {project && <a href={`#/projects/${project.id}`}>{project.name}</a>}
      </p>
      <section className="card">
        <div className="toolbar">
          <div>
            <h1>{report.content.title || report.title}{report.demo && <> <DemoBadge /></>}</h1>
            <p className="meta-line">
              <a href={`#/projects/${report.projectId}`}>{project?.name || 'Unknown project'}</a>
              {' · '}Period: {fmtPeriod(report.periodStart, report.periodEnd)}
              {' · '}Generated: {fmtStamp(report.generatedAt)}
              {report.updatedAt && <> · Edited: {fmtStamp(report.updatedAt)}</>}
            </p>
            <p className="meta-line">Project status at time of reporting: <StatusBadge status={report.projectStatusAtReport} empty="Not recorded" /></p>
          </div>
          <div className="actions">
            {editing ? (
              <>
                <button className="ghost" onClick={() => setDraft(null)}>Cancel</button>
                <button className="primary" onClick={() => { actions.updateReportContent(id, draft); setDraft(null); setToast('Changes saved') }}>Save changes</button>
              </>
            ) : (
              <>
                <button className="ghost" onClick={begin}>Edit</button>
                <ExportButtons content={report.content} meta={metaOf(report, project)} />
                <button className="ghost danger" onClick={() => setConfirm(true)}>Delete</button>
              </>
            )}
          </div>
        </div>
        {report.demo && <p className="preview-note">Illustrative demo report with fictional content, authored locally. It was not generated by the AI.</p>}
        <ReportBody content={content} editing={editing} onChange={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
        <details className="orig">
          <summary>Original submitted update (read-only)</summary>
          <pre>{report.originalUpdate}</pre>
        </details>
      </section>
      <Toast message={toast} onDone={() => setToast('')} />
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
