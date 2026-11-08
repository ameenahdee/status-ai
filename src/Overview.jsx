import { useEffect, useState } from 'react'
import { useStore } from './store.js'
import { navigate } from './router.js'
import { StatusBadge, DemoBadge } from './ui.jsx'
import { fmtStamp } from './sections.js'
import { NOT_SET, statusCounts, healthSegments, recentReports, activityEvents, relativeTime } from './dashboard.js'
import { IconLayers, IconCheck, IconWarn, IconX, IconLink, IconPlus, IconDoc, IconPulse, IconPencil, IconInfo, IconArrow } from './icons.jsx'

const SEVERITY = { Blocked: 0, 'Off Track': 1, 'At Risk': 2 }
const TONE = { 'On Track': 'ok', 'At Risk': 'warn', Blocked: 'bad', 'Off Track': 'off', [NOT_SET]: 'none' }
const HEALTH_INFO = 'Each project is counted by its current confirmed status, set by the project manager. Projects with no status are shown as Not set.'

// The final status the PM chose, as a soft pill (never an AI recommendation).
function StatusPill({ status }) {
  return <span className={`pill ${TONE[status] ?? 'none'}`}>{status ?? 'Not recorded'}</span>
}

function Donut({ total, segments }) {
  const R = 70
  const C = 2 * Math.PI * R
  const drawn = segments.filter((s) => s.count > 0)
  const gap = drawn.length > 1 ? 3 : 0
  // where each arc starts along the ring (built without reassigning anything)
  const arcs = drawn.reduce((list, s) => [...list, { s, start: list.length ? list.at(-1).start + list.at(-1).s.fraction * C : 0 }], [])
  const label = total
    ? `Project health: ${segments.filter((s) => s.count > 0).map((s) => `${s.count} ${s.key}`).join(', ')}, out of ${total} ${total === 1 ? 'project' : 'projects'}.`
    : 'Project health: there are no projects yet.'
  return (
    <div className="donut">
      <svg viewBox="0 0 190 190" role="img" aria-label={label}>
        <circle cx="95" cy="95" r={R} className="donut-track" />
        {arcs.map(({ s, start }) => {
          const len = Math.max(0, s.fraction * C - gap)
          return <circle key={s.key} cx="95" cy="95" r={R} className={`donut-seg ${TONE[s.key]}`} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-start} />
        })}
      </svg>
      <div className="donut-centre">
        <strong>{total}</strong>
        <span>{total === 1 ? 'Project' : 'Projects'}</span>
      </div>
    </div>
  )
}

const SUMMARY = [
  ['Total Projects', 'total', IconLayers],
  ['On Track', 'On Track', IconCheck],
  ['At Risk', 'At Risk', IconWarn],
  ['Blocked', 'Blocked', IconX],
]
const SUM_CLASS = { total: 'total', 'On Track': 'ok', 'At Risk': 'warn', Blocked: 'bad' }

const EVENT_ICON = { report: IconDoc, saved: IconDoc, sample: IconDoc, status: IconPulse, edit: IconPencil, details: IconPencil, project: IconLayers }

// Every figure here is computed from saved projects, reports and status history.
export default function Overview() {
  const store = useStore()
  const { projects, reports } = store
  const counts = statusCounts(projects)
  const { segments, total } = healthSegments(projects)
  const recent = recentReports(reports, projects, 5)
  const events = activityEvents(store, 6)
  const sampleCount = reports.filter((r) => r.demo).length // demo and sample-copy reports are never counted as live AI
  const attention = projects.filter((p) => p.status in SEVERITY).sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status])
  // relative times ("2 hours ago") stay current while the page is open
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="dash">
      <header className="dash-head">
        <div>
          <h1>Overview</h1>
          <p className="dash-sub">A real-time view of your projects, status and recent activity.</p>
        </div>
        <div className="dash-actions">
          {/* Not available yet: greyed out, no action */}
          <button type="button" className="btn-soon" disabled aria-disabled="true" title="Integrations are coming soon">
            <IconLink size={20} />
            <span>Integrations</span>
            <span className="soon-tag">Coming Soon</span>
          </button>
          <button type="button" className="primary btn-new" onClick={() => navigate('/projects?new=1')}>
            <IconPlus size={20} />
            <span>New Project</span>
          </button>
        </div>
      </header>

      <section className="dash-cards" aria-label="Project summary">
        {SUMMARY.map(([label, key, Icon]) => (
          <div key={key} className={`sum ${SUM_CLASS[key]}`}>
            <span className="sum-icon"><span className="ic-in"><Icon /></span></span>
            <div className="sum-body">
              <span className="sum-num">{key === 'total' ? counts.total : counts[key]}</span>
              <span className="sum-label">{label}</span>
            </div>
          </div>
        ))}
      </section>

      <div className="dash-grid">
        <section className="dcard health" aria-labelledby="health-h">
          <h2 id="health-h">
            Project Health
            <span className="info-tip" role="img" aria-label={HEALTH_INFO} title={HEALTH_INFO}><IconInfo size={18} /></span>
          </h2>
          <div className="health-body" style={{ '--rows': segments.length }}>
            <Donut total={total} segments={segments} />
            <ul className="legend">
              {segments.map((s) => (
                <li key={s.key}>
                  <span className={`dot ${TONE[s.key]}`} aria-hidden="true" />
                  <span className="legend-name">{s.key}</span>
                  <span className="legend-val">{s.percent}% ({s.count})</span>
                </li>
              ))}
            </ul>
          </div>
          {total === 0 && <p className="dash-empty">No projects yet. Create a project to see its health here.</p>}
        </section>

        <section className="dcard recent" aria-labelledby="recent-h">
          <div className="dcard-head">
            <h2 id="recent-h">Recent Reports</h2>
            <a className="view-all" href="#/reports">View all <IconArrow size={16} /></a>
          </div>
          {recent.length === 0 ? (
            <div className="dash-empty">
              <p>No reports yet. Reports you generate and save will appear here.</p>
              <div className="actions">
                {projects.length === 0 ? (
                  <button type="button" className="primary" onClick={() => navigate('/projects?new=1')}>Create your first project</button>
                ) : (
                  <button type="button" className="primary" onClick={() => navigate('/reports/new')}>Create New Report</button>
                )}
                <button type="button" className="ghost" onClick={() => navigate('/reports/new?sample=1')}>Try a Sample Generation</button>
              </div>
            </div>
          ) : (
            <>
              <ul className="rr-list">
                {recent.map(({ report: r, projectName, status }) => (
                  <li key={r.id}>
                    <a className="rr" href={`#/reports/${r.id}`}>
                      <span className="rr-icon"><IconDoc size={20} /></span>
                      <span className="rr-main">
                        <span className="rr-title">
                          <strong title={r.title}>{r.title}</strong>
                          {r.demo && <DemoBadge label={r.sampleCopy ? 'Sample copy' : 'Demo'} />}
                        </span>
                        <span className="rr-project">{projectName}</span>
                      </span>
                      <span className="rr-date" title={fmtStamp(r.savedAt)}>{relativeTime(r.savedAt, now)}</span>
                      <StatusPill status={status} />
                    </a>
                  </li>
                ))}
              </ul>
              <p className="rr-foot">
                {reports.length} {reports.length === 1 ? 'report' : 'reports'} saved
                {sampleCount > 0 && <> · {reports.length - sampleCount} live AI · {sampleCount} demo or sample</>}
                {' · '}<a href="#/reports/new">Create new report</a>
              </p>
            </>
          )}
        </section>
      </div>

      <section className="dcard activity" aria-labelledby="activity-h">
        <h2 id="activity-h">Recent Activity</h2>
        {events.length === 0 ? (
          <p className="dash-empty">No activity yet. Creating a project, saving a report or changing a status will show up here.</p>
        ) : (
          <ul className="act">
            {events.map((e) => {
              const Icon = EVENT_ICON[e.kind] ?? IconDoc
              const body = (
                <>
                  <strong>{e.title}{e.demo && <> <DemoBadge /></>}</strong>
                  <span className="act-detail">{e.detail} <span aria-hidden="true">•</span> <time dateTime={e.at}>{relativeTime(e.at, now)}</time></span>
                </>
              )
              return (
                <li key={e.id} className={`act-${e.kind}`}>
                  <span className="act-dot" aria-hidden="true" />
                  <span className="act-icon"><Icon size={22} /></span>
                  {e.href ? <a className="act-text" href={e.href}>{body}</a> : <span className="act-text">{body}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {attention.length > 0 && (
        <section className="dcard attention" aria-labelledby="attention-h">
          <h2 id="attention-h">Projects requiring attention</h2>
          <ul className="rows">
            {attention.map((p) => (
              <li key={p.id}>
                <a href={`#/projects/${p.id}`}><strong>{p.name}</strong></a>
                <StatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(projects.some((p) => p.demo) || reports.some((r) => r.demo)) && (
        <p className="info" role="note">
          Figures include {projects.filter((p) => p.demo).length} illustrative demo projects and {reports.filter((r) => r.demo).length} demo reports. Reset them from the Projects page.
        </p>
      )}
      <p className="info" role="note">
        <IconInfo size={14} />
        <span>Your projects and reports are saved in this browser only. They don’t sync across devices or users, and clearing browser data may remove them.</span>
      </p>
    </div>
  )
}
