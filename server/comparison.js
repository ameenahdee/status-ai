// What Changed Since Last Report: checks what the AI said changed between the previous report and the update.
//
// The client sends the previous saved report for the same project (it chose it with the shared history rules);
// the server stores nothing. The AI proposes changes; this module only lets through changes it can back up:
//   * every change quotes the CURRENT update verbatim ("currentQuote") and/or the PREVIOUS report ("previousQuote")
//   * "resolved" needs BOTH: the previous item that was open, and the current text that says it is resolved
//   * something that is simply absent from the update is never "resolved": at most it becomes "unclear"
// Anything unsupported is dropped. If the AI's answer is unusable the comparison is reported as unavailable.

import { SECTIONS } from './prompt.js'
import { normalize } from './assessment.js'

export const CATEGORIES = ['newDevelopments', 'completedResolved', 'continuingBlockers', 'risks', 'progress', 'nextSteps', 'executiveActions']
export const STATES = ['new', 'continuing', 'resolved', 'changed', 'unclear']

// Which states make sense in which category.
const ALLOWED = {
  newDevelopments: ['new'],
  completedResolved: ['new', 'resolved'],
  continuingBlockers: ['continuing', 'unclear'],
  risks: ['new', 'changed', 'continuing', 'resolved', 'unclear'],
  progress: ['new', 'changed'],
  nextSteps: ['new', 'changed', 'continuing'],
  executiveActions: ['new', 'continuing', 'resolved', 'unclear'],
}
const CAN_BE_UNCLEAR = (c) => ALLOWED[c].includes('unclear')

export const NO_PREVIOUS = 'No previous report available for comparison.'
const MIN_QUOTE = 8
const MAX_ITEMS = 20
const MAX_TEXT = 400
const MAX_PREVIOUS_CHARS = 15000

const isStr = (v) => typeof v === 'string'
const isDay = (v) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
const clean = (s, max) => (isStr(s) ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/**
 * The previous report as sent by the client. Returns null unless it is well formed and small enough to be checked
 * in full (nothing is silently truncated). `items` is every sentence of the report, one per entry.
 */
export function validatePrevious(prev) {
  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return null
  if (!isDay(prev.periodEnd) || (prev.periodStart && !isDay(prev.periodStart))) return null
  const c = prev.content
  if (!c || typeof c !== 'object' || Array.isArray(c)) return null
  const items = []
  const lines = []
  for (const s of SECTIONS) {
    const v = c[s.key]
    const list = s.text ? (v == null ? [] : [v]) : v == null ? [] : v
    if (!Array.isArray(list) || !list.every(isStr)) return null
    for (const raw of list) {
      const t = raw.replace(/\s+/g, ' ').trim()
      if (!t) continue
      items.push(t)
      lines.push(`${s.label}: ${t}`)
    }
  }
  const promptText = lines.join('\n')
  if (!items.length || promptText.length > MAX_PREVIOUS_CHARS) return null
  return { periodStart: prev.periodStart || '', periodEnd: prev.periodEnd, items, promptText }
}

const quoteIn = (quote, haystacks) => {
  const q = normalize(quote)
  return q.length >= MIN_QUOTE && haystacks.some((h) => normalize(h).includes(q))
}

/**
 * `raw` is the AI's "changes" array. `ctx` = { updates, previous } where previous comes from validatePrevious.
 * Returns { status: 'compared' | 'unavailable', items, checks }.
 */
export function validateComparison(raw, { updates, previous }) {
  if (!previous) return { status: 'unavailable', items: [], checks: { reason: 'no-previous' } }
  if (!Array.isArray(raw)) return { status: 'unavailable', items: [], checks: { reason: 'invalid-response' } }

  const items = []
  let dropped = 0
  let downgraded = 0
  const seen = new Set()
  const unclear = (category, previousQuote) => ({
    category,
    state: 'unclear',
    // fixed wording: never a claim about what happened
    text: `Previously reported: "${previousQuote}". The current update does not confirm what has happened since.`,
    evidence: { current: null, previous: previousQuote },
  })

  for (const r of raw) {
    if (!r || typeof r !== 'object' || !CATEGORIES.includes(r.category) || !STATES.includes(r.state) || !ALLOWED[r.category].includes(r.state)) {
      dropped++
      continue
    }
    const text = clean(r.text, MAX_TEXT)
    const cq = clean(r.currentQuote, 500)
    const pq = clean(r.previousQuote, 500)
    const curOK = !!cq && quoteIn(cq, [updates])
    const prevOK = !!pq && quoteIn(pq, previous.items)
    let item = null

    if (r.state === 'new') {
      if (text && curOK) item = { category: r.category, state: 'new', text, evidence: { current: cq, previous: null } }
    } else if (r.state === 'changed') {
      if (text && curOK && prevOK) item = { category: r.category, state: 'changed', text, evidence: { current: cq, previous: pq } }
    } else if (r.state === 'continuing' || r.state === 'resolved') {
      if (prevOK && text && curOK) {
        item = { category: r.category, state: r.state, text, evidence: { current: cq, previous: pq } }
      } else if (prevOK && CAN_BE_UNCLEAR(r.category)) {
        // The previous item is real but the current update does not back the claim: absence is not resolution.
        item = unclear(r.category, pq)
        downgraded++
      }
    } else if (r.state === 'unclear') {
      if (prevOK) item = unclear(r.category, pq)
    }

    if (!item) {
      dropped++
      continue
    }
    const key = `${item.category}|${item.state}|${normalize(item.text)}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
    if (items.length >= MAX_ITEMS) break
  }
  return { status: 'compared', items, checks: { itemsDropped: dropped, itemsDowngraded: downgraded } }
}

export { MAX_PREVIOUS_CHARS }
