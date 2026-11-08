import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { startServer, validBody } from './helpers/server.mjs'
import { makeStorage, loadStore, releaseStorage, readPersisted, KEY } from './helpers/storage.mjs'
import { projectInput, reportInput, content, v1Project, v1Report } from './helpers/fixtures.mjs'
import { PROMPT_VERSION, SYSTEM_PROMPT } from '../server/prompt.js'
import { cleanGeneration, validReportV2 } from '../src/schema.js'

// Newly generated reports record WHICH model and WHICH prompt version produced them. Nothing is ever guessed:
// older, demo and sample records carry null with a provenance that says why.

// Pinned so that the prompt cannot change without PROMPT_VERSION being bumped. If this fails you changed the
// prompt: bump PROMPT_VERSION in server/prompt.js, then update both values below.
const PINNED = {
  version: 'report-prompt-2026-11-08.1',
  sha256: '082d38ce382718edd6e9288c7c56125dcc757410bfaa593da90b2ae58a9d796b',
}

describe('prompt version', () => {
  it('is a non-empty string', () => {
    assert.equal(typeof PROMPT_VERSION, 'string')
    assert.ok(PROMPT_VERSION.length > 0)
  })

  it('is bumped whenever the system prompt changes', () => {
    const sha = createHash('sha256').update(SYSTEM_PROMPT).digest('hex')
    assert.equal(
      sha === PINNED.sha256,
      PROMPT_VERSION === PINNED.version,
      'SYSTEM_PROMPT and PROMPT_VERSION must change together: bump PROMPT_VERSION, then update PINNED in this test',
    )
  })
})

describe('API: generation metadata', () => {
  let srv
  before(async () => (srv = await startServer({ env: { GEMINI_MODEL: 'stub-model-1' } })))
  after(() => srv.stop())

  it('returns the model that was configured and the current prompt version', async () => {
    const res = await srv.request('/api/report', { method: 'POST', json: validBody() })
    assert.equal(res.status, 200)
    assert.equal(res.body.model, 'stub-model-1')
    assert.equal(res.body.promptVersion, PROMPT_VERSION)
  })

  it('still returns original, report and generatedAt unchanged', async () => {
    const res = await srv.request('/api/report', { method: 'POST', json: validBody({ updates: '  keep my spaces please  ' }) })
    assert.equal(res.body.original, '  keep my spaces please  ')
    assert.ok(res.body.report && res.body.generatedAt)
  })

  it('does not echo metadata on errors', async () => {
    const res = await srv.request('/api/report', { method: 'POST', json: validBody({ updates: 'x' }) })
    assert.equal(res.status, 400)
    assert.equal('model' in res.body, false)
    assert.equal('promptVersion' in res.body, false)
  })
})

describe('cleanGeneration', () => {
  it('keeps real strings and nulls everything else', () => {
    assert.deepEqual(cleanGeneration({ model: 'm', promptVersion: 'p' }), { model: 'm', promptVersion: 'p' })
    assert.deepEqual(cleanGeneration({ model: 'm' }), { model: 'm', promptVersion: null })
    assert.deepEqual(cleanGeneration({ model: '  ', promptVersion: 'p' }), { model: null, promptVersion: 'p' })
    assert.deepEqual(cleanGeneration({ model: 5, promptVersion: {} }), null)
    for (const v of [undefined, null, {}, 'x', 42, []]) assert.equal(cleanGeneration(v), null)
  })
})

describe('stored generation metadata', () => {
  let storage, store, project
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
    project = store.actions.createProject(projectInput())
  })
  afterEach(() => releaseStorage())
  const persisted = () => readPersisted(storage)

  it('a newly generated report stores model and promptVersion, marked recorded', () => {
    const r = store.actions.addReport(reportInput(project.id, { generation: { model: 'gemini-x', promptVersion: 'pv-1' } }))
    const saved = persisted().reports.find((x) => x.id === r.id)
    assert.deepEqual(saved.generation, { model: 'gemini-x', promptVersion: 'pv-1' })
    assert.equal(saved.provenance.generation, 'recorded')
    assert.ok(validReportV2(saved))
  })

  it('missing metadata is stored as null / unknown, never filled in', () => {
    for (const generation of [undefined, null, {}, { model: '', promptVersion: '' }]) {
      const r = store.actions.addReport(reportInput(project.id, { generation }))
      const saved = persisted().reports.find((x) => x.id === r.id)
      assert.equal(saved.generation, null)
      assert.equal(saved.provenance.generation, 'unknown')
    }
  })

  it('editing a report never changes its generation metadata', () => {
    const r = store.actions.addReport(reportInput(project.id, { generation: { model: 'm', promptVersion: 'p' } }))
    store.actions.updateReportContent(r.id, content({ title: 'Edited' }))
    const saved = persisted().reports.find((x) => x.id === r.id)
    assert.deepEqual(saved.generation, { model: 'm', promptVersion: 'p' })
    assert.equal(saved.provenance.generation, 'recorded')
  })

  it('the stored copy is independent of the object passed in', () => {
    const g = { model: 'm', promptVersion: 'p' }
    const r = store.actions.addReport(reportInput(project.id, { generation: g }))
    g.model = 'changed'
    store.actions.deleteReport('__no-such-report__') // forces a re-save
    assert.equal(persisted().reports.find((x) => x.id === r.id).generation.model, 'm')
  })

  it('a sample copy and demo reports carry null / not-applicable', () => {
    store.actions.loadDemo()
    for (const r of persisted().reports.filter((x) => x.demo)) {
      assert.equal(r.generation, null)
      assert.equal(r.provenance.generation, 'not-applicable')
    }
    const demoProject = persisted().projects.find((p) => p.demo)
    const copy = store.actions.saveSampleCopy({ projectId: demoProject.id, content: content(), originalUpdate: 'u', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 'sample' })
    assert.equal(copy.generation, null)
    assert.equal(copy.provenance.generation, 'not-applicable')
  })

  it('a record with an invalid generation value is rejected as malformed (not silently kept)', () => {
    const good = persisted().reports[0] ?? store.actions.addReport(reportInput(project.id))
    assert.equal(validReportV2({ ...good, generation: 'gemini' }), false)
    assert.equal(validReportV2({ ...good, generation: { model: 5 } }), false)
    assert.equal(validReportV2({ ...good, generation: null }), true)
  })

  it('an existing version-2 record without the field still loads, unchanged', async () => {
    const r = store.actions.addReport(reportInput(project.id, { generation: { model: 'm', promptVersion: 'p' } }))
    const data = persisted()
    const { generation: _generation, ...rest } = data.reports.find((x) => x.id === r.id)
    const { generation: _g, ...prov } = rest.provenance
    data.reports = [{ ...rest, provenance: prov }]
    const s2 = makeStorage({ [KEY]: JSON.stringify(data) })
    releaseStorage()
    const reloaded = await loadStore(s2)
    reloaded.actions.deleteReport('__no-such-report__')
    const back = readPersisted(s2).reports[0]
    assert.equal('generation' in back, false) // absent stays absent: not guessed
    assert.equal(back.id, r.id)
  })
})

describe('migrating version 1: generation metadata', () => {
  afterEach(() => releaseStorage())
  it('live reports get null / unknown; demo and sample copies get null / not-applicable', async () => {
    const data = {
      version: 1,
      projects: [v1Project({ id: 'p-old' })],
      reports: [
        v1Report({ id: 'live-unedited' }),
        v1Report({ id: 'live-edited', updatedAt: '2026-01-09T00:00:00.000Z' }),
        v1Report({ id: 'demo-one', demo: true, source: 'demo' }),
        v1Report({ id: 'copy-one', demo: true, sampleCopy: true, source: 'sample-copy' }),
      ],
    }
    const storage = makeStorage({ [KEY]: JSON.stringify(data) })
    const s = await loadStore(storage)
    s.actions.deleteReport('__no-such-report__')
    const by = Object.fromEntries(readPersisted(storage).reports.map((r) => [r.id, r]))
    for (const id of ['live-unedited', 'live-edited']) {
      assert.equal(by[id].generation, null, id)
      assert.equal(by[id].provenance.generation, 'unknown', id)
    }
    for (const id of ['demo-one', 'copy-one']) {
      assert.equal(by[id].generation, null, id)
      assert.equal(by[id].provenance.generation, 'not-applicable', id)
    }
  })
})
