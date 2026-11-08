import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Guards for the permanent responsive-design requirement (README, "Responsive design requirement"). They read the
// stylesheet, so they catch someone undoing the responsive rules; the real check is `npm run check:responsive`,
// which opens the built app in a browser at phone, tablet, laptop and desktop sizes.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(path.join(root, 'src/index.css'), 'utf8')
const block = css.slice(css.indexOf('/* ---------- Overview dashboard'))
const rule = (selector) => {
  const m = block.match(new RegExp('(?:^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'))
  return m ? m[1] : ''
}

describe('responsive guards: the Overview dashboard stylesheet', () => {
  it('lays out by the width of its own container, not only the screen', () => {
    assert.match(rule('.dash'), /container:dash \/ inline-size/)
    assert.match(rule('.health'), /container:health \/ inline-size/)
    assert.match(rule('.recent'), /container:recent \/ inline-size/)
    assert.ok(block.includes('@container dash'))
    assert.ok(block.includes('@container health'))
    assert.ok(block.includes('@container recent'))
  })

  it('keeps the header actions together on one row, at the far right, with the heading taking the free space', () => {
    assert.match(rule('.dash-head'), /display:flex/)
    assert.doesNotMatch(rule('.dash-head'), /flex-wrap:wrap/)
    assert.match(rule('.dash-head>div:first-child'), /flex:1 1 0/)
    assert.match(rule('.dash-head>div:first-child'), /min-width:0/)
    assert.match(rule('.dash-actions'), /flex:none/)
    assert.match(rule('.dash-actions'), /flex-wrap:nowrap/)
    assert.match(rule('.dash-actions'), /margin-left:auto/)
  })

  it('only stacks the header in a genuinely narrow container', () => {
    const stack = block.match(/@container dash \(max-width:(\d+)px\)\{\s*\.dash-head\{flex-direction:column/)
    assert.ok(stack, 'a narrow-container rule stacks the header')
    assert.ok(Number(stack[1]) <= 600, 'and only below about 600px')
  })

  it('never wraps a Project Health label, and keeps values aligned', () => {
    assert.match(rule('.legend li'), /white-space:nowrap/)
    assert.match(rule('.legend-val'), /text-align:right/)
    assert.match(rule('.legend-val'), /tabular-nums/)
  })

  it('shrinks the donut with its card and stacks it only when the card is too narrow', () => {
    assert.match(block, /--dn:clamp\(120px,calc\(100cqw - 224px\),190px\)/)
    assert.match(rule('.donut'), /width:var\(--dn\)/)
    assert.match(block, /@container health \(min-width:344px\)\{[^}]*\.health-body\{[^}]*flex-direction:row/)
    assert.match(rule('.health-body'), /flex-direction:column/) // the default (narrow) arrangement is stacked
  })

  it('lets the donut grow only into spare height, so it can never make the shared card row taller', () => {
    // side by side with Recent Reports: the chart area keeps its old content height as a minimum, and the donut grows to 238px
    assert.match(block, /@container dash \(min-width:740px\)\{\s*@container health \(min-width:344px\)\{/)
    assert.match(block, /\.health-body\{container:hb \/ size;min-height:max\(clamp\(120px,calc\(100cqw - 224px\),190px\),calc\(var\(--rows,5\) \* 23\.25px \+ \(var\(--rows,5\) - 1\) \* 12px\)\)\}/)
    assert.match(block, /--dn:clamp\(120px,min\(100cqh,calc\(100cqw - 200px\)\),238px\)/)
    // the number of legend rows is supplied by the markup, and the legend rows have a fixed line height
    assert.match(readFileSync(path.join(root, 'src/Overview.jsx'), 'utf8'), /style=\{\{ '--rows': segments\.length \}\}/)
    // outside that layout (single column, narrow card, phones, tablets) the donut keeps its previous maximum
    assert.match(block, /@container health \(min-width:344px\)\{[^@]*--dn:clamp\(120px,calc\(100cqw - 224px\),190px\)/)
    assert.match(rule('.donut'), /--dn:min\(190px,100cqw\)/)
  })

  it('keeps the legend centred with the donut', () => {
    assert.match(rule('.health-body'), /align-items:center/)
    assert.match(rule('.health-body'), /justify-content:center/)
  })

  it('arranges the summary cards by available width, always four across once there is room', () => {
    assert.match(block, /@container dash \(min-width:840px\)\{[^}]*repeat\(4/)
    assert.match(block, /@container dash \(min-width:600px\) and \(max-width:839px\)\{[^}]*repeat\(4/)
    assert.match(block, /@container dash \(max-width:419px\)\{[^}]*flex-direction:column/)
  })

  it('lets report rows adapt to their card, with a two-line title on narrow cards and no overlap', () => {
    assert.match(rule('.rr-main strong'), /-webkit-line-clamp:2/)
    assert.match(block, /@container recent \(min-width:380px\)/)
    assert.match(block, /@container recent \(min-width:560px\)/)
    assert.match(rule('.rr-date'), /white-space:nowrap/)
    assert.match(rule('.pill'), /white-space:nowrap/)
  })

  it('draws the activity timeline per item so wrapped text cannot break it', () => {
    assert.match(block, /\.act li::before/)
    assert.match(block, /\.act li::after/)
    assert.doesNotMatch(block, /\.act::before/)
  })

  it('keeps the phone menu from taking over the screen', () => {
    assert.match(css, /\.side\{position:fixed;[^}]*width:min\(80vw,272px\)/)
  })

  it('does not bring back the rejected stretched layout', () => {
    assert.match(css, /\.main\{width:100%;min-width:0;max-width:1280px;margin:0 auto/)
    assert.doesNotMatch(css, /\.main\.wide/)
  })
})

describe('responsive guards: the checking tool is in place', () => {
  it('has the responsive check script and an npm command for it', () => {
    assert.ok(existsSync(path.join(root, 'scripts/responsive-check.mjs')))
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['check:responsive'], 'node scripts/responsive-check.mjs')
  })

  it('covers the required screen sizes, including the laptop and 90% zoom cases', () => {
    const script = readFileSync(path.join(root, 'scripts/responsive-check.mjs'), 'utf8')
    for (const size of ['375, 667', '390, 844', '768, 1024', '1024, 768', '1280, 650', '1366, 657', '1422, 722', '1440, 900', '1536, 1024', '1920, 1080']) {
      assert.ok(script.includes(size), size)
    }
  })

  it('documents the permanent requirement', () => {
    for (const f of ['README.md', 'STATUS_AI_HANDOVER.md']) {
      const text = readFileSync(path.join(root, f), 'utf8')
      assert.match(text, /Responsive design requirement/i, f)
      assert.ok(text.includes('check:responsive'), f)
    }
  })
})
