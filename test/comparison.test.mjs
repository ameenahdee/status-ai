import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validatePrevious, validateComparison, NO_PREVIOUS, CATEGORIES, STATES } from '../server/comparison.js'
import { SYSTEM_PROMPT } from '../server/prompt.js'
import { buildPrompt } from '../server/providers/gemini.js'
import { comparisonBaselineFor } from '../src/history.js'
import { startServer, validBody } from './helpers/server.mjs'
import { content } from './helpers/fixtures.mjs'
import { validWhatsChanged } from '../src/schema.js'

// "What Changed Since Last Report": the AI proposes changes, the server only lets through changes that quote the
// texts it was given, and something missing from the update is never treated as resolved.

const PREV_CONTENT = content({
  executiveSummary: 'Login is done and payments are the main concern.',
  completedActivities: ['Finished the login API'],
  workInProgress: ['Dashboard build is under way'],
  blockers: ['Payment integration is blocked: vendor has not issued sandbox credentials'],
  risks: ['Go-live may slip if credentials are late'],
  nextSteps: ['Start user acceptance testing'],
  executiveActionRequired: ['Escalate the credentials request to the vendor account manager'],
})
const PREV = { periodStart: '2026-10-01', periodEnd: '2026-10-07', content: PREV_CONTENT }
const UPDATE = 'Vendor sandbox credentials were received on Tuesday. Dashboard is now 80% complete. A new data-protection review has been requested by Legal.'
const previous = () => validatePrevious(PREV)
const ch = (over = {}) => ({ category: 'newDevelopments', state: 'new', text: 'Legal has requested a data-protection review.', currentQuote: 'A new data-protection review has been requested by Legal.', previousQuote: '', ...over })
const run = (raw, updates = UPDATE) => validateComparison(raw, { updates, previous: previous() })

describe('the previous report as received by the server', () => {
  it('is accepted when well formed, and every sentence becomes a checkable item', () => {
    const p = previous()
    assert.equal(p.periodEnd, '2026-10-07')
    assert.ok(p.items.includes('Finished the login API'))
    assert.match(p.promptText, /Blockers: Payment integration is blocked/)
  })

  it('is rejected (so the comparison is unavailable) when malformed, empty or too large', () => {
    for (const bad of [null, 'text', [], {}, { periodEnd: '2026-10-07' }, { periodEnd: 'yesterday', content: PREV_CONTENT },
      { periodEnd: '2026-10-07', content: 'x' }, { periodEnd: '2026-10-07', content: { risks: 'not a list' } },
      { periodEnd: '2026-10-07', content: { risks: [1, 2] } }, { periodEnd: '2026-10-07', content: {} },
      { periodEnd: '2026-10-07', content: { executiveSummary: 'x'.repeat(16000) } },
      { periodStart: 'bad', periodEnd: '2026-10-07', content: PREV_CONTENT }]) {
      assert.equal(validatePrevious(bad), null, JSON.stringify(bad)?.slice(0, 60))
    }
  })
})

describe('validating the proposed changes', () => {
  it('keeps a new development that quotes the current update', () => {
    const r = run([ch()])
    assert.equal(r.status, 'compared')
    assert.equal(r.items.length, 1)
    assert.deepEqual(r.items[0].evidence, { current: 'A new data-protection review has been requested by Legal.', previous: null })
    assert.equal(r.checks.itemsDropped, 0)
  })

  it('keeps an explicitly resolved blocker only when BOTH the open blocker and the resolution are quoted', () => {
    const r = run([ch({ category: 'completedResolved', state: 'resolved', text: 'The vendor has issued the sandbox credentials, so payments are unblocked.',
      currentQuote: 'Vendor sandbox credentials were received on Tuesday.', previousQuote: 'Payment integration is blocked: vendor has not issued sandbox credentials' })])
    assert.equal(r.items.length, 1)
    assert.equal(r.items[0].state, 'resolved')
    assert.equal(r.items[0].category, 'completedResolved')
  })

  it('keeps a continuing blocker only when the update still shows it AND the previous report had it', () => {
    const updates = 'Payment integration is still blocked while we wait for the vendor.'
    const r = run([ch({ category: 'continuingBlockers', state: 'continuing', text: 'Payments are still blocked on the vendor.', currentQuote: 'Payment integration is still blocked while we wait for the vendor.', previousQuote: 'Payment integration is blocked: vendor has not issued sandbox credentials' })], updates)
    assert.equal(r.items[0].state, 'continuing')
    assert.equal(r.items[0].category, 'continuingBlockers')
  })

  it('keeps a changed risk (increased/reduced) with quotes from both reports', () => {
    const updates = 'The go-live date is now at serious risk because credentials are still late.'
    const r = run([ch({ category: 'risks', state: 'changed', text: 'The go-live risk has increased.', currentQuote: 'The go-live date is now at serious risk', previousQuote: 'Go-live may slip if credentials are late' })], updates)
    assert.equal(r.items[0].state, 'changed')
  })

  it('keeps progress and next-step changes that are quoted', () => {
    const r = run([
      ch({ category: 'progress', state: 'changed', text: 'Dashboard progress has moved on.', currentQuote: 'Dashboard is now 80% complete.', previousQuote: 'Dashboard build is under way' }),
      ch({ category: 'nextSteps', state: 'new', text: 'A data-protection review is now planned.', currentQuote: 'has been requested by Legal' }),
    ])
    assert.deepEqual(r.items.map((i) => i.category), ['progress', 'nextSteps'])
  })

  it('NEVER treats an omitted blocker as resolved: a "resolved" claim with no current quote becomes "status unclear"', () => {
    const updates = 'Dashboard is now 80% complete.' // says nothing about payments
    const r = run([ch({ category: 'executiveActions', state: 'resolved', text: 'The vendor escalation is done.', currentQuote: '', previousQuote: 'Escalate the credentials request to the vendor account manager' })], updates)
    assert.equal(r.items.length, 1)
    assert.equal(r.items[0].state, 'unclear')
    assert.equal(r.items[0].evidence.current, null)
    assert.match(r.items[0].text, /^Previously reported: "Escalate the credentials request/)
    assert.doesNotMatch(r.items[0].text, /done|resolved|completed/i)
    assert.equal(r.checks.itemsDowngraded, 1)
  })

  it('a "resolved" claim whose current quote is not in the update is also downgraded, never kept as resolved', () => {
    const updates = 'Dashboard is now 80% complete.'
    const r = run([ch({ category: 'risks', state: 'resolved', text: 'The go-live risk has gone.', currentQuote: 'The go-live risk has been fully mitigated', previousQuote: 'Go-live may slip if credentials are late' })], updates)
    assert.equal(r.items[0].state, 'unclear')
  })

  it('a "continuing" claim the update does not support is downgraded to unclear, not asserted', () => {
    const r = run([ch({ category: 'continuingBlockers', state: 'continuing', text: 'Still blocked.', currentQuote: 'Payments are still stuck', previousQuote: 'Payment integration is blocked: vendor has not issued sandbox credentials' })])
    assert.equal(r.items[0].state, 'unclear')
    assert.match(r.items[0].text, /does not confirm/)
  })

  it('a resolved item in a category that cannot be "unclear" is dropped rather than shown as resolved', () => {
    const updates = 'Dashboard is now 80% complete.'
    const r = run([ch({ category: 'completedResolved', state: 'resolved', text: 'Blocker cleared.', currentQuote: '', previousQuote: 'Payment integration is blocked: vendor has not issued sandbox credentials' })], updates)
    assert.deepEqual(r.items, [])
    assert.equal(r.checks.itemsDropped, 1)
  })

  it('an "unclear" change needs a real previous quote and always uses fixed wording', () => {
    const ok = run([ch({ category: 'continuingBlockers', state: 'unclear', text: 'It was surely fixed.', currentQuote: '', previousQuote: 'Payment integration is blocked: vendor has not issued sandbox credentials' })])
    assert.equal(ok.items[0].state, 'unclear')
    assert.doesNotMatch(ok.items[0].text, /surely fixed/)
    const bad = run([ch({ category: 'continuingBlockers', state: 'unclear', previousQuote: 'A blocker the previous report never had' })])
    assert.deepEqual(bad.items, [])
  })

  it('drops invented changes: a "new" change whose quote is not in the update', () => {
    const r = run([ch({ currentQuote: 'The programme sponsor resigned yesterday' })])
    assert.deepEqual(r.items, [])
    assert.equal(r.checks.itemsDropped, 1)
  })

  it('drops a "new" change whose only support is the PREVIOUS report (that is not new)', () => {
    const r = run([ch({ currentQuote: 'Finished the login API' })])
    assert.deepEqual(r.items, [])
  })

  it('drops "changed" items that do not quote both reports', () => {
    assert.deepEqual(run([ch({ category: 'progress', state: 'changed', previousQuote: '' })]).items, [])
    assert.deepEqual(run([ch({ category: 'progress', state: 'changed', currentQuote: 'Dashboard is now 80% complete.', previousQuote: 'Made-up earlier sentence here' })]).items, [])
  })

  it('drops quotes that are too short to prove anything', () => {
    assert.deepEqual(run([ch({ currentQuote: 'Legal' })]).items, [])
  })

  it('drops unknown categories/states, impossible pairings, empty text and non-objects', () => {
    const r = run([ch({ category: 'gossip' }), ch({ state: 'maybe' }), ch({ category: 'newDevelopments', state: 'resolved' }), ch({ text: '   ' }), null, 'x', 5, []])
    assert.deepEqual(r.items, [])
    assert.equal(r.status, 'compared')
  })

  it('matching ignores case, spacing and typographic quotes', () => {
    const updates = 'The vendor said “we’ll   deliver” on Friday.'
    const r = run([ch({ currentQuote: "the vendor said \"we'll deliver\" on friday." })], updates)
    assert.equal(r.items.length, 1)
  })

  it('removes duplicate items and caps the list', () => {
    const dup = run([ch(), ch(), ch()])
    assert.equal(dup.items.length, 1)
    const many = Array.from({ length: 60 }, (_, i) => ch({ text: `Legal has requested review number ${i}.` }))
    assert.ok(run(many).items.length <= 20)
  })

  it('an empty list from the AI is a valid comparison with nothing established (not a failure)', () => {
    const r = run([])
    assert.equal(r.status, 'compared')
    assert.deepEqual(r.items, [])
  })

  it('is unavailable when the AI gave no usable list, or there is no previous report to check against', () => {
    for (const raw of [undefined, null, 'none', {}, 5]) assert.equal(run(raw).status, 'unavailable')
    assert.equal(validateComparison([ch()], { updates: UPDATE, previous: null }).status, 'unavailable')
  })

  it('only ever produces items that the stored-data validator accepts', () => {
    const r = run([ch(), ch({ category: 'executiveActions', state: 'unclear', previousQuote: 'Escalate the credentials request to the vendor account manager' })])
    const stored = { status: 'compared', baseline: { reportId: 'r1', periodStart: '2026-10-01', periodEnd: '2026-10-07' }, notes: [], items: r.items }
    assert.ok(validWhatsChanged(stored))
    assert.ok(CATEGORIES.length === 7 && STATES.length === 5)
  })
})

describe('the prompt', () => {
  it('describes the comparison rules, including "missing is not resolved", and only asks for it when a previous report is given', () => {
    for (const phrase of ['"Previous report" section is provided', 'NEVER mark something "resolved" because it is missing', 'unclear', 'VERBATIM', 'Do not invent history']) {
      assert.ok(SYSTEM_PROMPT.includes(phrase), phrase)
    }
  })

  it('shows the previous report in its own marked block, separate from the update', () => {
    const withPrev = buildPrompt({ updates: 'U-TEXT', previousReport: previous() })
    assert.match(withPrev, /Previous report \(for comparison only; reporting period 2026-10-01 to 2026-10-07\):\n~~~\n/)
    assert.ok(withPrev.indexOf('~~~') < withPrev.indexOf('Rough updates:'))
    assert.ok(withPrev.endsWith('"""\nU-TEXT\n"""'))
    assert.ok(!buildPrompt({ updates: 'U-TEXT' }).includes('Previous report'))
  })
})

describe('choosing the previous report (comparisonBaselineFor)', () => {
  const rep = (id, start, end, over = {}) => ({ id, projectId: 'p1', periodStart: start, periodEnd: end, savedAt: `2026-11-20T10:0${id.length}:00.000Z`, source: 'ai', content: content(), ...over })
  const target = (start, end, over = {}) => ({ projectId: 'p1', periodStart: start, periodEnd: end, ...over })
  const idOf = (b) => b.report?.id

  it('first report: no previous report', () => {
    const b = comparisonBaselineFor({ reports: [] }, target('2026-11-01', '2026-11-07'))
    assert.equal(b.status, 'none')
    assert.equal(b.report, null)
    assert.equal(NO_PREVIOUS, 'No previous report available for comparison.')
  })

  it('uses the previous report of the SAME project only', () => {
    const state = { reports: [rep('other', '2026-10-01', '2026-10-07', { projectId: 'p2' })] }
    assert.equal(comparisonBaselineFor(state, target('2026-11-01', '2026-11-07')).status, 'none')
    state.reports.push(rep('mine', '2026-10-01', '2026-10-07'))
    assert.equal(idOf(comparisonBaselineFor(state, target('2026-11-01', '2026-11-07'))), 'mine')
  })

  it('orders by reporting-period END, not by when the reports were saved', () => {
    const state = { reports: [
      rep('oct-late-save', '2026-10-01', '2026-10-07', { savedAt: '2026-11-25T10:00:00.000Z' }),
      rep('oct-mid', '2026-10-08', '2026-10-14', { savedAt: '2026-10-15T10:00:00.000Z' }),
    ] }
    assert.equal(idOf(comparisonBaselineFor(state, target('2026-10-15', '2026-10-21'))), 'oct-mid')
  })

  it('excludes demo reports and sample copies', () => {
    const state = { reports: [
      rep('demo', '2026-10-08', '2026-10-14', { demo: true, source: 'demo' }),
      rep('copy', '2026-10-08', '2026-10-14', { demo: true, sampleCopy: true, source: 'sample-copy' }),
      rep('real', '2026-10-01', '2026-10-07'),
    ] }
    assert.equal(idOf(comparisonBaselineFor(state, target('2026-10-15', '2026-10-21'))), 'real')
    assert.equal(comparisonBaselineFor({ reports: state.reports.slice(0, 2) }, target('2026-10-15', '2026-10-21')).status, 'none')
  })

  it('handles duplicate reporting periods: the most recent save represents the period, and a note says so', () => {
    const state = { reports: [
      rep('dup-a', '2026-10-01', '2026-10-07', { savedAt: '2026-10-08T09:00:00.000Z' }),
      rep('dup-b', '2026-10-01', '2026-10-07', { savedAt: '2026-10-09T09:00:00.000Z' }),
    ] }
    const b = comparisonBaselineFor(state, target('2026-10-08', '2026-10-14'))
    assert.equal(idOf(b), 'dup-b')
    assert.ok(b.notes.some((n) => /more than one report/i.test(n)))
  })

  it('handles overlapping periods with a note', () => {
    const state = { reports: [rep('prev', '2026-10-01', '2026-10-10')] }
    const b = comparisonBaselineFor(state, target('2026-10-08', '2026-10-14'))
    assert.equal(idOf(b), 'prev')
    assert.ok(b.notes.some((n) => /overlaps/i.test(n)))
  })

  it('handles backdated reports: compares with the report before it, never a later one, and says so', () => {
    const state = { reports: [rep('early', '2026-10-01', '2026-10-07'), rep('later', '2026-11-01', '2026-11-07')] }
    const b = comparisonBaselineFor(state, target('2026-10-08', '2026-10-14'))
    assert.equal(idOf(b), 'early')
    assert.ok(b.notes.some((n) => /later period already exists/i.test(n)))
  })

  it('never compares a report with itself, saved or not', () => {
    const only = rep('only', '2026-11-01', '2026-11-07')
    assert.equal(comparisonBaselineFor({ reports: [only] }, { id: 'only' }).status, 'none')
    assert.equal(comparisonBaselineFor({ reports: [only] }, target('2026-11-01', '2026-11-07')).status, 'none') // same period is not "earlier"
    const two = { reports: [rep('a', '2026-10-01', '2026-10-07'), only] }
    assert.equal(idOf(comparisonBaselineFor(two, { id: 'only' })), 'a')
  })

  it('is unavailable (not an invented answer) when the target has no usable period or project', () => {
    assert.equal(comparisonBaselineFor({ reports: [rep('a', '2026-10-01', '2026-10-07')] }, target('', '')).status, 'unavailable')
    assert.equal(comparisonBaselineFor({ reports: [] }, { periodEnd: '2026-11-07' }).status, 'unavailable')
  })

  it('does not modify any report or the state', () => {
    const state = { reports: [rep('a', '2026-10-01', '2026-10-07'), rep('b', '2026-10-08', '2026-10-14', { demo: true })] }
    const before = structuredClone(state)
    comparisonBaselineFor(state, target('2026-10-15', '2026-10-21'))
    assert.deepEqual(state, before)
  })
})

describe('API: What\'s Changed comes from the same single AI call', () => {
  const body = (over = {}) => validBody({ updates: UPDATE, previousReport: PREV, ...over })
  const go = async (changes, bodyOver = {}, env = {}) => {
    const srv = await startServer({ env: { ...(changes === undefined ? {} : { TEST_GENAI_CHANGES: typeof changes === 'string' ? changes : JSON.stringify(changes) }), ...env } })
    try {
      const res = await srv.request('/api/report', { method: 'POST', json: body(bodyOver) })
      return { res, requests: srv.requests.filter((r) => !r.blocked) }
    } finally {
      await srv.stop()
    }
  }

  it('first report (no previous report): says so, and does not ask the AI to compare anything', async () => {
    const { res, requests } = await go(undefined, { previousReport: undefined })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.whatsChanged, { status: 'none', items: [], checks: {} })
    assert.equal(requests.length, 1)
    assert.ok(!requests[0].prompt.includes('Previous report'))
  })

  it('with a previous report: ONE Gemini call returns the report, the assessment and verified changes', async () => {
    const { res, requests } = await go([ch()])
    assert.equal(res.status, 200)
    assert.equal(requests.length, 1)
    assert.equal(res.body.whatsChanged.status, 'compared')
    assert.equal(res.body.whatsChanged.items.length, 1)
    assert.ok(res.body.assessment && res.body.report.title)
    assert.equal('changes' in res.body.report, false)
    assert.equal('assessment' in res.body.report, false)
  })

  it('sends the previous report to the model as a separate block and leaves the update block intact', async () => {
    const { requests } = await go([ch()])
    const p = requests[0].prompt
    assert.match(p, /~~~\nExecutive Summary: Login is done[^\n]*\nCompleted Activities: Finished the login API/)
    assert.ok(p.includes(`Rough updates:\n"""\n${UPDATE}\n"""`))
  })

  it('removes invented changes', async () => {
    const { res } = await go([ch({ currentQuote: 'A made-up sentence that is nowhere in the update' }), ch()])
    assert.equal(res.body.whatsChanged.items.length, 1)
    assert.equal(res.body.whatsChanged.checks.itemsDropped, 1)
  })

  it('an omitted blocker claimed as resolved comes back as "unclear", not resolved', async () => {
    const { res } = await go([ch({ category: 'risks', state: 'resolved', text: 'Risk cleared.', currentQuote: '', previousQuote: 'Go-live may slip if credentials are late' })],
      { updates: 'Dashboard is now 80% complete and testing continues.' })
    const [item] = res.body.whatsChanged.items
    assert.equal(item.state, 'unclear')
    assert.doesNotMatch(item.text, /cleared|resolved/i)
  })

  it('the model cannot use the previous report to "prove" something is new in the update', async () => {
    const { res } = await go([ch({ currentQuote: 'Finished the login API' })])
    assert.deepEqual(res.body.whatsChanged.items, [])
  })

  it('comparison failure: if the AI leaves the changes out, the report still comes back and the comparison is "unavailable"', async () => {
    const { res, requests } = await go('omit')
    assert.equal(res.status, 200)
    assert.equal(requests.length, 1) // no retry call
    assert.equal(res.body.whatsChanged.status, 'unavailable')
    assert.deepEqual(res.body.whatsChanged.items, [])
    assert.equal(res.body.report.title, 'Stubbed – Status Report')
  })

  it('missing data: an unusable previous report is reported as unavailable and is never sent to the model', async () => {
    for (const previousReport of [{ periodEnd: 'nope', content: PREV_CONTENT }, { periodEnd: '2026-10-07', content: {} }, 'oops', 42, [], { periodEnd: '2026-10-07', content: { executiveSummary: 'x'.repeat(16000) } }]) {
      const { res, requests } = await go(undefined, { previousReport })
      assert.equal(res.status, 200)
      assert.equal(res.body.whatsChanged.status, 'unavailable')
      assert.ok(!requests[0].prompt.includes('Previous report'))
    }
  })

  it('asks for the changes in the answer only when there is a previous report', async () => {
    const { requests: a } = await go(undefined, { previousReport: undefined })
    const { requests: b } = await go([ch()])
    assert.ok(a[0].system.includes('"Previous report" section is provided')) // the rule is always present, conditional in wording
    assert.ok(b[0].prompt.includes('Previous report'))
  })
})
