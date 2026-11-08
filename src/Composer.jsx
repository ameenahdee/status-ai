import { useState } from 'react'
import { useStore, actions, STATUSES, DuplicatePeriodError } from './store.js'
import { navigate, scrollToId } from './router.js'
import { fmtPeriod, fmtStamp, stakeholderChanges } from './sections.js'
import { comparisonBaselineFor, findReportForPeriod, DUPLICATE_PERIOD_MESSAGE } from './history.js'
import WhatsChanged from './WhatsChanged.jsx'
import { ReportBody, ExportButtons, StatusBadge, ConfirmDialog } from './ui.jsx'
import { isFinalStatus, computeHealthMovement } from './schema.js'
import SaveCopyDialog from './SaveCopy.jsx'
import AssessmentPanel from './Assessment.jsx'
import { SAMPLE_SCENARIO, samplePeriod } from './samples.js'

// Combines the baseline the app chose with what the server verified. A comparison is only 'compared' when BOTH exist.
function buildWhatsChanged(baseline, server) {
  const empty = { baseline: null, notes: [], items: [] }
  if (baseline.status === 'none') return { status: 'none', ...empty }
  if (baseline.status === 'found' && server?.status === 'compared' && Array.isArray(server.items)) {
    const b = baseline.report
    return { status: 'compared', baseline: { reportId: b.id, periodStart: b.periodStart, periodEnd: b.periodEnd }, notes: baseline.notes, items: server.items }
  }
  return { status: 'unavailable', ...empty }
}

// Shown when the project already has a saved report for exactly this reporting period. Nothing is generated or
// saved until the PM opens (and edits) that report, deletes it, or picks a different project or period.
function DuplicateNotice({ report, onDelete }) {
  return (
    <div className="notice dup-notice" role="alert" data-testid="duplicate-period">
      <p>{DUPLICATE_PERIOD_MESSAGE}</p>
      <div className="actions">
        <a className="primary linkbtn" href={`#/reports/${report.id}`}>Open existing report</a>
        <button type="button" className="ghost danger" onClick={onDelete}>Delete existing report</button>
      </div>
    </div>
  )
}

const STATUS_REQUIRED = 'Choose the final project status before saving or sharing this report.'

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
  const [confirmDelete, setConfirmDelete] = useState(false)

  const project = store.projects.find((p) => p.id === projectId)
  // Sample generation applies only while the box still holds the prepared fictional update; once the
  // visitor edits it, the pre-written report would no longer match, so we fall back to live generation.
  const sampleInput = sampleLoaded && updates === SAMPLE_SCENARIO.update
  // A saved report for this exact project and period already exists: no live generation and no saving a second one.
  // (Sample generations send nothing and are saved as demo copies, which never count.)
  const existing = !sampleInput && project ? findReportForPeriod(store, { projectId: project.id, periodStart, periodEnd }) : null

  function periodError() {
    if (!periodStart || !periodEnd) return 'Please enter both the reporting period start and end dates.'
    if (periodEnd < periodStart) return 'The reporting period end date cannot be earlier than the start date.'
    return ''
  }

  function pickProject(id) {
    setProjectId(id)
    setStatus('') // the PM always chooses the status for a new report; the project's previous status is not reused
  }

  async function generate() {
    const err = !project ? 'Please choose a project for this report.' : periodError()
    if (err) return setError(err)
    if (existing) return setError(DUPLICATE_PERIOD_MESSAGE) // no AI call is made for a period that is already reported
    setError('')
    setLoading(true)
    try {
      // The previous valid report of this project, chosen by the shared history rules (period end, no demo or
      // sample copies, never this report). Its saved content is sent so the same AI call can say what changed.
      const baseline = comparisonBaselineFor(store, { projectId: project.id, periodStart, periodEnd })
      const res = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates,
          projectName: project.name,
          projectDescription: project.description,
          projectStatus: project.status || '',
          audience: project.audience,
          periodStart,
          periodEnd,
          previousReport: baseline.status === 'found' ? { periodStart: baseline.report.periodStart, periodEnd: baseline.report.periodEnd, content: baseline.report.content } : undefined,
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
      const whatsChanged = buildWhatsChanged(baseline, data.whatsChanged)
      setDraft({ whatsChanged, generatedWhatsChanged: structuredClone(whatsChanged), previousHealth: baseline.status === 'found' ? baseline.report.projectStatusAtReport ?? null : null, comparedFor: { projectId: project.id, periodStart, periodEnd }, content: data.report, generated: structuredClone(data.report), original: data.original, generatedAt: data.generatedAt ?? null, generation: { model: data.model ?? null, promptVersion: data.promptVersion ?? null }, assessment: data.assessment ?? null, isSample: false })
      setStatus('') // nothing is pre-selected: the PM must finalise the status before saving
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
    const stale = !draft.isSample && draft.comparedFor && (draft.comparedFor.projectId !== project?.id || draft.comparedFor.periodStart !== periodStart || draft.comparedFor.periodEnd !== periodEnd)
    const err = !project ? 'Choose a project above to save this report to.' : !isFinalStatus(status) ? STATUS_REQUIRED : stale ? 'The project or reporting period changed after this report was generated, so its comparison with the previous report no longer matches. Generate the report again.' : periodError()
    if (err) return setSaveError(err)
    if (existing) return setSaveError(DUPLICATE_PERIOD_MESSAGE)
    setSaveError('')
    let report
    try {
      report = actions.addReport({
        projectId: project.id,
        title: draft.content.title || 'Project Status Report',
        originalUpdate: draft.original,
        periodStart,
        periodEnd,
        content: draft.content,
        generatedContent: draft.generated,
        generatedAt: draft.generatedAt,
        generation: draft.generation,
        assessment: draft.assessment,
        whatsChanged: draft.whatsChanged,
        generatedWhatsChanged: draft.generatedWhatsChanged,
        projectStatusAtReport: status,
      })
    } catch (e) {
      // The store checks the live data at the moment of saving, so a duplicate that appeared while the report was
      // being generated is refused here too. Nothing was saved or overwritten.
      if (e instanceof DuplicatePeriodError) return setSaveError(e.message)
      throw e
    }
    // Only the PM's choice changes the project's status. Choosing the AI's recommended status is recorded as
    // 'ai-confirmed'; anything else the PM chose is recorded as set from this report.
    if (status && status !== project.status) {
      const confirmed = report.statusDecision?.action === 'confirmed'
      actions.setProjectStatus(project.id, status, { type: confirmed ? 'ai-confirmed' : 'report', reportId: report.id })
    }
    navigate(`/reports/${report.id}?saved=1`)
  }

  // The comparison as shown and exported while drafting: project health movement uses the previous report's
  // finalised status and the status the PM has chosen now (nothing until they choose). The store recomputes it on save.
  const shownChanges =
    draft && !draft.isSample && draft.whatsChanged?.status === 'compared'
      ? { ...draft.whatsChanged, healthMovement: computeHealthMovement(draft.previousHealth, status) }
      : draft?.whatsChanged
  const meta = {
    projectName: project?.name,
    periodStart,
    periodEnd,
    generatedAt: draft?.generatedAt,
    isSample: draft?.isSample,
    // exported only once the PM has finalised a status
    projectHealth: !draft?.isSample && isFinalStatus(status) ? status : null,
    whatsChanged: draft?.isSample ? null : stakeholderChanges(shownChanges),
  }
  const finalised = isFinalStatus(status)
  // The PM can remove a change they do not agree with; nothing can be added or reworded.
  const removeChange = (index) =>
    setDraft((d) => ({ ...d, whatsChanged: { ...d.whatsChanged, items: d.whatsChanged.items.filter((_, i) => i !== index) } }))
  const notFinal = !!draft && !draft.isSample && !finalised
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
            disabled={sampleInput ? false : loading || updates.trim().length < 10 || !!existing}
          >
            {loading && <span className="spinner" aria-hidden="true" />}
            {loading ? 'Generating…' : sampleInput ? 'Generate sample report' : 'Generate report'}
          </button>
          <button className="ghost" onClick={trySampleGeneration} disabled={loading}>
            Try a Sample Generation
          </button>
        </div>
        {existing && <DuplicateNotice report={existing} onDelete={() => setConfirmDelete(true)} />}
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
              {!draft.isSample && <button className="primary" onClick={save} disabled={!finalised || !!existing} title={finalised ? undefined : STATUS_REQUIRED}>Save Report</button>}
              {draft.isSample && <button className="primary" onClick={() => setCopying(true)}>Save a Copy</button>}
              <ExportButtons content={draft.content} meta={meta} disabledReason={notFinal ? STATUS_REQUIRED : ''} />
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
          {!draft.isSample && <WhatsChanged value={shownChanges} onRemove={removeChange} />}
          {!draft.isSample && <AssessmentPanel assessment={draft.assessment} currentStatus={project?.status} chosenStatus={status} onUse={setStatus} />}
          {!draft.isSample && (
            <div className="savebar">
              <p><strong>Save this report</strong></p>
              <p className="faint">
                {project
                  ? <>Saves to <strong>{project.name}</strong> with your original update and reporting period ({fmtPeriod(periodStart, periodEnd)}). It will appear in Reports and in the project’s history.</>
                  : 'Choose a project above to save this report.'}
              </p>
              <label>Final project status for this report (required)
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="" disabled>Select the final status…</option>
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              {statusChanges && (
                <p className="faint">
                  The project’s status will change from <StatusBadge status={project.status} /> to <StatusBadge status={status} /> (source: this report).
                </p>
              )}
              {!finalised && <p className="faint" role="status">{STATUS_REQUIRED}</p>}
              {existing && <DuplicateNotice report={existing} onDelete={() => setConfirmDelete(true)} />}
              <button className="primary" onClick={save} disabled={!finalised || !!existing}>Save Report</button>
            </div>
          )}
        </section>
      )}
      {confirmDelete && existing && (
        <ConfirmDialog
          title="Delete the existing report?"
          message={`“${existing.title}” will be permanently removed from this browser so you can create a new report for this period. This cannot be undone.`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { actions.deleteReport(existing.id); setConfirmDelete(false) }}
        />
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
