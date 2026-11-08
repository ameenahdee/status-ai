// Preloaded (node --import) into the test server process. It replaces the global fetch used by the
// Gemini SDK, so the real server code and real provider code run end to end with no network access.
// Any call to a host other than the Gemini API is blocked and reported, so a stray real call fails loudly.
//
// Behaviour is chosen with TEST_GENAI_MODE: ok | 503 | 429 | 500 | badjson | empty | hang
// The health assessment in the answer is controlled with TEST_GENAI_ASSESSMENT:
//   (unset)        a default "At Risk" assessment quoting the first line of the submitted update
//   omit           the answer has no assessment at all
//   <json>         that JSON is used as the assessment (to test every outcome and bad evidence)
// The "changes" (What Changed) are only returned when the prompt contains a previous report, like the real
// model would, and are controlled with TEST_GENAI_CHANGES:
//   (unset)        one "new" change quoting the first line of the submitted update
//   omit           the answer has no "changes" at all
//   <json>         that JSON array is used as the changes
// Every Gemini request is logged to stdout as `[stub] {json}` so tests can inspect what was sent.
const GEMINI_HOST = 'https://generativelanguage.googleapis.com/'
const mode = process.env.TEST_GENAI_MODE || 'ok'

const REPORT = {
  title: 'Stubbed – Status Report',
  executiveSummary: 'Stubbed summary.',
  completedActivities: ['Stubbed completed item'],
  workInProgress: ['Stubbed in-progress item'],
  blockers: ['Not specified in the submitted update.'],
  risks: ['Not specified in the submitted update.'],
  nextSteps: ['Stubbed next step'],
  executiveActionRequired: ['No executive action required at this time.'],
}

// The submitted update, taken from the prompt the server built (between the triple quotes).
const updateFrom = (prompt) => (String(prompt ?? '').match(/"""\r?\n([\s\S]*)\r?\n"""/) ?? [])[1] ?? ''

function assessmentFor(prompt) {
  const setting = process.env.TEST_GENAI_ASSESSMENT
  if (setting === 'omit') return undefined
  if (setting) return JSON.parse(setting)
  const firstLine = updateFrom(prompt).split('\n')[0].trim()
  return {
    outcome: 'At Risk',
    explanation: 'Stubbed explanation based on the update.',
    evidence: [{ source: 'update', quote: firstLine }],
    missingInformation: ['Stubbed missing information'],
  }
}

function changesFor(prompt) {
  if (!String(prompt ?? '').includes('Previous report (for comparison only')) return undefined
  const setting = process.env.TEST_GENAI_CHANGES
  if (setting === 'omit') return undefined
  if (setting) return JSON.parse(setting)
  const firstLine = updateFrom(prompt).split('\n')[0].trim()
  return [{ category: 'newDevelopments', state: 'new', text: 'Stubbed new development.', currentQuote: firstLine, previousQuote: '' }]
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const answer = (text) => json(200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }] })

const headerValue = (headers, name) => {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name)
  return hit ? headers[hit] : undefined
}

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input))
  if (!url.startsWith(GEMINI_HOST)) {
    console.log('[stub] ' + JSON.stringify({ blocked: url }))
    throw new Error(`Blocked unexpected network call to ${url}`)
  }
  let body = null
  try {
    body = init.body ? JSON.parse(init.body) : null
  } catch {
    /* not JSON */
  }
  console.log(
    '[stub] ' +
      JSON.stringify({
        url,
        apiKeyHeader: headerValue(init.headers, 'x-goog-api-key') ?? null,
        prompt: body?.contents?.[0]?.parts?.[0]?.text ?? null,
        system: body?.systemInstruction?.parts?.[0]?.text ?? null,
        mode,
      }),
  )

  switch (mode) {
    case 'ok':
      return answer(JSON.stringify({ ...REPORT, assessment: assessmentFor(body?.contents?.[0]?.parts?.[0]?.text), changes: changesFor(body?.contents?.[0]?.parts?.[0]?.text) }))
    case '503':
      return json(503, { error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } })
    case '429':
      return json(429, { error: { code: 429, message: 'Quota exceeded for this project.', status: 'RESOURCE_EXHAUSTED' } })
    case '500':
      return json(500, { error: { code: 500, message: `Internal error. key=${process.env.GEMINI_API_KEY}`, status: 'INTERNAL' } })
    case 'badjson':
      return answer('{ this is not valid json')
    case 'empty':
      return json(200, { candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'STOP' }] })
    case 'hang':
      // Never answers; only ends when the caller aborts (this is what the server's timeout relies on).
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal.reason ?? new DOMException('Aborted', 'AbortError')))
      })
    default:
      throw new Error(`Unknown TEST_GENAI_MODE: ${mode}`)
  }
}
