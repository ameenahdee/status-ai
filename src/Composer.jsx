import { useState } from 'react'
import { useStore, actions, STATUSES } from './store.js'
import { navigate, scrollToId } from './router.js'
import { fmtPeriod, fmtStamp } from './sections.js'
import { ReportBody, ExportButtons, StatusBadge } from './ui.jsx'

const SAMPLE_UPDATE =
  "Finished the login API and unit tests. Dashboard UI about 60% done, waiting on final icons from design. Payment integration blocked - vendor sandbox keys still not received after 2 weeks. QA found 3 flaky tests in checkout. Launch date of the 15th might slip if keys don't arrive. Next: finish dashboard, start reporting module, chase vendor."

const SAMPLE_REPORT = {
  title: 'Customer Portal – Weekly Status Report',
  executiveSummary:
    'The Customer Portal project is progressing but at risk of missing the 15th launch date. Core login functionality is complete and the dashboard is roughly 60% built. Payment integration is blocked because the vendor has not supplied sandbox keys after two weeks, and this is the main threat to the schedule.',
  completedActivities: [
    'Login API completed and unit tested',
    'QA cycle on checkout completed, with three flaky tests identified',
  ],
  workInProgress: [
    'Dashboard UI is approximately 60% complete, pending final icons from design',
    'Investigation of the three flaky checkout tests',
  ],
  blockers: [
    'Payment integration blocked: vendor sandbox keys not received after two weeks',
    'Dashboard completion waiting on final icons from the design team',
  ],
  risks: [
    'The 15th launch date may slip if the vendor sandbox keys are not received soon',
    'Flaky checkout tests may hide defects if left unresolved before launch',
  ],
  nextSteps: [
    'Finish the dashboard UI once icons are delivered',
    'Start the reporting module',
    'Chase the vendor for sandbox keys',
  ],
  executiveActionRequired: [
    'Escalate to the vendor’s senior contact to secure the sandbox keys this week',
    'Confirm whether the 15th launch date is fixed or can move if the keys are delayed',
  ],
}

// Pure client-side: no network, no backend, no Gemini
const makeSampleDraft = () => ({
  content: structuredClone(SAMPLE_REPORT),
  original: SAMPLE_UPDATE,
  generatedAt: new Date().toISOString(),
  isSample: true,
})

export default function Composer({ projectId: fixedProjectId, sample = false }) {
  const store = useStore()
  const [projectId, setProjectId] = useState(fixedProjectId || '')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [updates, setUpdates] = useState(sample ? SAMPLE_UPDATE : '')
  const [draft, setDraft] = useState(sample ? makeSampleDraft : null) // { content, original, generatedAt, isSample }
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')

  const project = store.projects.find((p) => p.id === projectId)

  function periodError() {
    if (!periodStart || !periodEnd) return 'Please enter both the reporting period start and end dates.'
    if (periodEnd < periodStart) return 'The reporting period end date cannot be earlier than the start date.'
    return ''
  }

  function pickProject(id) {
    setProjectId(id)
    setStatus(store.projects.find((p) => p.id === id)?.status || '')
  }

  async function generate() {
    const err = !project ? 'Please choose a project for this report.' : periodError()
    if (err) return setError(err)
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates,
          projectName: project.name,
          projectDescription: project.description,
          audience: project.audience,
          periodStart,
          periodEnd,
        }),
        signal: AbortSignal.timeout(70_000), // server gives up at 45s; this is the safety net
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const friendly = {
          503: 'Our AI service is temporarily busy. Please try again shortly, or explore the sample report.',
          429: 'The available AI usage limit has been reached. Please try again later, or explore the sample report.',
          504: 'The AI service took too long to respond. Please try again, or explore the sample report.',
        }
        // A deliberately disabled feature gets the server's own explanation, not the generic "busy" text
        throw new Error(
          data.code === 'DISABLED'
            ? data.error
            : friendly[res.status] || data.error || 'Something went wrong generating your report. Please try again.',
        )
      }
      setDraft({ content: data.report, original: data.original, generatedAt: new Date().toISOString(), isSample: false })
      setStatus(project.status || '')
      scrollToId('draft')
    } catch (e) {
      setError(
        e?.name === 'TimeoutError' || e?.name === 'AbortError'
          ? 'The request took too long. Please try again, or explore the sample report.'
          : e instanceof TypeError
            ? 'Could not reach the server. Check your connection and try again.'
            : e.message,
      )
    } finally {
      setLoading(false)
    }
  }

  // Sample mode never calls the backend or Gemini
  function showSample() {
    setError('')
    setUpdates(SAMPLE_UPDATE)
    setDraft(makeSampleDraft())
    scrollToId('draft')
  }

  function save() {
    const err = !project ? 'Choose a project above to save this report to.' : periodError()
    if (err) return setSaveError(err)
    setSaveError('')
    const report = actions.addReport({
      projectId: project.id,
      title: draft.content.title || 'Project Status Report',
      originalUpdate: draft.original,
      periodStart,
      periodEnd,
      content: draft.content,
      projectStatusAtReport: status,
    })
    if (status && status !== project.status) actions.setProjectStatus(project.id, status, { type: 'report', reportId: report.id })
    navigate(`/reports/${report.id}?saved=1`)
  }

  const meta = {
    projectName: project?.name,
    periodStart,
    periodEnd,
    generatedAt: draft?.generatedAt,
    isSample: draft?.isSample,
  }
  const statusChanges = status && project && status !== project.status

  return (
    <>
      <p className="crumbs">
        <a href="#/reports">Reports</a>
        {project && <> / <a href={`#/projects/${project.id}`}>{project.name}</a></>} / New report
      </p>
      <h1>New report</h1>

      {store.projects.length === 0 && (
        <div className="notice">
          Reports are saved to a project. <a href="#/projects">Create a project</a> first, or try the sample report below.
        </div>
      )}

      <section className="card">
        <div className="grid3">
          <label>Project
            <select value={projectId} onChange={(e) => pickProject(e.target.value)} disabled={!!fixedProjectId}>
              <option value="">Select a project…</option>
              {store.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Reporting period start
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label>Reporting period end
            <input type="date" value={periodEnd} min={periodStart || undefined} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
        </div>
        <label>Project update
          <textarea rows={9} value={updates} onChange={(e) => setUpdates(e.target.value)} maxLength={12000}
            placeholder="Paste your rough update exactly as it is: done, in progress, blocked, worries, what's next…" />
        </label>
        <p className="info privacy-note" role="note">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 7.2v4M8 4.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>
            <strong>Privacy:</strong> “Generate report” sends your update, project name, description, audience and reporting period to Google’s Gemini API. Please don’t include confidential, personal or client-sensitive information. Depending on Google’s terms for the service tier in use, submitted content may be retained and used to improve Google’s products. The sample report sends nothing.
          </span>
        </p>
        <div className="actions">
          <button className="primary" onClick={generate} disabled={loading || updates.trim().length < 10}>
            {loading && <span className="spinner" aria-hidden="true" />}
            {loading ? 'Generating…' : 'Generate report'}
          </button>
          <button className="ghost" onClick={showSample} disabled={loading}>Use sample</button>
        </div>
        {loading && (
          <p className="loading-note" role="status">
            Generating your report with the AI service. This can take several seconds; your update is not lost if it fails.
          </p>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {draft && (
        <section className="card" id="draft">
          <div className="toolbar">
            <h2>
              {draft.isSample ? 'Sample Report' : 'Generated report'}{' '}
              {draft.isSample ? <span className="badge">Preview only</span> : <span className="unsaved">Not saved yet</span>}
              <span className="faint"> · editable</span>
            </h2>
            <div className="actions">
              {!draft.isSample && <button className="primary" onClick={save}>Save Report</button>}
              <ExportButtons content={draft.content} meta={meta} />
            </div>
          </div>
          {draft.isSample && (
            <div className="preview-note">
              This is example content, not generated from your update. Sample reports are previews only: they aren’t saved and aren’t counted in your reports.
            </div>
          )}
          {saveError && <p className="error" role="alert">{saveError}</p>}
          <p className="meta-line">
            {project && <><strong>{project.name}</strong> · </>}
            Period: {fmtPeriod(periodStart, periodEnd)} · Generated: {fmtStamp(draft.generatedAt)}
          </p>
          <ReportBody
            content={draft.content}
            editing
            onChange={(k, v) => setDraft((d) => ({ ...d, content: { ...d.content, [k]: v } }))}
          />
          {!draft.isSample && (
            <div className="savebar">
              <p><strong>Save this report</strong></p>
              <p className="faint">
                {project
                  ? <>Saves to <strong>{project.name}</strong> with your original update and reporting period ({fmtPeriod(periodStart, periodEnd)}). It will appear in Reports and in the project’s history.</>
                  : 'Choose a project above to save this report.'}
              </p>
              <label>Project status for this report
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Not set</option>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              {statusChanges && (
                <p className="faint">
                  The project’s status will change from <StatusBadge status={project.status} /> to <StatusBadge status={status} /> (source: this report).
                </p>
              )}
              <button className="primary" onClick={save}>Save Report</button>
            </div>
          )}
        </section>
      )}
    </>
  )
}
