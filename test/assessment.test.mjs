import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { validateAssessment, normalize, cleanProjectStatus, OUTCOMES, STATUSES as SERVER_STATUSES } from '../server/assessment.js'
import { SYSTEM_PROMPT } from '../server/prompt.js'
import { buildPrompt } from '../server/providers/gemini.js'
import { startServer, validBody } from './helpers/server.mjs'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput, content } from './helpers/fixtures.mjs'
import { STATUSES, ASSESSMENT_OUTCOMES, INSUFFICIENT, validAssessment, validStatusDecision, validReportV2, cleanAssessment, decisionAction } from '../src/schema.js'

// The AI only RECOMMENDS a project health status. Its evidence must be verbatim quotes from the text it was given;
// anything it cannot back up is removed or downgraded to "Insufficient Information" (which is not a status).

const UPDATE = 'Finished the login API. Dashboard about 60% done.\nPayment integration blocked: vendor has not issued sandbox credentials.'
const DESCRIPTION = 'Replace the legacy invoicing tool so finance can close month-end faster.'
const ctx = (over = {}) => ({ updates: UPDATE, projectDescription: DESCRIPTION, projectStatus: 'At Risk', ...over })
const ev = (quote, source = 'update') => ({ source, quote })
const raw = (over = {}) => ({
  outcome: 'Blocked',
  explanation: 'Payments cannot proceed until the vendor issues credentials.',
  evidence: [ev('Payment integration blocked: vendor has not issued sandbox credentials.')],
  missingInformation: ['No date for the credentials'],
  ...over,
})

describe('the five outcomes', () => {
  it('are the four statuses plus "Insufficient Information", which is NOT a status', () => {
    assert.deepEqual(STATUSES, ['On Track', 'At Risk', 'Blocked', 'Off Track'])
    assert.deepEqual(SERVER_STATUSES, STATUSES)
    assert.deepEqual(OUTCOMES, [...STATUSES, 'Insufficient Information'])
    assert.deepEqual(ASSESSMENT_OUTCOMES, OUTCOMES)
    assert.equal(INSUFFICIENT, 'Insufficient Information')
    assert.ok(!STATUSES.includes(INSUFFICIENT))
  })

  for (const outcome of STATUSES) {
    it(`"${outcome}" passes through when it is backed by a quote from the update`, () => {
      const a = validateAssessment(raw({ outcome }), ctx())
      assert.equal(a.outcome, outcome)
      assert.equal(a.evidence.length, 1)
      assert.equal(a.checks.downgradedFrom, null)
      assert.equal(a.checks.evidenceDropped, 0)
      assert.ok(validAssessment(a))
    })
  }

  it('"Insufficient Information" passes through with its explanation and missing information', () => {
    const a = validateAssessment({ outcome: INSUFFICIENT, explanation: 'The update is one line.', evidence: [], missingInformation: ['Schedule', 'Status of testing'] }, ctx())
    assert.equal(a.outcome, INSUFFICIENT)
    assert.equal(a.explanation, 'The update is one line.')
    assert.deepEqual(a.missingInformation, ['Schedule', 'Status of testing'])
    assert.equal(a.checks.downgradedFrom, null) // chosen by the AI, not forced
  })

  it('"Insufficient Information" needs no evidence and gets a plain explanation if the AI gave none', () => {
    const a = validateAssessment({ outcome: INSUFFICIENT, explanation: '', evidence: [], missingInformation: [] }, ctx())
    assert.equal(a.outcome, INSUFFICIENT)
    assert.match(a.explanation, /not enough information/i)
  })
})

describe('evidence validation', () => {
  it('keeps a quote that appears in the update, ignoring case, spacing and typographic quotes/dashes', () => {
    const c = ctx({ updates: 'The vendor said “we’ll deliver”  on  Friday – maybe.' })
    const a = validateAssessment(raw({ evidence: [ev("the vendor said \"we'll deliver\" on friday - maybe.")] }), c)
    assert.equal(a.evidence.length, 1)
  })

  it('drops a quote that is not in the update (invented, paraphrased or reworded)', () => {
    const a = validateAssessment(
      raw({ evidence: [ev('The payment vendor has been unresponsive for three weeks'), ev('Payment integration is stuck'), ev('Payment integration blocked: vendor has not issued sandbox credentials.')] }),
      ctx(),
    )
    assert.equal(a.evidence.length, 1)
    assert.equal(a.checks.evidenceDropped, 2)
    assert.equal(a.outcome, 'Blocked') // one real quote is enough to keep the recommendation
  })

  it('drops quotes that are too short to prove anything', () => {
    const a = validateAssessment(raw({ evidence: [ev('blocked'), ev('the'), ev('Dashboard about 60% done.')] }), ctx())
    assert.deepEqual(a.evidence.map((e) => e.quote), ['Dashboard about 60% done.'])
  })

  it('drops a quote that names the wrong source (an update quote claimed to come from the description)', () => {
    const a = validateAssessment(raw({ evidence: [ev('Dashboard about 60% done.', 'description'), ev('Dashboard about 60% done.')] }), ctx())
    assert.deepEqual(a.evidence, [ev('Dashboard about 60% done.')])
  })

  it('accepts a verbatim quote from the project description as supporting evidence next to an update quote', () => {
    const a = validateAssessment(raw({ evidence: [ev('Payment integration blocked: vendor has not issued sandbox credentials.'), ev('close month-end faster', 'description')] }), ctx())
    assert.equal(a.evidence.length, 2)
  })

  it('accepts the current confirmed status only when the quote is exactly that status', () => {
    const ok = validateAssessment(raw({ evidence: [ev('Dashboard about 60% done.'), ev('At Risk', 'confirmedStatus')] }), ctx())
    assert.equal(ok.evidence.length, 2)
    const wrong = validateAssessment(raw({ evidence: [ev('Dashboard about 60% done.'), ev('Blocked', 'confirmedStatus')] }), ctx())
    assert.equal(wrong.evidence.length, 1)
    const unset = validateAssessment(raw({ evidence: [ev('Dashboard about 60% done.'), ev('At Risk', 'confirmedStatus')] }), ctx({ projectStatus: '' }))
    assert.equal(unset.evidence.length, 1) // there is no confirmed status to quote
  })

  it('does not allow a quote from the project name, audience or reporting period (they are not evidence)', () => {
    const a = validateAssessment(raw({ evidence: [ev('Steering committee', 'audience'), ev('Alpha Project', 'projectName'), ev('Dashboard about 60% done.')] }), ctx())
    assert.equal(a.evidence.length, 1)
    assert.equal(a.checks.evidenceDropped, 2)
  })

  it('removes duplicates and caps the number of items', () => {
    const many = Array.from({ length: 30 }, (_, i) => ev(`Dashboard about 60% done.`.slice(0, 20 + (i % 3))))
    const a = validateAssessment(raw({ evidence: many }), ctx())
    assert.ok(a.evidence.length <= 8)
    const keys = a.evidence.map((e) => normalize(e.quote))
    assert.equal(new Set(keys).size, keys.length)
  })

  it('ignores malformed evidence items without throwing', () => {
    const a = validateAssessment(raw({ evidence: [null, 5, 'text', {}, { source: 'update' }, { quote: 'Dashboard about 60% done.' }, ev('Dashboard about 60% done.')] }), ctx())
    assert.equal(a.evidence.length, 1)
  })
})

describe('a recommendation is never made without evidence from the update', () => {
  it('downgrades a status whose every quote is fabricated, and says so', () => {
    const a = validateAssessment(raw({ outcome: 'Off Track', evidence: [ev('The programme is six months late against plan')] }), ctx())
    assert.equal(a.outcome, INSUFFICIENT)
    assert.equal(a.checks.downgradedFrom, 'Off Track')
    assert.equal(a.checks.evidenceDropped, 1)
    assert.match(a.explanation, /Off Track/)
    assert.match(a.explanation, /no status is recommended/)
    assert.deepEqual(a.evidence, [])
  })

  it('downgrades a status that has no evidence at all', () => {
    const a = validateAssessment(raw({ outcome: 'At Risk', evidence: [] }), ctx())
    assert.equal(a.outcome, INSUFFICIENT)
    assert.equal(a.checks.downgradedFrom, 'At Risk')
  })

  it('downgrades "On Track" with no evidence: silence is not proof the project is fine', () => {
    for (const evidence of [[], [ev('Everything is going well')]]) {
      const a = validateAssessment(raw({ outcome: 'On Track', evidence }), ctx())
      assert.equal(a.outcome, INSUFFICIENT)
      assert.equal(a.checks.downgradedFrom, 'On Track')
    }
  })

  it('does not accept the description or the existing status alone as the basis for a status', () => {
    const a = validateAssessment(raw({ outcome: 'Blocked', evidence: [ev('close month-end faster', 'description'), ev('At Risk', 'confirmedStatus')] }), ctx())
    assert.equal(a.outcome, INSUFFICIENT)
    assert.equal(a.checks.downgradedFrom, 'Blocked')
  })

  it('downgrades a status that has no explanation', () => {
    const a = validateAssessment(raw({ explanation: '   ' }), ctx())
    assert.equal(a.outcome, INSUFFICIENT)
  })

  it('keeps the AI\'s missing-information notes when it downgrades', () => {
    const a = validateAssessment(raw({ evidence: [], missingInformation: ['Dates'] }), ctx())
    assert.deepEqual(a.missingInformation, ['Dates'])
  })
})

describe('unusable AI output never defaults to a status', () => {
  const bad = [undefined, null, 'On Track', 42, [], {}, { outcome: 'Green' }, { outcome: 'on track', explanation: 'x', evidence: [], missingInformation: [] },
    { outcome: 'Insufficient information' }, { outcome: ['On Track'] }, { outcome: null }]
  bad.forEach((b, i) => {
    it(`case ${i} (${JSON.stringify(b)}) becomes Insufficient Information`, () => {
      const a = validateAssessment(b, ctx())
      assert.equal(a.outcome, INSUFFICIENT)
      assert.notEqual(a.outcome, 'On Track')
      assert.ok(validAssessment(a))
      assert.ok(a.explanation.length > 0)
    })
  })

  it('tolerates wrong types for the optional lists and text', () => {
    const a = validateAssessment({ outcome: 'Blocked', explanation: 'ok', evidence: 'nope', missingInformation: 'nope' }, ctx())
    assert.equal(a.outcome, INSUFFICIENT)
    const b = validateAssessment(raw({ missingInformation: [1, null, '  ', 'Real gap'] }), ctx())
    assert.deepEqual(b.missingInformation, ['Real gap'])
  })

  it('cleanProjectStatus only lets one of the four statuses through', () => {
    for (const s of STATUSES) assert.equal(cleanProjectStatus(s), s)
    for (const s of [INSUFFICIENT, 'Green', '', null, undefined, 5, 'on track']) assert.equal(cleanProjectStatus(s), '')
  })
})

describe('the prompt', () => {
  it('states the four definitions, the separate insufficient outcome, and the evidence rules', () => {
    for (const phrase of [
      'On Track: the project is progressing as expected, with no material threat evident.',
      'At Risk: an emerging issue or identified risk could affect delivery if not addressed.',
      'Blocked: a current unresolved impediment is preventing a critical activity or meaningful progress.',
      'Off Track: the project has materially deviated from agreed objectives, delivery expectations or timeline.',
      'This is NOT a status',
      'Never choose "On Track" just because no problem is mentioned.',
      'Do not treat something being omitted from the update as proof that a problem has been resolved.',
      'VERBATIM',
      'Never invent facts, dates, owners, progress or decisions.',
    ]) assert.ok(SYSTEM_PROMPT.includes(phrase), phrase)
  })

  it('sends the current confirmed status, labelled as background, and "Not set" when there is none', () => {
    assert.match(buildPrompt({ updates: 'u', projectStatus: 'Blocked' }), /Current confirmed project status \(background context only\): Blocked/)
    assert.match(buildPrompt({ updates: 'u' }), /Current confirmed project status \(background context only\): Not set/)
  })
})

describe('API: assessment alongside the report, in ONE provider call', () => {
  const run = async (assessmentEnv, body = validBody(), env = {}) => {
    const srv = await startServer({ env: { ...(assessmentEnv === undefined ? {} : { TEST_GENAI_ASSESSMENT: assessmentEnv }), ...env } })
    try {
      const res = await srv.request('/api/report', { method: 'POST', json: body })
      return { res, requests: srv.requests.filter((r) => !r.blocked) }
    } finally {
      await srv.stop()
    }
  }
  const FIRST_LINE = validBody().updates

  it('returns the report and a verified assessment from a single Gemini request', async () => {
    const { res, requests } = await run(undefined)
    assert.equal(res.status, 200)
    assert.equal(requests.length, 1)
    assert.equal(res.body.assessment.outcome, 'At Risk')
    assert.equal(res.body.assessment.evidence[0].quote, FIRST_LINE.split('\n')[0].trim())
    assert.ok(validAssessment(res.body.assessment))
  })

  it('keeps the assessment out of the report itself (the report keeps its seven sections only)', async () => {
    const { res } = await run(undefined)
    assert.equal('assessment' in res.body.report, false)
    assert.deepEqual(Object.keys(res.body.report).sort(), ['blockers', 'completedActivities', 'executiveActionRequired', 'executiveSummary', 'nextSteps', 'risks', 'title', 'workInProgress'])
  })

  for (const outcome of STATUSES) {
    it(`returns "${outcome}" when the AI recommends it with real evidence`, async () => {
      const a = JSON.stringify({ outcome, explanation: 'Because of the update.', evidence: [{ source: 'update', quote: 'Dashboard about 60% done.' }], missingInformation: [] })
      const { res } = await run(a)
      assert.equal(res.body.assessment.outcome, outcome)
    })
  }

  it('returns "Insufficient Information" when the AI says so', async () => {
    const a = JSON.stringify({ outcome: INSUFFICIENT, explanation: 'Too little to go on.', evidence: [], missingInformation: ['Everything'] })
    const { res } = await run(a)
    assert.equal(res.body.assessment.outcome, INSUFFICIENT)
    assert.deepEqual(res.body.assessment.missingInformation, ['Everything'])
  })

  it('removes fabricated evidence and downgrades when nothing real is left', async () => {
    const a = JSON.stringify({ outcome: 'Blocked', explanation: 'x', evidence: [{ source: 'update', quote: 'The vendor cancelled the contract yesterday' }], missingInformation: [] })
    const { res } = await run(a)
    assert.equal(res.status, 200)
    assert.equal(res.body.assessment.outcome, INSUFFICIENT)
    assert.equal(res.body.assessment.checks.downgradedFrom, 'Blocked')
    assert.deepEqual(res.body.assessment.evidence, [])
  })

  it('still returns the report, with Insufficient Information, when the AI leaves the assessment out', async () => {
    const { res, requests } = await run('omit')
    assert.equal(res.status, 200)
    assert.equal(requests.length, 1) // no second call to "repair" it
    assert.equal(res.body.assessment.outcome, INSUFFICIENT)
    assert.equal(res.body.report.title, 'Stubbed – Status Report')
  })

  it('sends only the project description, the confirmed status and the update as assessment context', async () => {
    const { requests } = await run(undefined, validBody({ projectStatus: 'Blocked' }))
    const prompt = requests[0].prompt
    assert.match(prompt, /Current confirmed project status \(background context only\): Blocked/)
    assert.ok(prompt.includes(validBody().projectDescription))
    assert.ok(prompt.includes(validBody().updates))
    assert.ok(requests[0].system.includes('Insufficient Information'))
  })

  it('ignores a confirmed status that is not one of the four statuses', async () => {
    for (const projectStatus of ['Insufficient Information', 'Green', { x: 1 }, 7]) {
      const { requests } = await run(undefined, validBody({ projectStatus }))
      assert.match(requests[0].prompt, /Current confirmed project status \(background context only\): Not set/)
    }
  })

  it('counts as ONE live generation against the limits', async () => {
    const srv = await startServer({ env: { DAILY_REQUEST_CAP: '1' } })
    try {
      const first = await srv.request('/api/report', { method: 'POST', json: validBody() })
      const second = await srv.request('/api/report', { method: 'POST', json: validBody() })
      assert.equal(first.status, 200)
      assert.equal(second.status, 429)
      assert.equal(srv.requests.filter((r) => !r.blocked).length, 1)
    } finally {
      await srv.stop()
    }
  })

  it('does not return an assessment on errors, and live generation stays off when not enabled', async () => {
    const srv = await startServer({ env: { NODE_ENV: 'production' } })
    try {
      const res = await srv.request('/api/report', { method: 'POST', json: validBody() })
      assert.equal(res.status, 503)
      assert.equal(res.body.code, 'DISABLED')
      assert.equal('assessment' in res.body, false)
      assert.equal(srv.requests.length, 0)
    } finally {
      await srv.stop()
    }
  })
})

describe('storing the recommendation and the PM\'s decision', () => {
  let storage, store, project
  const t0 = '2026-11-10T09:00:00.000Z'
  const A = (outcome, over = {}) => ({
    outcome, explanation: 'Because.', evidence: [{ source: 'update', quote: 'Dashboard about 60% done.' }], missingInformation: ['A gap'], checks: { evidenceDropped: 0, downgradedFrom: null }, ...over,
  })
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
    mock.timers.enable({ apis: ['Date'], now: new Date(t0) })
  })
  afterEach(() => {
    mock.timers.reset()
    releaseStorage()
  })
  const persisted = () => readPersisted(storage)
  const save = (assessment, chosen, over = {}) =>
    store.actions.addReport(reportInput(project.id, { assessment, projectStatusAtReport: chosen, ...over }))
  const saved = (id) => persisted().reports.find((r) => r.id === id)

  it('stores the AI recommendation exactly as shown, valid for the report schema', () => {
    const r = save(A('Blocked'), 'Blocked')
    assert.deepEqual(saved(r.id).assessment, A('Blocked'))
    assert.ok(validReportV2(saved(r.id)))
  })

  it('records "confirmed" when the PM chooses the recommended status', () => {
    const r = save(A('At Risk'), 'At Risk')
    assert.deepEqual(saved(r.id).statusDecision, { status: 'At Risk', action: 'confirmed', decidedAt: t0 })
  })

  it('records "overridden" when the PM chooses a different status, and keeps the AI\'s recommendation untouched', () => {
    const r = save(A('Blocked'), 'On Track')
    assert.deepEqual(saved(r.id).statusDecision, { status: 'On Track', action: 'overridden', decidedAt: t0 })
    assert.equal(saved(r.id).assessment.outcome, 'Blocked')
    assert.equal(saved(r.id).projectStatusAtReport, 'On Track')
  })

  it('cannot be saved with no status at all, even with a recommendation: the AI alone never finalises a status', () => {
    assert.throws(() => save(A('Off Track'), ''), /finalised/)
    assert.deepEqual(persisted().reports, [])
  })

  it('records "no-recommendation" for Insufficient Information, whatever the PM chooses', () => {
    for (const chosen of ['At Risk', 'On Track']) {
      const r = save(A(INSUFFICIENT, { evidence: [] }), chosen)
      assert.equal(saved(r.id).statusDecision.action, 'no-recommendation')
      assert.equal(saved(r.id).statusDecision.status, chosen)
    }
    assert.throws(() => save(A(INSUFFICIENT, { evidence: [] }), ''), /finalised/) // it still has to be chosen
  })

  it('"Insufficient Information" can never become a project status or a status decision', () => {
    assert.throws(() => store.actions.setProjectStatus(project.id, INSUFFICIENT, { type: 'manual' }), /Unknown project status/)
    assert.equal(validStatusDecision({ status: INSUFFICIENT, action: 'confirmed', decidedAt: t0 }), false)
  })

  it('saving a recommendation alone never changes the project status or its history', () => {
    store.actions.setProjectStatus(project.id, 'On Track')
    const before = structuredClone({ projects: persisted().projects, history: persisted().statusHistory })
    save(A('Blocked'), 'On Track') // PM keeps the current status
    assert.deepEqual(persisted().projects, before.projects)
    assert.deepEqual(persisted().statusHistory, before.history)
    assert.equal(persisted().projects[0].status, 'On Track')
  })

  it('a confirmed recommendation changes the status only through the PM\'s action, recorded as "ai-confirmed" with the report', () => {
    const r = save(A('Blocked'), 'Blocked')
    // what the app does after saving, because the PM chose that status
    const entry = store.actions.setProjectStatus(project.id, 'Blocked', { type: r.statusDecision.action === 'confirmed' ? 'ai-confirmed' : 'report', reportId: r.id })
    assert.equal(entry.source, 'ai-confirmed')
    assert.equal(entry.reportId, r.id)
    assert.equal(persisted().projects[0].status, 'Blocked')
    assert.equal(persisted().projects[0].statusSource.type, 'ai-confirmed')
  })

  it('an override is recorded as set from the report, not as AI-confirmed', () => {
    const r = save(A('Blocked'), 'At Risk')
    const entry = store.actions.setProjectStatus(project.id, 'At Risk', { type: r.statusDecision.action === 'confirmed' ? 'ai-confirmed' : 'report', reportId: r.id })
    assert.equal(entry.source, 'report')
  })

  it('editing the report never changes the recommendation or the decision', () => {
    const r = save(A('Blocked'), 'At Risk')
    const before = structuredClone({ a: saved(r.id).assessment, d: saved(r.id).statusDecision })
    mock.timers.tick(60_000)
    store.actions.updateReportContent(r.id, content({ title: 'Edited by PM' }))
    assert.deepEqual({ a: saved(r.id).assessment, d: saved(r.id).statusDecision }, before)
  })

  it('stores its own copy: changing the object that was passed in later changes nothing', () => {
    const input = A('Blocked')
    const r = save(input, 'Blocked')
    input.outcome = 'On Track'
    input.evidence.push({ source: 'update', quote: 'tampered quote text' })
    store.actions.deleteReport('__no-such-report__') // forces a re-save
    assert.equal(saved(r.id).assessment.outcome, 'Blocked')
    assert.equal(saved(r.id).assessment.evidence.length, 1)
  })

  it('no assessment -> both fields are null (never invented)', () => {
    for (const assessment of [undefined, null]) {
      const r = save(assessment, 'On Track')
      assert.equal(saved(r.id).assessment, null)
      assert.equal(saved(r.id).statusDecision, null)
    }
  })

  it('a malformed assessment is not stored, and does not produce a decision', () => {
    for (const bad of [{ outcome: 'Green' }, { outcome: 'On Track' }, 'On Track', 5, { outcome: 'At Risk', explanation: 'x', evidence: 'nope', missingInformation: [] },
      { outcome: 'At Risk', explanation: 'x', evidence: [{ source: 'blog', quote: 'q' }], missingInformation: [] }]) {
      const r = save(bad, 'At Risk')
      assert.equal(saved(r.id).assessment, null, JSON.stringify(bad))
      assert.equal(saved(r.id).statusDecision, null)
    }
  })

  it('survives a reload unchanged', async () => {
    const r = save(A('Blocked'), 'At Risk')
    const before = structuredClone({ a: saved(r.id).assessment, d: saved(r.id).statusDecision })
    releaseStorage()
    const reloaded = await loadStore(storage)
    reloaded.actions.deleteReport('__no-such-report__')
    assert.equal(storage.data.has('statusai.v1.set-aside'), false)
    assert.deepEqual({ a: saved(r.id).assessment, d: saved(r.id).statusDecision }, before)
  })

  it('demo reports, sample copies and older reports have no assessment', () => {
    store.actions.loadDemo()
    for (const r of persisted().reports.filter((x) => x.demo)) assert.ok(r.assessment == null && r.statusDecision == null)
    const demoProject = persisted().projects.find((p) => p.demo)
    const copy = store.actions.saveSampleCopy({ projectId: demoProject.id, content: content(), originalUpdate: 'u', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 's' })
    assert.ok(copy.assessment == null && copy.statusDecision == null)
  })

  it('a stored record with an invalid assessment is rejected as malformed', () => {
    const r = save(A('Blocked'), 'Blocked')
    assert.equal(validReportV2({ ...saved(r.id), assessment: { outcome: 'Green' } }), false)
    assert.equal(validReportV2({ ...saved(r.id), statusDecision: { status: 'Blocked', action: 'auto-applied', decidedAt: t0 } }), false)
    assert.equal(validReportV2({ ...saved(r.id), assessment: null, statusDecision: null }), true)
  })
})

describe('schema helpers', () => {
  it('decisionAction compares the PM\'s choice with the recommendation', () => {
    assert.equal(decisionAction({ outcome: 'Blocked' }, 'Blocked'), 'confirmed')
    assert.equal(decisionAction({ outcome: 'Blocked' }, 'At Risk'), 'overridden')
    assert.equal(decisionAction({ outcome: 'Blocked' }, ''), 'overridden')
    assert.equal(decisionAction({ outcome: 'Blocked' }, undefined), 'overridden')
    assert.equal(decisionAction({ outcome: INSUFFICIENT }, 'Blocked'), 'no-recommendation')
  })

  it('cleanAssessment keeps a valid assessment as a copy and returns null for anything else', () => {
    const a = { outcome: 'At Risk', explanation: 'x', evidence: [{ source: 'update', quote: 'q' }], missingInformation: [] }
    const c = cleanAssessment(a)
    assert.deepEqual(c.evidence, a.evidence)
    assert.notEqual(c.evidence, a.evidence)
    for (const bad of [undefined, null, {}, { outcome: 'x' }, 'str']) assert.equal(cleanAssessment(bad), null)
  })
})

