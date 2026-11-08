import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput, content } from './helpers/fixtures.mjs'
import { copyReport, emailReport, metaOf } from '../src/exporters.js'
import { reportToText, healthMovementText, whatsChangedView, stakeholderChanges } from '../src/sections.js'
import { computeHealthMovement, validWhatsChanged, cleanWhatsChanged, STATUSES, INSUFFICIENT } from '../src/schema.js'

// Project health movement in "What Changed Since Last Report": the PM-finalised status of the previous report against
// the PM-finalised status of this one. Worked out by the app. An AI recommendation is never used as either status.

const item = { category: 'newDevelopments', state: 'new', text: 'Legal has requested a review.', evidence: { current: 'Legal has requested a review.', previous: null } }
const compared = (over = {}) => ({
  status: 'compared',
  baseline: { reportId: 'r-prev', periodStart: '2026-10-01', periodEnd: '2026-10-07' },
  notes: [],
  items: [item],
  ...over,
})
const withMove = (previous, current) => compared({ healthMovement: computeHealthMovement(previous, current) })
const live = (wc) => ({
  id: 'r1', projectId: 'p1', source: 'ai', periodStart: '2026-11-01', periodEnd: '2026-11-07', savedAt: '2026-11-09T09:00:00.000Z',
  projectStatusAtReport: 'Blocked', whatsChanged: wc,
})
const textOf = (wc) => reportToText(content(), metaOf(live(wc), { name: 'P' }))

describe('computeHealthMovement', () => {
  it('moved: both statuses known and different', () => {
    assert.deepEqual(computeHealthMovement('On Track', 'Blocked'), { previous: 'On Track', current: 'Blocked', change: 'moved' })
  })

  it('unchanged: both known and the same', () => {
    for (const s of STATUSES) assert.deepEqual(computeHealthMovement(s, s), { previous: s, current: s, change: 'unchanged' })
  })

  it('every pair of different statuses is a move, in both directions', () => {
    for (const a of STATUSES) for (const b of STATUSES) if (a !== b) assert.equal(computeHealthMovement(a, b).change, 'moved')
  })

  it('previous-not-recorded when the previous report has no finalised status', () => {
    for (const prev of [null, undefined, '', 'Not set', INSUFFICIENT, 'Green', 'on track', 5, {}]) {
      assert.deepEqual(computeHealthMovement(prev, 'At Risk'), { previous: null, current: 'At Risk', change: 'previous-not-recorded' })
    }
  })

  it('current-not-set until the PM has finalised this report\'s status; "Insufficient Information" never counts', () => {
    for (const cur of [null, undefined, '', INSUFFICIENT, 'Not set', 'Green']) {
      assert.deepEqual(computeHealthMovement('On Track', cur), { previous: 'On Track', current: null, change: 'current-not-set' })
    }
  })
})

describe('the wording', () => {
  it('is fixed, plain, and built from the two statuses only', () => {
    assert.equal(healthMovementText(computeHealthMovement('At Risk', 'Blocked')), 'Project Health moved from At Risk to Blocked.')
    assert.equal(healthMovementText(computeHealthMovement('On Track', 'On Track')), 'Project Health is unchanged: On Track.')
    assert.equal(healthMovementText(computeHealthMovement(null, 'Off Track')), "Project Health is Off Track. The previous report's status was not recorded.")
  })

  it('says nothing until this report\'s status is finalised, or without data', () => {
    assert.equal(healthMovementText(computeHealthMovement('On Track', null)), null)
    assert.equal(healthMovementText(null), null)
    assert.equal(healthMovementText(undefined), null)
  })
})

describe('in the section (view, copy, email, PDF)', () => {
  it('is the first group, "Project health", ahead of the categories, and cannot be removed', () => {
    const v = whatsChangedView(stakeholderChanges(withMove('At Risk', 'Blocked')))
    assert.deepEqual(v.groups.map((g) => g.key), ['projectHealth', 'newDevelopments'])
    assert.equal(v.groups[0].label, 'Project health')
    assert.equal(v.groups[0].items[0].fixed, true)
  })

  it('appears in copied / emailed text under the section heading, as a plain line', () => {
    const text = textOf(withMove('At Risk', 'Blocked'))
    const section = text.split('What Changed Since Last Report')[1]
    assert.match(section, /Project health\n- Project Health moved from At Risk to Blocked\./)
    assert.ok(section.indexOf('Project health') < section.indexOf('New developments'))
    assert.ok(text.includes('Project Health: Blocked')) // the existing header line is unchanged
  })

  it('"unchanged" and "previous not recorded" read correctly', () => {
    assert.match(textOf(withMove('Blocked', 'Blocked')), /- Project Health is unchanged: Blocked\./)
    assert.match(textOf(withMove(null, 'Blocked')), /- Project Health is Blocked\. The previous report's status was not recorded\./)
  })

  it('is left out when this report\'s status is not finalised, or when there is nothing to compare with', () => {
    assert.ok(!textOf(withMove('On Track', null)).includes('Project health'))
    assert.ok(!textOf(compared()).includes('Project health')) // no movement computed
    for (const wc of [{ status: 'none', baseline: null, notes: [], items: [] }, { status: 'unavailable', baseline: null, notes: [], items: [] }]) {
      assert.ok(!textOf(wc).includes('Project health'))
    }
  })

  it('still shows "No changes could be established" next to the health line when nothing else changed', () => {
    const text = textOf({ ...withMove('On Track', 'On Track'), items: [] })
    assert.match(text, /No changes could be established from the submitted update\./)
    assert.match(text, /- Project Health is unchanged: On Track\./)
  })

  it('is not exported for demo reports or sample copies', () => {
    const r = { ...live(withMove('On Track', 'Blocked')), demo: true, source: 'demo' }
    assert.ok(!reportToText(content(), metaOf(r, { name: 'P' })).includes('Project health'))
  })

  describe('email, copy and PDF', () => {
  describe('email and copy', () => {
    let assigned
    beforeEach(() => {
      assigned = []
      globalThis.window = { location: { set href(v) { assigned.push(v) }, get href() { return 'http://localhost/' } } }
    })
    afterEach(() => delete globalThis.window)

    it('email draft has the line', () => {
      emailReport(content(), metaOf(live(withMove('At Risk', 'Blocked')), { name: 'P' }))
      assert.ok(new URL(assigned[0]).searchParams.get('body').includes('- Project Health moved from At Risk to Blocked.'))
    })

    it('copy has the line', async () => {
      const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
      let copied = ''
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (t) => { copied = t } } } })
      try {
        await copyReport(content(), metaOf(live(withMove('At Risk', 'Blocked')), { name: 'P' }))
      } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original)
        else delete globalThis.navigator
      }
      assert.ok(copied.includes('- Project Health moved from At Risk to Blocked.'))
    })

  })

    describe('PDF', () => {
      let dir, cwd
      beforeEach(() => {
        cwd = process.cwd()
        dir = mkdtempSync(path.join(tmpdir(), 'status-ai-pdf-'))
        process.chdir(dir)
      })
      afterEach(() => {
        process.chdir(cwd)
        rmSync(dir, { recursive: true, force: true })
      })

      it('has the line, without a stray label prefix', async () => {
        const { downloadPdf } = await import('../src/pdf.js')
        downloadPdf(content({ title: 'Weekly Status Report' }), metaOf(live(withMove('At Risk', 'Blocked')), { name: 'Alpha Project' }))
        const t = readFileSync(path.join(dir, readdirSync(dir)[0]), 'latin1')
        assert.ok(t.includes('Project Health moved from At Risk to Blocked.'))
        assert.ok(!t.includes(': Project Health moved'))
      })
    })
  })
})

describe('in stored data', () => {
  let storage, store, project
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
  })
  afterEach(() => releaseStorage())
  const persisted = () => readPersisted(storage)
  const saved = (id) => persisted().reports.find((r) => r.id === id)
  const ASSESSMENT = (outcome) => ({ outcome, explanation: 'Because.', evidence: [{ source: 'update', quote: 'some quote here' }], missingInformation: [] })
  const first = (status, over = {}) => store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-01', periodEnd: '2026-10-07', projectStatusAtReport: status, ...over }))
  const second = (status, baselineId, over = {}) =>
    store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14', projectStatusAtReport: status,
      whatsChanged: compared({ baseline: { reportId: baselineId, periodStart: '2026-10-01', periodEnd: '2026-10-07' } }), generatedWhatsChanged: compared(), ...over }))

  it('is computed from the previous report\'s finalised status and the status finalised now', () => {
    const a = first('On Track')
    const b = second('Blocked', a.id)
    assert.deepEqual(saved(b.id).whatsChanged.healthMovement, { previous: 'On Track', current: 'Blocked', change: 'moved' })
    const c = second('On Track', a.id)
    assert.equal(saved(c.id).whatsChanged.healthMovement.change, 'unchanged')
  })

  it('never uses an AI recommendation: the PM-finalised statuses decide, even when the AI disagreed', () => {
    const a = first('On Track', { assessment: ASSESSMENT('Off Track') }) // the AI recommended Off Track, the PM chose On Track
    const b = second('On Track', a.id, { assessment: ASSESSMENT('Blocked') })
    const m = saved(b.id).whatsChanged.healthMovement
    assert.deepEqual(m, { previous: 'On Track', current: 'On Track', change: 'unchanged' })
    assert.doesNotMatch(textOf(saved(b.id)), /Off Track|Blocked/)
  })

  it('keeps the AI recommendation separate from the movement', () => {
    const a = first('At Risk')
    const b = second('At Risk', a.id, { assessment: ASSESSMENT('Blocked') })
    assert.equal(saved(b.id).assessment.outcome, 'Blocked')
    assert.equal(saved(b.id).whatsChanged.healthMovement.current, 'At Risk')
  })

  it('says "previous not recorded" when the previous report is gone or had no finalised status', () => {
    const a = first('At Risk')
    store.actions.deleteReport(a.id)
    assert.equal(saved(second('Blocked', a.id).id).whatsChanged.healthMovement.change, 'previous-not-recorded')
    assert.equal(saved(second('Blocked', 'never-existed').id).whatsChanged.healthMovement.previous, null)
  })

  it('ignores a movement sent by the caller: the store works it out itself', () => {
    const a = first('On Track')
    const forged = compared({ baseline: { reportId: a.id, periodStart: '2026-10-01', periodEnd: '2026-10-07' }, healthMovement: { previous: 'Off Track', current: 'On Track', change: 'moved' } })
    const b = store.actions.addReport(reportInput(project.id, { periodStart: '2026-10-08', periodEnd: '2026-10-14', projectStatusAtReport: 'Blocked', whatsChanged: forged }))
    assert.deepEqual(saved(b.id).whatsChanged.healthMovement, { previous: 'On Track', current: 'Blocked', change: 'moved' })
  })

  it('is not part of the AI original (generatedWhatsChanged)', () => {
    const a = first('On Track')
    const b = second('Blocked', a.id, { generatedWhatsChanged: compared({ healthMovement: computeHealthMovement('On Track', 'Blocked') }) })
    assert.equal('healthMovement' in saved(b.id).generatedWhatsChanged, false)
  })

  it('only exists for a real comparison, never for "none" or "unavailable"', () => {
    for (const status of ['none', 'unavailable']) {
      const wc = { status, baseline: null, notes: [], items: [] }
      const r = store.actions.addReport(reportInput(project.id, { whatsChanged: wc, generatedWhatsChanged: wc }))
      assert.equal(saved(r.id).whatsChanged.healthMovement, undefined)
    }
  })

  it('does not change the previous report or the project\'s status', () => {
    const a = first('On Track')
    store.actions.setProjectStatus(project.id, 'On Track')
    const before = structuredClone({ prev: saved(a.id), project: persisted().projects[0], history: persisted().statusHistory })
    second('Blocked', a.id)
    assert.deepEqual(saved(a.id), before.prev)
    assert.deepEqual(persisted().projects[0], before.project)
    assert.deepEqual(persisted().statusHistory, before.history)
  })

  it('survives a reload, and the exported text uses it', async () => {
    const a = first('At Risk')
    const b = second('Off Track', a.id)
    releaseStorage()
    const reloaded = await loadStore(storage)
    reloaded.actions.deleteReport('__no-such-report__')
    assert.equal(storage.data.has('statusai.v1.set-aside'), false)
    assert.deepEqual(saved(b.id).whatsChanged.healthMovement, { previous: 'At Risk', current: 'Off Track', change: 'moved' })
    assert.match(textOf(saved(b.id)), /- Project Health moved from At Risk to Off Track\./)
  })

  const textOf = (r) => reportToText(content(), metaOf(r, { name: 'P' }))
})

describe('validation of stored movement', () => {
  it('accepts well-formed movement on a comparison and rejects anything else', () => {
    assert.ok(validWhatsChanged(withMove('On Track', 'Blocked')))
    for (const bad of [
      { ...compared(), healthMovement: { previous: 'Green', current: 'Blocked', change: 'moved' } },
      { ...compared(), healthMovement: { previous: 'On Track', current: INSUFFICIENT, change: 'moved' } },
      { ...compared(), healthMovement: { previous: 'On Track', current: 'Blocked', change: 'improved' } },
      { ...compared(), healthMovement: 'moved' },
      { status: 'none', baseline: null, notes: [], items: [], healthMovement: computeHealthMovement('On Track', 'Blocked') },
    ]) {
      assert.equal(validWhatsChanged(bad), false, JSON.stringify(bad.healthMovement))
      assert.equal(cleanWhatsChanged(bad), null)
    }
  })

  it('a stored comparison without movement (earlier reports) is still valid', () => {
    assert.ok(validWhatsChanged(compared()))
  })
})
