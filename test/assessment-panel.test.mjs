import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { makeStorage } from './helpers/storage.mjs'
import { content } from './helpers/fixtures.mjs'
import { reportToText } from '../src/sections.js'
import { metaOf } from '../src/exporters.js'

// The AI health assessment is a collapsible section. These tests render the real component (src/Assessment.jsx) on
// the server with Vite, which is already a dev dependency, so no extra package is needed. Clicking is covered by the
// browser checks; here we check what the section shows when it first appears.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let vite, Panel

before(async () => {
  globalThis.localStorage = makeStorage() // the store module reads it when it loads
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } })
  Panel = (await vite.ssrLoadModule('/src/Assessment.jsx')).default
})
after(async () => {
  await vite?.close()
  delete globalThis.localStorage
})

const assessment = (outcome = 'Blocked', over = {}) => ({
  outcome,
  explanation: 'Payments cannot proceed until the vendor issues credentials.',
  evidence: [{ source: 'update', quote: 'Payment integration is blocked waiting on the vendor.' }],
  missingInformation: ['No date for the vendor response'],
  checks: { evidenceDropped: 0, downgradedFrom: null },
  ...over,
})
const html = (props) => renderToStaticMarkup(React.createElement(Panel, props))
const toggleOf = (h) => h.match(/<button[^>]*assessment-toggle[\s\S]*?<\/button>/)?.[0] ?? ''
const bodyTag = (h) => h.match(/<div id="[^"]*" class="assessment-body"[^>]*>/)?.[0] ?? ''
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('saved report: collapsed by default', () => {
  let h
  before(() => {
    h = html({ assessment: assessment('Blocked'), finalStatus: 'At Risk' }) // after the component has been loaded
  })

  it('has a compact header labelled "AI health assessment" with a disclosure button', () => {
    const t = toggleOf(h)
    assert.ok(t.includes('AI health assessment'))
    assert.match(t, /type="button"/)
    assert.match(t, /aria-expanded="false"/)
    assert.match(t, /aria-controls="[^"]+"/)
    assert.ok(t.includes('assessment-chevron') && t.includes('aria-hidden="true"'), 'a chevron that is hidden from screen readers')
  })

  it('is collapsed: the details are in a hidden region the button controls', () => {
    const id = toggleOf(h).match(/aria-controls="([^"]+)"/)[1]
    const tag = bodyTag(h)
    assert.ok(tag.includes(`id="${id}"`), 'aria-controls points at the details region')
    assert.match(tag, /hidden/)
    assert.doesNotMatch(h, /class="assessment open/)
  })

  it('shows the AI recommendation and the final assessment in the collapsed header', () => {
    const t = text(toggleOf(h))
    assert.match(t, /AI recommendation\s+\S*\s*Blocked/)
    assert.match(t, /Final assessment\s+\S*\s*At Risk/)
  })

  it('keeps the details available for people who open it', () => {
    const t = text(h)
    for (const s of ['Payments cannot proceed until the vendor issues credentials.', 'Payment integration is blocked waiting on the vendor.', 'Your update', 'Missing information or concerns', 'No date for the vendor response', 'Supporting evidence']) {
      assert.ok(t.includes(s), s)
    }
  })

  it('has a "Final assessment" entry inside the details too', () => {
    const body = h.slice(h.indexOf('assessment-body'))
    assert.match(text(body), /Final assessment\s+\S*\s*At Risk/)
  })

  it('uses the new wording and none of the old decision sentences', () => {
    const t = text(h)
    for (const old of ['The project manager chose', 'instead of the recommendation', 'confirmed the recommendation', 'The AI made no recommendation']) {
      assert.ok(!t.includes(old), old)
    }
  })
})

describe('recommendation and final assessment', () => {
  const header = (rec, final) => text(toggleOf(html({ assessment: assessment(rec), finalStatus: final })))

  it('differ: both are shown, each with its own label', () => {
    const t = header('Blocked', 'At Risk')
    assert.match(t, /AI recommendation\s+\S*\s*Blocked\s+Final assessment\s+\S*\s*At Risk/)
  })

  it('match: both show the same status', () => {
    const t = header('Blocked', 'Blocked')
    assert.match(t, /AI recommendation\s+\S*\s*Blocked\s+Final assessment\s+\S*\s*Blocked/)
  })

  it('the final assessment is the PM\'s status, never the AI\'s: "Blocked" is not shown as final when the PM chose On Track', () => {
    const h = html({ assessment: assessment('Blocked'), finalStatus: 'On Track' })
    const pair = text(toggleOf(h)).split('Final assessment')[1]
    assert.ok(pair.includes('On Track'))
    assert.ok(!pair.includes('Blocked'))
  })

  it('every pair of statuses displays correctly', () => {
    for (const rec of ['On Track', 'At Risk', 'Blocked', 'Off Track']) {
      for (const final of ['On Track', 'At Risk', 'Blocked', 'Off Track']) {
        const [recPart, finalPart] = header(rec, final).split('Final assessment')
        assert.ok(recPart.includes(rec), `${rec} / ${final}`)
        assert.ok(finalPart.includes(final), `${rec} / ${final}`)
      }
    }
  })

  it('"Insufficient Information" is shown as the AI\'s outcome (not a status) next to the PM\'s final status', () => {
    const t = header('Insufficient Information', 'At Risk')
    assert.match(t, /AI recommendation\s+Insufficient information · not a status\s+Final assessment\s+\S*\s*At Risk/)
  })

  it('a report with no recorded final status says so instead of guessing', () => {
    assert.match(header('Blocked', null), /Final assessment\s+Not finalised/)
    assert.match(header('Blocked', undefined), /Final assessment\s+Not finalised/)
  })
})

describe('without an assessment', () => {
  it('a saved report (older, demo, sample) shows nothing', () => {
    assert.equal(html({ assessment: null, finalStatus: 'At Risk' }), '')
    assert.equal(html({ assessment: undefined }), '')
  })
})

describe('draft beside a newly generated report', () => {
  const draft = (over = {}) => html({ assessment: assessment('Blocked'), currentStatus: 'On Track', chosenStatus: '', onUse: () => {}, ...over })

  it('is open by default, because the PM is deciding', () => {
    const h = draft()
    assert.match(toggleOf(h), /aria-expanded="true"/)
    assert.doesNotMatch(bodyTag(h), /hidden/)
    assert.match(h, /class="assessment open/)
  })

  it('still offers "Accept recommendation" and the PM-decision guidance', () => {
    const t = text(draft())
    assert.ok(t.includes('Accept recommendation (Blocked)'))
    assert.ok(t.includes('You have not finalised a status yet.'))
  })

  it('its header shows the status the PM has chosen so far as the final assessment, or "Not finalised"', () => {
    assert.match(text(toggleOf(draft())), /Final assessment\s+Not finalised/)
    assert.match(text(toggleOf(draft({ chosenStatus: 'At Risk' }))), /AI recommendation\s+\S*\s*Blocked\s+Final assessment\s+\S*\s*At Risk/)
  })

  it('explains an override and a confirmation as before', () => {
    assert.ok(text(draft({ chosenStatus: 'At Risk' })).includes('differs from the recommendation'))
    assert.ok(text(draft({ chosenStatus: 'Blocked' })).includes('selected the recommended status'))
  })

  it('with no assessment returned, tells the PM to choose a status themselves', () => {
    assert.ok(text(html({ assessment: null, onUse: () => {} })).includes('No health assessment was returned'))
  })
})

describe('nothing from the assessment reaches stakeholder exports', () => {
  it('copy / email / PDF text has neither the section title nor the final-assessment label', () => {
    const r = { id: 'r', source: 'ai', periodStart: '2026-11-01', periodEnd: '2026-11-07', savedAt: '2026-11-09T09:00:00.000Z', projectStatusAtReport: 'At Risk', assessment: assessment('Blocked') }
    const out = reportToText(content(), metaOf(r, { name: 'P' }))
    assert.match(out, /Project Health: At Risk/)
    for (const s of ['AI health assessment', 'Final assessment', 'AI recommendation', 'Recommendation only', 'Payments cannot proceed', 'Payment integration is blocked waiting']) {
      assert.ok(!out.includes(s), s)
    }
  })
})
