import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted } from './helpers/storage.mjs'
import { projectInput, reportInput } from './helpers/fixtures.mjs'

describe('projects', () => {
  let storage, store
  beforeEach(async () => {
    storage = makeStorage()
    store = await loadStore(storage)
  })
  afterEach(releaseStorage)

  const persisted = () => readPersisted(storage)

  describe('createProject', () => {
    it('stores the submitted details, trimmed, with a unique id and timestamps', () => {
      const p = store.actions.createProject(
        projectInput({ name: '  Alpha  ', description: '  Does things.  ', owner: ' Ann ', audience: ' Board ' }),
      )
      assert.equal(p.name, 'Alpha')
      assert.equal(p.description, 'Does things.')
      assert.equal(p.owner, 'Ann')
      assert.equal(p.audience, 'Board')
      assert.equal(p.startDate, '2026-10-01')
      assert.match(p.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      assert.ok(!Number.isNaN(Date.parse(p.createdAt)))
      assert.deepEqual(persisted().projects[0], p)
    })

    it('never invents a status: a new project has none, and no status source', () => {
      const p = store.actions.createProject(projectInput())
      assert.equal(p.status, null)
      assert.equal(p.statusSource, null)
    })

    it('is a normal (non-demo) project', () => {
      assert.notEqual(store.actions.createProject(projectInput()).demo, true)
    })

    it('gives every project its own id and puts the newest first', () => {
      const a = store.actions.createProject(projectInput({ name: 'A' }))
      const b = store.actions.createProject(projectInput({ name: 'B' }))
      assert.notEqual(a.id, b.id)
      assert.deepEqual(persisted().projects.map((p) => p.name), ['B', 'A'])
    })

    it('treats optional fields as empty strings', () => {
      const p = store.actions.createProject({ name: 'Only required', startDate: '2026-10-01', description: 'd' })
      assert.equal(p.owner, '')
      assert.equal(p.audience, '')
    })

    it('enforces the 500-character description limit', () => {
      const p = store.actions.createProject(projectInput({ description: 'x'.repeat(900) }))
      assert.equal(p.description.length, 500)
    })

    it('keeps a description of exactly 500 characters intact', () => {
      const p = store.actions.createProject(projectInput({ description: 'y'.repeat(500) }))
      assert.equal(p.description.length, 500)
    })
  })

  describe('updateProject', () => {
    it('changes the editable details and trims them', () => {
      const p = store.actions.createProject(projectInput())
      store.actions.updateProject(p.id, {
        name: '  Renamed ',
        startDate: '2026-09-15',
        description: ' New description ',
        owner: ' New Owner ',
        audience: ' Execs ',
      })
      const saved = persisted().projects[0]
      assert.equal(saved.name, 'Renamed')
      assert.equal(saved.startDate, '2026-09-15')
      assert.equal(saved.description, 'New description')
      assert.equal(saved.owner, 'New Owner')
      assert.equal(saved.audience, 'Execs')
    })

    it('preserves identity and history fields: id, createdAt, status and status source', () => {
      const p = store.actions.createProject(projectInput())
      store.actions.setProjectStatus(p.id, 'Blocked', { type: 'manual' })
      const before = persisted().projects[0]
      store.actions.updateProject(p.id, projectInput({ name: 'Renamed' }))
      const after = persisted().projects[0]
      assert.equal(after.id, p.id)
      assert.equal(after.createdAt, before.createdAt)
      assert.equal(after.status, 'Blocked')
      assert.deepEqual(after.statusSource, before.statusSource)
    })

    it('only changes the targeted project', () => {
      const a = store.actions.createProject(projectInput({ name: 'A' }))
      const b = store.actions.createProject(projectInput({ name: 'B' }))
      store.actions.updateProject(a.id, projectInput({ name: 'A2' }))
      const byId = Object.fromEntries(persisted().projects.map((p) => [p.id, p.name]))
      assert.equal(byId[a.id], 'A2')
      assert.equal(byId[b.id], 'B')
    })

    it('ignores an unknown project id', () => {
      const a = store.actions.createProject(projectInput())
      store.actions.updateProject('does-not-exist', projectInput({ name: 'Ghost' }))
      assert.equal(persisted().projects.length, 1)
      assert.equal(persisted().projects[0].name, a.name)
    })

    it('keeps existing reports associated with the project after it is edited', () => {
      const p = store.actions.createProject(projectInput())
      const r = store.actions.addReport(reportInput(p.id))
      store.actions.updateProject(p.id, projectInput({ name: 'Renamed' }))
      const s = persisted()
      assert.equal(s.reports.find((x) => x.id === r.id).projectId, p.id)
      assert.equal(store.reportsFor(s, p.id).length, 1)
    })

    it('enforces the 500-character description limit on edit, not only on create', () => {
      const p = store.actions.createProject(projectInput())
      store.actions.updateProject(p.id, projectInput({ description: 'z'.repeat(900) }))
      assert.equal(persisted().projects[0].description.length, 500)
    })

    it('keeps a description of exactly 500 characters intact on edit', () => {
      const p = store.actions.createProject(projectInput())
      store.actions.updateProject(p.id, projectInput({ description: 'y'.repeat(500) }))
      assert.equal(persisted().projects[0].description, 'y'.repeat(500))
    })

    it('trims first, then applies the limit, so padding never eats into the 500 characters', () => {
      const p = store.actions.createProject(projectInput())
      store.actions.updateProject(p.id, projectInput({ description: `   ${'q'.repeat(600)}   ` }))
      assert.equal(persisted().projects[0].description, 'q'.repeat(500))
    })

    it('applies exactly the same description rule on create and on edit', () => {
      const inputs = ['  short  ', 'a'.repeat(499), 'b'.repeat(500), 'c'.repeat(501), `  ${'d'.repeat(520)}  `, 'e'.repeat(5000)]
      for (const description of inputs) {
        const created = store.actions.createProject(projectInput({ description }))
        const target = store.actions.createProject(projectInput({ name: 'to edit' }))
        store.actions.updateProject(target.id, projectInput({ name: 'to edit', description }))
        const edited = persisted().projects.find((x) => x.id === target.id)
        assert.equal(edited.description, created.description, `input of ${description.length} characters`)
        assert.ok(edited.description.length <= 500)
      }
    })

    it('exports the limit so the form and the store cannot disagree', () => {
      assert.equal(store.DESCRIPTION_MAX, 500)
    })

    it('does not touch any other field when only the description needed capping', () => {
      const p = store.actions.createProject(projectInput({ owner: 'Ann', audience: 'Board' }))
      store.actions.updateProject(p.id, projectInput({ owner: 'Ann', audience: 'Board', description: 'x'.repeat(900) }))
      const saved = persisted().projects[0]
      assert.equal(saved.owner, 'Ann')
      assert.equal(saved.audience, 'Board')
      assert.equal(saved.name, 'Alpha Project')
    })
  })

  describe('project status', () => {
    it('offers exactly the four agreed statuses', () => {
      assert.deepEqual(store.STATUSES, ['On Track', 'At Risk', 'Blocked', 'Off Track'])
    })

    it('records a manual change with its source and time', () => {
      const p = store.actions.createProject(projectInput())
      store.actions.setProjectStatus(p.id, 'At Risk')
      const saved = persisted().projects[0]
      assert.equal(saved.status, 'At Risk')
      assert.equal(saved.statusSource.type, 'manual')
      assert.ok(!Number.isNaN(Date.parse(saved.statusSource.at)))
    })

    it('records which report a status came from', () => {
      const p = store.actions.createProject(projectInput())
      const r = store.actions.addReport(reportInput(p.id))
      store.actions.setProjectStatus(p.id, 'Off Track', { type: 'report', reportId: r.id })
      const src = persisted().projects[0].statusSource
      assert.equal(src.type, 'report')
      assert.equal(src.reportId, r.id)
    })

    it('can be cleared, leaving the project with no status and no source', () => {
      const p = store.actions.createProject(projectInput())
      store.actions.setProjectStatus(p.id, 'On Track')
      store.actions.setProjectStatus(p.id, '')
      const saved = persisted().projects[0]
      assert.equal(saved.status, null)
      assert.equal(saved.statusSource, null)
    })

    it('can move through all four statuses', () => {
      const p = store.actions.createProject(projectInput())
      for (const s of store.STATUSES) {
        store.actions.setProjectStatus(p.id, s)
        assert.equal(persisted().projects[0].status, s)
      }
    })

    it('changes only the targeted project and leaves its reports untouched', () => {
      const a = store.actions.createProject(projectInput({ name: 'A' }))
      const b = store.actions.createProject(projectInput({ name: 'B' }))
      const r = store.actions.addReport(reportInput(a.id, { projectStatusAtReport: 'On Track' }))
      store.actions.setProjectStatus(a.id, 'Blocked')
      const s = persisted()
      assert.equal(s.projects.find((p) => p.id === b.id).status, null)
      // the report keeps the status it was saved with, even though the project has since moved on
      assert.equal(s.reports.find((x) => x.id === r.id).projectStatusAtReport, 'On Track')
    })
  })
})
