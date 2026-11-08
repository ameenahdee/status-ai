// Project health assessment: checks what the AI returned before anything reaches the PM.
//
// The AI only RECOMMENDS. This module makes sure the recommendation is something that can be shown honestly:
//   * the outcome is one of the four statuses or "Insufficient Information" (which is NOT a status)
//   * every piece of evidence is a verbatim quote that really appears in the allowed sources
//   * a status is only recommended when at least one quote from the submitted UPDATE backs it up
// Anything else is dropped or downgraded to "Insufficient Information". It never falls back to "On Track".

export const STATUSES = ['On Track', 'At Risk', 'Blocked', 'Off Track']
export const INSUFFICIENT = 'Insufficient Information'
export const OUTCOMES = [...STATUSES, INSUFFICIENT]
export const EVIDENCE_SOURCES = ['update', 'description', 'confirmedStatus']

const MIN_QUOTE = 8 // shorter quotes prove nothing
const MAX_EVIDENCE = 8
const MAX_MISSING = 8
const MAX_TEXT = 1000

const isStr = (v) => typeof v === 'string'

// Quote matching ignores case, repeated whitespace and typographic quotes/dashes, and nothing else.
export const normalize = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

const clean = (s, max = MAX_TEXT) => (isStr(s) ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

// Is this evidence item a real quote from the source it names?
function evidenceIsReal(item, { updates, projectDescription, projectStatus }) {
  if (!item || typeof item !== 'object' || !EVIDENCE_SOURCES.includes(item.source) || !isStr(item.quote)) return false
  const quote = normalize(item.quote)
  if (item.source === 'confirmedStatus') return !!projectStatus && quote === normalize(projectStatus)
  if (quote.length < MIN_QUOTE) return false
  const source = item.source === 'update' ? updates : projectDescription
  return normalize(source).includes(quote)
}

const insufficient = (explanation, extra = {}) => ({
  outcome: INSUFFICIENT,
  explanation,
  evidence: [],
  missingInformation: [],
  checks: { evidenceDropped: 0, downgradedFrom: null, ...extra },
})

/**
 * `raw` is whatever the AI returned under "assessment". `context` is the exact text that was sent:
 * { updates, projectDescription, projectStatus }. Always returns a well-formed assessment.
 */
export function validateAssessment(raw, context) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return insufficient('The AI did not return a usable assessment, so no status is recommended.', { downgradedFrom: 'invalid-response' })
  if (!OUTCOMES.includes(raw.outcome))
    return insufficient('The AI returned an assessment that could not be used, so no status is recommended.', { downgradedFrom: 'invalid-outcome' })

  const rawEvidence = Array.isArray(raw.evidence) ? raw.evidence : []
  const verified = rawEvidence
    .filter((e) => evidenceIsReal(e, context))
    .map((e) => ({ source: e.source, quote: clean(e.quote, 500) }))
    // the same quote twice adds nothing
    .filter((e, i, all) => all.findIndex((o) => o.source === e.source && normalize(o.quote) === normalize(e.quote)) === i)
    .slice(0, MAX_EVIDENCE)
  const evidenceDropped = rawEvidence.length - verified.length

  const missingInformation = (Array.isArray(raw.missingInformation) ? raw.missingInformation : [])
    .map((m) => clean(m, 300))
    .filter(Boolean)
    .slice(0, MAX_MISSING)
  const explanation = clean(raw.explanation)

  if (raw.outcome === INSUFFICIENT) {
    return {
      outcome: INSUFFICIENT,
      explanation: explanation || 'There is not enough information in the submitted update to recommend a status.',
      evidence: verified,
      missingInformation,
      checks: { evidenceDropped, downgradedFrom: null },
    }
  }

  // A status needs at least one verified quote from the submitted update itself. The description and the
  // existing status are background: they cannot, on their own, justify a recommendation.
  if (!verified.some((e) => e.source === 'update')) {
    return {
      ...insufficient(
        `The AI suggested "${raw.outcome}", but none of its supporting evidence could be matched to the submitted update, so no status is recommended.`,
        { evidenceDropped, downgradedFrom: raw.outcome },
      ),
      missingInformation,
    }
  }
  if (!explanation) {
    return {
      ...insufficient(`The AI suggested "${raw.outcome}" without an explanation, so no status is recommended.`, { evidenceDropped, downgradedFrom: raw.outcome }),
      missingInformation,
    }
  }

  return { outcome: raw.outcome, explanation, evidence: verified, missingInformation, checks: { evidenceDropped, downgradedFrom: null } }
}

// The confirmed status sent as context: only one of the four statuses, never arbitrary text.
export const cleanProjectStatus = (v) => (STATUSES.includes(v) ? v : '')
