import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { makeStorage, loadStore, releaseStorage, readPersisted, KEY } from './helpers/storage.mjs'
import { projectInput, reportInput, content } from './helpers/fixtures.mjs'
import { statusHistoryFor } from '../src/history.js'

describe('project status history', () => {
  let storage, store, project
  const t0 = '2026-11-10T09:00:00.000Z'
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
  const state = () => readPersisted(storage)
  const history = (id = project.id) => state().statusHistory.filter((h) => h.projectId === id)
  const proj = (id = project.id) => state().projects.find((p) => p.id === id)
  const tick = (ms) => mock.timers.tick(ms)

  describe('recording changes', () => {
    it('starts empty: creating a project invents no status and no history', () => {
      assert.deepEqual(state().statusHistory, [])
      assert.equal(proj().status, null)
    })

    it('records previous status, new status, time, source and report for each change', () => {
      const e = store.actions.setProjectStatus(project.id, 'At Risk')
      assert.deepEqual(e, {
        id: e.id, projectId: project.id, previousStatus: null, previousStatusKnown: true,
        newStatus: 'At Risk', at: t0, source: 'manual', reportId: null,
      })
      assert.match(e.id, /^[0-9a-f-]{36}$/)
      assert.deepEqual(history(), [e])
    })

    it('chains: each entry\'s previous status is the one before, and the last equals the project\'s status', () => {
      const path = ['On Track', 'At Risk', 'Blocked', 'Off Track', 'At Risk', 'On Track']
      for (const s of path) {
        tick(1000)
        store.actions.setProjectStatus(project.id, s)
      }
      const h = history()
      assert.deepEqual(h.map((e) => e.newStatus), path)
      assert.deepEqual(h.map((e) => e.previousStatus), [null, ...path.slice(0, -1)])
      assert.equal(h.at(-1).newStatus, proj().status)
    })

    it('stamps each change with the time it happened', () => {
      store.actions.setProjectStatus(project.id, 'On Track')
      tick(90_000)
      store.actions.setProjectStatus(project.id, 'Blocked')
      assert.deepEqual(history().map((e) => e.at), [t0, '2026-11-10T09:01:30.000Z'])
    })

    it('records nothing when the status does not change, and does not rewrite when/how it was set', () => {
      store.actions.setProjectStatus(project.id, 'At Risk')
      const before = JSON.stringify(proj())
      const writes = storage.writes.length
      tick(60_000)
      assert.equal(store.actions.setProjectStatus(project.id, 'At Risk', { type: 'manual' }), null)
      assert.equal(history().length, 1)
      assert.equal(JSON.stringify(proj()), before)
      assert.equal(storage.writes.length, writes, 'no pointless write either')
    })

    it('records clearing a status as a change to "not set"', () => {
      store.actions.setProjectStatus(project.id, 'Blocked')
      store.actions.setProjectStatus(project.id, '')
      const last = history().at(-1)
      assert.deepEqual([last.previousStatus, last.newStatus], ['Blocked', null])
      assert.equal(proj().status, null)
      assert.equal(proj().statusSource, null)
    })

    it('keeps separate histories for separate projects', () => {
      const other = store.actions.createProject(projectInput({ name: 'Other' }))
      store.actions.setProjectStatus(project.id, 'Blocked')
      store.actions.setProjectStatus(other.id, 'On Track')
      assert.deepEqual(history().map((e) => e.newStatus), ['Blocked'])
      assert.deepEqual(history(other.id).map((e) => e.newStatus), ['On Track'])
    })

    it('does nothing for an unknown project', () => {
      assert.equal(store.actions.setProjectStatus('nope', 'Blocked'), null)
      assert.deepEqual(state().statusHistory, [])
    })

    it('rejects a status that is not one of the four', () => {
      assert.throws(() => store.actions.setProjectStatus(project.id, 'Fine'), /Unknown project status/)
      assert.deepEqual(state().statusHistory, [])
      assert.equal(proj().status, null)
    })
  })

  describe('sources: only a confirmed status is ever recorded', () => {
    it('records a manual PM update', () => {
      assert.equal(store.actions.setProjectStatus(project.id, 'At Risk', { type: 'manual' }).source, 'manual')
    })

    it('records a status set while saving a report, with that report\'s id', () => {
      const r = store.actions.addReport(reportInput(project.id))
      const e = store.actions.setProjectStatus(project.id, 'Blocked', { type: 'report', reportId: r.id })
      assert.equal(e.source, 'report')
      assert.equal(e.reportId, r.id)
    })

    it('requires a report source to name its report', () => {
      assert.throws(() => store.actions.setProjectStatus(project.id, 'Blocked', { type: 'report' }), /must name that report/)
      assert.equal(proj().status, null)
    })

    it('records a PM-CONFIRMED AI recommendation as such (the report it came from is kept)', () => {
      const r = store.actions.addReport(reportInput(project.id))
      const e = store.actions.setProjectStatus(project.id, 'At Risk', { type: 'ai-confirmed', reportId: r.id })
      assert.equal(e.source, 'ai-confirmed')
      assert.equal(e.reportId, r.id)
      assert.equal(proj().status, 'At Risk')
    })

    it('can NOT be changed by an AI recommendation on its own: it is not an accepted source', () => {
      for (const type of ['ai-recommended', 'ai', 'recommendation', 'system', 'assessment', undefined, '']) {
        assert.throws(() => store.actions.setProjectStatus(project.id, 'Blocked', { type }), /Unsupported status change source/, String(type))
      }
      assert.equal(proj().status, null, 'the status did not change')
      assert.deepEqual(state().statusHistory, [], 'and nothing was recorded')
    })

    it('rejects a missing source object', () => {
      assert.throws(() => store.actions.setProjectStatus(project.id, 'Blocked', null), /Unsupported status change source/)
    })
  })

  describe('links by id', () => {
    it('points the project at its latest history entry through statusSource.historyId', () => {
      const first = store.actions.setProjectStatus(project.id, 'On Track')
      assert.equal(proj().statusSource.historyId, first.id)
      const second = store.actions.setProjectStatus(project.id, 'Blocked')
      assert.equal(proj().statusSource.historyId, second.id)
      assert.equal(proj().statusSource.type, 'manual')
    })

    it('keeps the history entry even after the report it refers to is deleted (history is not rewritten)', () => {
      const r = store.actions.addReport(reportInput(project.id))
      const e = store.actions.setProjectStatus(project.id, 'Blocked', { type: 'report', reportId: r.id })
      store.actions.deleteReport(r.id)
      assert.equal(history().find((h) => h.id === e.id).reportId, r.id)
    })

    it('does not depend on array position: reordering the stored lists changes nothing', async () => {
      store.actions.setProjectStatus(project.id, 'On Track')
      tick(1000)
      store.actions.setProjectStatus(project.id, 'Blocked')
      tick(1000)
      store.actions.setProjectStatus(project.id, 'Off Track')
      const s = state()
      s.statusHistory.reverse()
      s.projects.reverse()
      storage.data.set(KEY, JSON.stringify(s))
      const reloaded = await loadStore(storage)
      reloaded.actions.deleteReport('__no-such-report__')
      const after = readPersisted(storage)
      assert.deepEqual(statusHistoryFor(after, project.id).map((h) => h.newStatus), ['On Track', 'Blocked', 'Off Track'])
      const p = after.projects.find((x) => x.id === project.id)
      assert.equal(after.statusHistory.find((h) => h.id === p.statusSource.historyId).newStatus, 'Off Track')
    })

    it('survives a page refresh', async () => {
      store.actions.setProjectStatus(project.id, 'At Risk')
      const before = state().statusHistory
      const reloaded = await loadStore(storage)
      reloaded.actions.deleteReport('__no-such-report__')
      assert.deepEqual(readPersisted(storage).statusHistory, before)
    })
  })

  describe('historical report status is never rewritten by later changes', () => {
    it('keeps a report\'s own status snapshot while the project\'s history moves on', () => {
      const r = store.actions.addReport(reportInput(project.id, { projectStatusAtReport: 'On Track' }))
      store.actions.setProjectStatus(project.id, 'On Track', { type: 'report', reportId: r.id })
      store.actions.setProjectStatus(project.id, 'Blocked')
      store.actions.setProjectStatus(project.id, 'Off Track')
      assert.equal(state().reports.find((x) => x.id === r.id).projectStatusAtReport, 'On Track')
      assert.equal(history().length, 3)
    })
  })

  describe('statusHistoryFor', () => {
    it('orders by time, then by the order recorded, and only for the requested project', () => {
      const other = store.actions.createProject(projectInput({ name: 'Other' }))
      store.actions.setProjectStatus(project.id, 'On Track')
      store.actions.setProjectStatus(other.id, 'Blocked')
      store.actions.setProjectStatus(project.id, 'At Risk') // same millisecond as the first
      tick(1000)
      store.actions.setProjectStatus(project.id, 'Blocked')
      assert.deepEqual(statusHistoryFor(state(), project.id).map((h) => h.newStatus), ['On Track', 'At Risk', 'Blocked'])
    })

    it('copes with a state that has no history at all', () => {
      assert.deepEqual(statusHistoryFor({ projects: [], reports: [] }, 'x'), [])
    })
  })

  describe('demo status history', () => {
    beforeEach(() => store.actions.loadDemo())
    const demoHistory = () => state().statusHistory.filter((h) => h.demo)

    it('gives every demo project a believable, fictional status history, flagged as demo', () => {
      const s = state()
      for (const p of s.projects.filter((x) => x.demo)) {
        const h = statusHistoryFor(s, p.id)
        assert.ok(h.length >= 1, p.name)
        assert.ok(h.every((e) => e.demo === true && e.previousStatusKnown === true))
      }
      assert.ok(demoHistory().length >= 10)
    })

    it('chains correctly and ends at each project\'s current status', () => {
      const s = state()
      for (const p of s.projects.filter((x) => x.demo)) {
        const h = statusHistoryFor(s, p.id)
        assert.equal(h[0].previousStatus, null, p.name)
        h.slice(1).forEach((e, i) => assert.equal(e.previousStatus, h[i].newStatus, `${p.name} step ${i + 1}`))
        assert.equal(h.at(-1).newStatus, p.status, p.name)
        assert.equal(s.statusHistory.find((e) => e.id === p.statusSource.historyId).newStatus, p.status)
      }
    })

    it('shows real status movement for some projects (not every project stayed the same)', () => {
      const s = state()
      assert.ok(s.projects.filter((p) => statusHistoryFor(s, p.id).length >= 2).length >= 3)
    })

    it('points only at demo reports and demo projects that exist', () => {
      const s = state()
      const reports = new Set(s.reports.map((r) => r.id))
      const projects = new Set(s.projects.map((p) => p.id))
      for (const e of demoHistory()) {
        assert.ok(projects.has(e.projectId))
        assert.ok(e.reportId === null || reports.has(e.reportId), e.id)
      }
    })

    it('does not duplicate entries when the demo is loaded again', () => {
      const n = state().statusHistory.length
      store.actions.loadDemo()
      assert.equal(state().statusHistory.length, n)
      assert.equal(new Set(state().statusHistory.map((e) => e.id)).size, n)
    })

    it('Reset Demo removes the demo history and keeps the user\'s own, untouched', () => {
      const mine = store.actions.createProject(projectInput({ name: 'Mine' }))
      store.actions.setProjectStatus(mine.id, 'Blocked')
      const myEntry = history(mine.id)[0]
      store.actions.resetDemo()
      assert.deepEqual(state().statusHistory, [myEntry])
    })

    it('a demo project kept because the user saved a report in it no longer points at removed demo history', () => {
      store.actions.addReport(reportInput('demo-p-04'))
      store.actions.resetDemo()
      const kept = proj('demo-p-04')
      assert.equal(kept.demo, false)
      assert.equal(kept.statusSource?.historyId, undefined)
      assert.equal(state().statusHistory.filter((h) => h.projectId === 'demo-p-04').length, 0)
    })

    it('does not attach demo history to a project that has become the user\'s own', () => {
      store.actions.addReport(reportInput('demo-p-04'))
      store.actions.resetDemo()
      store.actions.loadDemo()
      assert.equal(state().statusHistory.filter((h) => h.projectId === 'demo-p-04').length, 0)
    })
  })

  describe('saving a sample copy', () => {
    it('never changes a project\'s status or history', () => {
      store.actions.loadDemo()
      const before = JSON.stringify(state().statusHistory)
      store.actions.saveSampleCopy({ projectId: 'demo-p-02', content: content(), originalUpdate: 'x', periodStart: '2026-11-01', periodEnd: '2026-11-07', copiedFrom: 'demo-r-02-2', projectStatusAtReport: 'Blocked' })
      assert.equal(JSON.stringify(state().statusHistory), before)
    })
  })
})
