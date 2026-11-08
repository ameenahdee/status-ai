import { useId, useState } from 'react'
import { StatusBadge } from './ui.jsx'
import { INSUFFICIENT, decisionAction } from './schema.js'

const SOURCE_LABEL = { update: 'Your update', description: 'Project description', confirmedStatus: 'Current confirmed status' }

function Recommendation({ outcome }) {
  return outcome === INSUFFICIENT
    ? <span className="status none">Insufficient information · not a status</span>
    : <StatusBadge status={outcome} />
}

// The PM's finalised status (never the AI's recommendation).
const Final = ({ status }) => <StatusBadge status={status} empty="Not finalised" />

/**
 * The AI's project health assessment, as a collapsible section. It only ever RECOMMENDS: nothing here changes a
 * project's status. The header always shows both the AI recommendation and the PM's final assessment, since they
 * may differ; the details (explanation, evidence, missing information) open and close below it.
 *   draft   (onUse given): beside a freshly generated report, open by default because the PM is deciding.
 *           `chosenStatus` is the status the PM has picked so far; "Accept recommendation" only fills that in.
 *   saved   (`finalStatus` given): read-only, collapsed by default. `finalStatus` is the report's stored,
 *           PM-finalised status, which is what "Final assessment" shows.
 */
export default function AssessmentPanel({ assessment, finalStatus, currentStatus, chosenStatus, onUse, defaultOpen }) {
  const draft = typeof onUse === 'function'
  const [open, setOpen] = useState(defaultOpen ?? draft)
  const bodyId = useId()
  if (!assessment) {
    return draft ? (
      <section className="assessment" aria-label="Project health assessment">
        <h3>AI health assessment</h3>
        <p className="faint">No health assessment was returned for this report. Choose the project status yourself below.</p>
      </section>
    ) : null
  }
  const isStatus = assessment.outcome !== INSUFFICIENT
  const dropped = assessment.checks?.evidenceDropped ?? 0
  const pending = draft && chosenStatus ? decisionAction(assessment, chosenStatus) : null
  const final = draft ? chosenStatus : finalStatus

  return (
    <section className={`assessment ${open ? 'open' : ''}`} aria-label="Project health assessment">
      <h3 className="assessment-title">
        <button type="button" className="assessment-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
          <span className="assessment-chevron" aria-hidden="true">▸</span>
          <span className="assessment-name">AI health assessment</span>
          <span className="badge">Recommendation only</span>
          <span className="assessment-summary">
            <span className="assessment-pair"><span className="faint">AI recommendation</span> <Recommendation outcome={assessment.outcome} /></span>
            <span className="assessment-pair"><span className="faint">Final assessment</span> <Final status={final} /></span>
          </span>
        </button>
      </h3>

      <div id={bodyId} className="assessment-body" hidden={!open}>
        <h4>AI recommendation</h4>
        <p className="assessment-outcome"><Recommendation outcome={assessment.outcome} /></p>
        <p>{assessment.explanation}</p>

        {assessment.evidence.length > 0 && (
          <>
            <h4>Supporting evidence</h4>
            <ul className="evidence">
              {assessment.evidence.map((e, i) => (
                <li key={i}>
                  <q>{e.quote}</q> <span className="faint">— {SOURCE_LABEL[e.source] ?? e.source}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {dropped > 0 && (
          <p className="faint">
            {dropped === 1 ? '1 piece of evidence' : `${dropped} pieces of evidence`} cited by the AI could not be found in the text it was given, so {dropped === 1 ? 'it was' : 'they were'} removed.
          </p>
        )}

        {assessment.missingInformation.length > 0 && (
          <>
            <h4>Missing information or concerns</h4>
            <ul>{assessment.missingInformation.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </>
        )}

        {draft ? (
          <div className="assessment-decision">
            <p className="faint">
              Current confirmed project status: {currentStatus ? <StatusBadge status={currentStatus} /> : 'not set'}. This recommendation is internal guidance and does not change it. Only the status you finalise below and save does.
            </p>
            {isStatus && chosenStatus !== assessment.outcome && (
              <button type="button" className="ghost" onClick={() => onUse(assessment.outcome)}>Accept recommendation ({assessment.outcome})</button>
            )}
            <p className="faint" aria-live="polite">
              {!chosenStatus && 'You have not finalised a status yet. Accept the recommendation or choose a different status below; the report cannot be saved or shared until you do.'}
              {pending === 'confirmed' && 'You have selected the recommended status. It will be saved as confirmed by you.'}
              {pending === 'overridden' && `You have selected ${chosenStatus || 'no status'}, which differs from the recommendation. Your choice will be saved as an override.`}
              {pending === 'no-recommendation' && 'There is no recommended status. Choose one yourself, or leave it unchanged.'}
            </p>
          </div>
        ) : (
          <div className="assessment-decision">
            <h4>Final assessment</h4>
            <p className="assessment-outcome"><Final status={finalStatus} /></p>
          </div>
        )}
      </div>
    </section>
  )
}
