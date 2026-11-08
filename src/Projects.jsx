import { useState } from 'react'
import { useStore, actions, reportsFor, hasDemo, STATUSES, DESCRIPTION_MAX } from './store.js'
import { navigate } from './router.js'
import { fmtDate, fmtPeriod, fmtStamp, todayStr, reportStamp } from './sections.js'
import { latestByPeriod } from './history.js'
import { Modal, ConfirmDialog, StatusBadge, ReportCard, EmptyState, DemoBadge } from './ui.jsx'

const PAGE_SIZE = 6
const DESC_MAX = DESCRIPTION_MAX // the same limit the store enforces on create and update

function ProjectForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    startDate: initial?.startDate || todayStr(),
    description: initial?.description || '',
    owner: initial?.owner || '',
    audience: initial?.audience || '',
  })
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  return (
    <Modal title={initial ? 'Edit project' : 'Create project'} onClose={onClose}>
      {(close) => (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!f.name.trim()) return setError('Project name is required.')
            if (!f.startDate) return setError('Project start date is required.')
            if (!f.description.trim()) return setError('Project description is required. Briefly describe what the project is about and what it should achieve.')
            if (f.description.trim().length > DESC_MAX) return setError(`Project description must be ${DESC_MAX} characters or fewer.`)
            if (initial) {
              actions.updateProject(initial.id, f)
              onSaved?.(initial)
            } else {
              onSaved?.(actions.createProject(f))
            }
            close()
          }}
        >
          <label>Project name *
            <input value={f.name} onChange={set('name')} maxLength={120} autoFocus />
          </label>
          <label>Project start date *
            <input type="date" value={f.startDate} onChange={set('startDate')} />
          </label>
          <label>Project description *
            <textarea
              rows={4}
              value={f.description}
              onChange={set('description')}
              maxLength={DESC_MAX}
              required
              aria-describedby="desc-help"
              placeholder="e.g. Replace the legacy invoicing tool so finance can close month-end faster, with fewer manual corrections."
            />
          </label>
          <p id="desc-help" className="field-help">
            Describe what the project is about, the problem it solves, its objectives and the expected outcome. This gives the AI context when it writes your reports.
            <span className="counter" aria-live="polite"> {f.description.length}/{DESC_MAX}</span>
          </p>
          <div className="grid2">
            <label>Project owner <span className="faint">(optional)</span>
              <input value={f.owner} onChange={set('owner')} maxLength={120} />
            </label>
            <label>Reporting audience <span className="faint">(optional)</span>
              <input value={f.audience} onChange={set('audience')} maxLength={120} placeholder="e.g. Steering committee" />
            </label>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions end modal-actions">
            <button type="button" className="ghost" onClick={close}>Cancel</button>
            <button type="submit" className="primary">{initial ? 'Save changes' : 'Create project'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}

function Pager({ page, pages, onPage }) {
  return (
    <nav className="pager" aria-label="Project pages">
      <button className="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</button>
      <span className="pager-label" aria-live="polite">Page {page} of {pages}</span>
      <button className="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</button>
    </nav>
  )
}

// `openNew`: arrived from the Overview's "New Project" button, so the existing create-project form opens straight away.
export function ProjectsPage({ openNew = false }) {
  const store = useStore()
  const [creating, setCreating] = useState(openNew)
  const [confirmReset, setConfirmReset] = useState(false)
  const [msg, setMsg] = useState('')
  const [pageRaw, setPage] = useState(1)

  const total = store.projects.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(pageRaw, pages)
  const visible = store.projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const demoOn = hasDemo(store)

  const demoProjects = store.projects.filter((p) => p.demo)
  const demoReports = store.reports.filter((r) => r.demo)
  const sampleCopies = demoReports.filter((r) => r.sampleCopy).length
  const keptOnReset = demoProjects.filter((p) => store.reports.some((r) => !r.demo && r.projectId === p.id)).length

  function loadDemo() {
    const { addedProjects, addedReports } = actions.loadDemo()
    setPage(1)
    setMsg(
      addedProjects || addedReports
        ? `Demo workspace loaded: ${addedProjects} projects and ${addedReports} reports. This content is fictional and illustrative.`
        : 'The demo workspace is already loaded, so nothing was added.',
    )
  }

  function changePage(n) {
    setPage(n)
    document.getElementById('projects-top')?.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  return (
    <>
      <div className="pagehead" id="projects-top">
        <div>
          <h1>Projects</h1>
          <p className="muted">Organise your reporting by project.</p>
        </div>
        <div className="actions head-actions">
          <button className="ghost" onClick={loadDemo}>Load Demo Workspace</button>
          {demoOn && <button className="ghost" onClick={() => setConfirmReset(true)}>Reset Demo Workspace</button>}
          <button className="primary" onClick={() => setCreating(true)}>Create Project</button>
        </div>
      </div>
      {msg && <p className="flash" role="status">{msg}</p>}

      {total === 0 ? (
        <EmptyState title="No projects yet">
          <p className="muted">Create your first project to start saving reports against it, or load the demo workspace to explore.</p>
          <div className="actions center">
            <button className="primary" onClick={() => setCreating(true)}>Create Project</button>
            <button className="ghost" onClick={loadDemo}>Load Demo Workspace</button>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="grid-projects fade-in" key={page}>
            {visible.map((p) => {
              const reps = reportsFor(store, p.id)
              const last = latestByPeriod(reps) // by reporting period, so a back-filled report is never "latest"
              return (
                <a key={p.id} className="card pcard" href={`#/projects/${p.id}`}>
                  <div className="pcard-top">
                    <h3>{p.name}{p.demo && <> <DemoBadge /></>}</h3>
                    <StatusBadge status={p.status} />
                  </div>
                  <dl className="facts">
                    <div><dt>Started</dt><dd>{fmtDate(p.startDate)}</dd></div>
                    <div><dt>Last reporting period</dt><dd>{last ? fmtPeriod(last.periodStart, last.periodEnd) : 'No reports yet'}</dd></div>
                    <div><dt>Latest report</dt><dd>{last ? fmtStamp(reportStamp(last).iso) : '—'}</dd></div>
                    <div><dt>Reports</dt><dd>{reps.length}</dd></div>
                  </dl>
                </a>
              )
            })}
          </div>
          {pages > 1 && <Pager page={page} pages={pages} onPage={changePage} />}
        </>
      )}

      {creating && (
        <ProjectForm
          onClose={() => {
            setCreating(false)
            if (openNew) navigate('/projects') // drop ?new=1 so a refresh does not reopen the form
          }}
          onSaved={(p) => navigate(`/projects/${p.id}`)}
        />
      )}
      {confirmReset && (
        <ConfirmDialog
          title="Reset demo workspace?"
          confirmLabel="Reset demo"
          message={`This removes the ${demoProjects.length - keptOnReset} demo projects and ${demoReports.length} demo reports${sampleCopies ? `, including ${sampleCopies} sample ${sampleCopies === 1 ? 'copy' : 'copies'} you saved` : ''}. The sample entries in Recent Activity are removed too. Projects and reports you created, and your own activity, are not affected.${keptOnReset ? ` ${keptOnReset} demo project${keptOnReset === 1 ? '' : 's'} containing reports you saved will be kept as normal project${keptOnReset === 1 ? '' : 's'}.` : ''}`}
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            const r = actions.resetDemo()
            setConfirmReset(false)
            setMsg(`Demo workspace reset: removed ${r.removedProjects} projects and ${r.removedReports} reports.${r.keptProjects ? ` Kept ${r.keptProjects} with your own reports.` : ''} Your own data was not touched.`)
          }}
        />
      )}
    </>
  )
}

export function ProjectWorkspace({ id }) {
  const store = useStore()
  const [editing, setEditing] = useState(false)
  const p = store.projects.find((x) => x.id === id)
  if (!p) return <EmptyState title="Project not found"><a href="#/projects">Back to projects</a></EmptyState>

  const reps = reportsFor(store, id)
  const latest = latestByPeriod(reps)
  const src = p.statusSource
  const srcReport = src?.type === 'report' ? store.reports.find((r) => r.id === src.reportId) : null

  return (
    <>
      <p className="crumbs"><a href="#/projects">Projects</a> / {p.name}</p>
      <section className="card">
        <div className="pagehead tight">
          <div className="grow">
            <h1>{p.name}{p.demo && <> <DemoBadge /></>}</h1>
            {p.description && <p className="muted">{p.description}</p>}
          </div>
          <div className="actions head-actions">
            <button className="ghost" onClick={() => setEditing(true)}>Edit project</button>
            <button className="primary" onClick={() => navigate(`/projects/${id}/new-report`)}>New report</button>
          </div>
        </div>
        {p.demo && <p className="preview-note">Illustrative demo project with fictional content. Use “Reset Demo Workspace” on the Projects page to remove it.</p>}
        <dl className="facts wide">
          <div><dt>Start date</dt><dd>{fmtDate(p.startDate)}</dd></div>
          {p.owner && <div><dt>Owner</dt><dd>{p.owner}</dd></div>}
          {p.audience && <div><dt>Audience</dt><dd>{p.audience}</dd></div>}
          <div>
            <dt>Latest report</dt>
            <dd>{latest ? <><a href={`#/reports/${latest.id}`}>{fmtPeriod(latest.periodStart, latest.periodEnd)}</a> · {reportStamp(latest).label.toLowerCase()} {fmtStamp(reportStamp(latest).iso)}</> : 'No reports yet'}</dd>
          </div>
        </dl>
        <div className="statusrow">
          <label>Project status
            <select value={p.status || ''} onChange={(e) => actions.setProjectStatus(id, e.target.value, { type: 'manual' })}>
              <option value="">Not set</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <StatusBadge status={p.status} />
          <span className="faint">
            {!src && 'Set this to track the project’s overall status.'}
            {src?.type === 'manual' && `Set manually on ${fmtStamp(src.at)}`}
            {src?.type === 'report' && (
              <>From report {srcReport ? <a href={`#/reports/${srcReport.id}`}>“{srcReport.title}”</a> : '(since deleted)'} · {fmtStamp(src.at)}</>
            )}
          </span>
        </div>
      </section>

      <div className="pagehead tight">
        <h2>Reporting history <span className="faint">({reps.length})</span></h2>
      </div>
      {reps.length === 0 ? (
        <EmptyState title="No reports for this project yet">
          <button className="primary" onClick={() => navigate(`/projects/${id}/new-report`)}>Create the first report</button>
        </EmptyState>
      ) : (
        <div className="grid-cards">{reps.map((r) => <ReportCard key={r.id} report={r} project={p} />)}</div>
      )}
      {editing && <ProjectForm initial={p} onClose={() => setEditing(false)} />}
    </>
  )
}
