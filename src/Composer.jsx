import { useState } from 'react'
import { useStore, actions, STATUSES } from './store.js'
import { navigate, scrollToId } from './router.js'
import { fmtPeriod, fmtStamp } from './sections.js'
import { ReportBody, ExportButtons, StatusBadge } from './ui.jsx'
import SaveCopyDialog from './SaveCopy.jsx'
import { SAMPLE_SCENARIO, samplePeriod } from './samples.js'

// Pure client-side: no network, no backend, no Gemini. structuredClone keeps the original scenario unchanged.
const makeSampleDraft = () => ({
  content: structuredClone(SAMPLE_SCENARIO.report),
  original: SAMPLE_SCENARIO.update,
  generatedAt: new Date().toISOString(),
  isSample: true,
})

export default function Composer({ projectId: fixedProjectId, sample = false }) {
  const store = useStore()
  const [projectId, setProjectId] = useState(fixedProjectId || '')
  const [periodStart, setPeriodStart] = useState(sample ? samplePeriod().periodStart : '')
  const [periodEnd, setPeriodEnd] = useState(sample ? samplePeriod().periodEnd : '')
  const [updates, setUpdates] = useState(sample ? SAMPLE_SCENARIO.update : '')
  const [sampleLoaded, setSampleLoaded] = useState(sample) // the prepared fictional update has been loaded
  const [copying, setCopying] = useState(false) // Save a Copy dialog
  // ?sample=1 only pre-loads the fictional update; the report appears once the visitor submits it
  const [draft, setDraft] = useState(null) // { content, original, generatedAt, isSample }
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')

  const project = store.projects.find((p) => p.id === projectId)
  // Sample generation applies only while the box still holds the prepared fictional update; once the
  // visitor edits it, the pre-written report would no longer match, so we fall back to live generation.
  const sampleInput = sampleLoaded && updates === SAMPLE_SCENARIO.update

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
      // `generated` keeps the AI's output exactly as received; `content` is what the PM then edits.
      // generatedAt is the server's time of generation (not when the PM saves, and not the browser's clock).
      setDraft({ content: data.report, generated: structuredClone(data.report), original: data.original, generatedAt: data.generatedAt ?? null, generation: { model: data.model ?? null, promptVersion: data.promptVersion ?? null }, isSample: false })
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

  // "Try a Sample Generation", step 1: load the fictional update so the visitor can review it.
  // Nothing is generated yet, and nothing is sent anywhere.
  function trySampleGeneration() {
    setError('')
    setUpdates(SAMPLE_SCENARIO.update)
    setSampleLoaded(true)
    setDraft(null)
    if (!periodStart && !periodEnd) {
      const p = samplePeriod()
      setPeriodStart(p.periodStart)
      setPeriodEnd(p.periodEnd)
    }
  }

  // Step 2: show the pre-written report that corresponds to that update. No fetch, no Gemini.
  function generateSample() {
    setError('')
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
      generatedContent: draft.generated,
      generatedAt: draft.generatedAt,
      generation: draft.generation,
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
          Reports are saved to a project. <a href="#/projects">Create a project</a> first, or try a sample generation below.
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
        {sampleInput ? (
          <div className="preview-note demo-note" role="note">
            <strong>Demo experience · fictional input.</strong> This is a prepared sample update. “Generate sample report” shows a pre-written, illustrative report for it. Nothing is sent to Gemini or any server.
          </div>
        ) : (
          <p className="info privacy-note" role="note">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" />
              <path d="M8 7.2v4M8 4.6v.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span>
              <strong>Privacy:</strong> “Generate report” sends your update, project name, description, audience and reporting period to Google’s Gemini API. Please don’t include confidential, personal or client-sensitive information. Depending on Google’s terms for the service tier in use, submitted content may be retained and used to improve Google’s products. Sample generations and sample reports send nothing.
            </span>
          </p>
        )}
        <div className="actions">
          <button
            className="primary"
            onClick={sampleInput ? generateSample : generate}
            disabled={sampleInput ? false : loading || updates.trim().length < 10}
          >
            {loading && <span className="spinner" aria-hidden="true" />}
            {loading ? 'Generating…' : sampleInput ? 'Generate sample report' : 'Generate report'}
          </button>
          <button className="ghost" onClick={trySampleGeneration} disabled={loading}>
            Try a Sample Generation
          </button>
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
              {draft.isSample ? <span className="badge">Sample</span> : <span className="unsaved">Not saved yet</span>}
              <span className="faint"> · editable</span>
            </h2>
            <div className="actions">
              {!draft.isSample && <button className="primary" onClick={save}>Save Report</button>}
              {draft.isSample && <button className="primary" onClick={() => setCopying(true)}>Save a Copy</button>}
              <ExportButtons content={draft.content} meta={meta} />
            </div>
          </div>
          {draft.isSample && (
            <div className="preview-note demo-note">
              <strong>Sample report · Demo experience.</strong> Illustrative output — not generated live. It was written in advance for this fictional update, and nothing was sent to Gemini. You can edit it, or use “Save a Copy” to keep a labelled copy in your demo workspace.
            </div>
          )}
          {saveError && <p className="error" role="alert">{saveError}</p>}
          <p className="meta-line">
            {project && <><strong>{project.name}</strong> · </>}
            Period: {fmtPeriod(periodStart, periodEnd)}
            {draft.isSample ? ' · Illustrative output — not generated live' : draft.generatedAt ? <> · Generated: {fmtStamp(draft.generatedAt)}</> : null}
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
      {copying && draft?.isSample && (
        <SaveCopyDialog
          sourceKey={SAMPLE_SCENARIO.key}
          defaultProjectId={SAMPLE_SCENARIO.defaultDemoProjectId}
          payload={{
            content: draft.content,
            originalUpdate: draft.original,
            periodStart: periodStart || samplePeriod().periodStart,
            periodEnd: periodEnd || samplePeriod().periodEnd,
            projectStatusAtReport: null,
          }}
          onClose={() => setCopying(false)}
        />
      )}
    </>
  )
}
