import { StatusBadge } from './ui.jsx'
import { INSUFFICIENT, decisionAction } from './schema.js'
import { fmtStamp } from './sections.js'

const SOURCE_LABEL = { update: 'Your update', description: 'Project description', confirmedStatus: 'Current confirmed status' }

function Recommendation({ outcome }) {
  return outcome === INSUFFICIENT
    ? <span className="status none">Insufficient information · not a status</span>
    : <StatusBadge status={outcome} />
}

function DecisionText({ action, status }) {
  const chosen = status ? <StatusBadge status={status} /> : <span className="faint">no status</span>
  if (action === 'confirmed') return <>The project manager confirmed the recommendation: {chosen}.</>
  if (action === 'overridden') return <>The project manager chose {chosen} instead of the recommendation.</>
  return <>The AI made no recommendation; the project manager chose {chosen}.</>
}

/**
 * The AI's project health assessment. It only ever RECOMMENDS: nothing here changes a project's status.
 *   draft   (assessment + chosenStatus + onUse): shown beside a freshly generated report; the PM decides with the
 *           status selector below (or the "Accept recommendation" shortcut, which only fills that selector in).
 *   saved   (assessment + decision): read-only record of the recommendation and what the PM decided.
 */
export default function AssessmentPanel({ assessment, decision, currentStatus, chosenStatus, onUse }) {
  const draft = typeof onUse === 'function'
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

  return (
    <section className="assessment" aria-label="Project health assessment">
      <div className="assessment-head">
        <h3>AI health assessment</h3>
        <span className="badge">Recommendation only</span>
      </div>
      <p className="assessment-outcome">
        <span className="faint">Recommended: </span>
        <Recommendation outcome={assessment.outcome} />
      </p>
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
            {draft && !chosenStatus && 'You have not finalised a status yet. Accept the recommendation or choose a different status below; the report cannot be saved or shared until you do.'}
            {pending === 'confirmed' && 'You have selected the recommended status. It will be saved as confirmed by you.'}
            {pending === 'overridden' && `You have selected ${chosenStatus || 'no status'}, which differs from the recommendation. Your choice will be saved as an override.`}
            {pending === 'no-recommendation' && 'There is no recommended status. Choose one yourself, or leave it unchanged.'}
          </p>
        </div>
      ) : decision ? (
        <p className="assessment-decision"><DecisionText action={decision.action} status={decision.status} /> <span className="faint">({fmtStamp(decision.decidedAt)})</span></p>
      ) : null}
    </section>
  )
}
