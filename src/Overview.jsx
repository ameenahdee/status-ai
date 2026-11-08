import { useStore, STATUSES } from './store.js'
import { navigate } from './router.js'
import { fmtPeriod, fmtStamp, reportStamp } from './sections.js'
import { StatusBadge, EmptyState } from './ui.jsx'

const SEVERITY = { Blocked: 0, 'Off Track': 1, 'At Risk': 2 }

// Every figure here is computed from saved projects and reports.
export default function Overview() {
  const store = useStore()
  const { projects, reports } = store
  const count = (s) => projects.filter((p) => p.status === s).length
  const unset = projects.filter((p) => !p.status).length
  const byId = Object.fromEntries(projects.map((p) => [p.id, p]))
  const sampleCount = reports.filter((r) => r.demo).length // demo and sample-copy reports are never counted as live AI
  const recent = [...reports].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, 5)
  const attention = projects
    .filter((p) => p.status in SEVERITY)
    .sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status])

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Overview</h1>
          <p className="muted">A snapshot of your project reporting.</p>
        </div>
        <button className="primary" onClick={() => navigate('/reports/new')}>Create New Report</button>
      </div>

      <div className="stats">
        <div className="card stat"><span className="num">{projects.length}</span><span>Total projects</span></div>
        <div className="card stat">
          <span className="num">{reports.length}</span>
          <span>Reports saved</span>
          {sampleCount > 0 && <span className="faint">{reports.length - sampleCount} live AI · {sampleCount} demo or sample</span>}
        </div>
      </div>

      <div className="stats four">
        {STATUSES.map((s) => (
          <div key={s} className="card stat small">
            <span className="num">{count(s)}</span>
            <StatusBadge status={s} />
          </div>
        ))}
      </div>
      {unset > 0 && <p className="faint">{unset} project{unset === 1 ? '' : 's'} with no status set.</p>}

      {projects.length === 0 ? (
        <EmptyState title="Welcome to Status AI">
          <p className="muted">Create a project, add a rough update, and get an executive-ready report.</p>
          <div className="actions center">
            <button className="primary" onClick={() => navigate('/projects')}>Create your first project</button>
            <button className="ghost" onClick={() => navigate('/reports/new?sample=1')}>Try a Sample Generation</button>
          </div>
        </EmptyState>
      ) : (
        <div className="two">
          <section className="card">
            <h2>Recent reports</h2>
            {recent.length === 0 ? <p className="muted">No reports yet.</p> : (
              <ul className="rows">
                {recent.map((r) => (
                  <li key={r.id}>
                    <a href={`#/reports/${r.id}`}><strong>{r.title}</strong></a>
                    <span className="faint">{byId[r.projectId]?.name} · {fmtPeriod(r.periodStart, r.periodEnd)} · {reportStamp(r).label.toLowerCase()} {fmtStamp(reportStamp(r).iso)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2>Projects requiring attention</h2>
            {attention.length === 0 ? <p className="muted">No projects are currently marked At Risk, Blocked or Off Track.</p> : (
              <ul className="rows">
                {attention.map((p) => (
                  <li key={p.id}>
                    <a href={`#/projects/${p.id}`}><strong>{p.name}</strong></a>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {(projects.some((p) => p.demo) || reports.some((r) => r.demo)) && (
        <p className="info" role="note">
          Figures include {projects.filter((p) => p.demo).length} illustrative demo projects and {reports.filter((r) => r.demo).length} demo reports. Reset them from the Projects page.
        </p>
      )}
      <p className="info" role="note">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 7.2v4M8 4.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>Your projects and reports are saved in this browser only. They don’t sync across devices or users, and clearing browser data may remove them.</span>
      </p>
    </>
  )
}
