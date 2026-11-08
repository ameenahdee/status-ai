// Builds the web logo files in public/ from the ORIGINAL Status AI logo sheet (design/status-ai-logo-sheet.png).
//
// Nothing is redrawn, recoloured or substituted: every file is a crop of the supplied artwork.
//   * the sheet is an RGBA PNG whose background is (almost) transparent; its faint background haze is cleared
//   * public/logo-on-light.png   the full-colour logo (dark wordmark) cropped from the top of the sheet
//   * public/logo-on-dark.png    the white lockup cropped from the sheet's plum tile, with the tile's flat plum
//                                background made transparent so it sits directly on the sidebar. Only the
//                                background is removed; the pixels of the mark and the wordmark keep their colours.
//   * public/favicon.png         the plum app icon from the sheet, scaled down
//
// Run:  node scripts/build-logo-assets.mjs        (Node built-ins only, no packages)
import { readFileSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHEET = path.join(root, 'design/status-ai-logo-sheet.png')

// ---------- tiny PNG reader / writer ----------
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function decodeRGBA(file) {
  const b = readFileSync(file)
  let p = 8
  let w, h
  const idat = []
  while (p < b.length) {
    const len = b.readUInt32BE(p)
    const type = b.toString('latin1', p + 4, p + 8)
    const d = b.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = d.readUInt32BE(0)
      h = d.readUInt32BE(4)
      if (d[8] !== 8 || d[9] !== 6 || d[12] !== 0) throw new Error('expected an 8-bit, non-interlaced RGBA PNG')
    }
    if (type === 'IDAT') idat.push(d)
    p += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * 4
  const out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0
      const up = y > 0 ? out[(y - 1) * stride + x] : 0
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0
      let v = raw[y * (stride + 1) + 1 + x]
      if (f === 1) v += a
      else if (f === 2) v += up
      else if (f === 3) v += (a + up) >> 1
      else if (f === 4) {
        const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c
      }
      out[y * stride + x] = v & 0xff
    }
  }
  return { w, h, data: out }
}
function encodeRGBA(img, file) {
  const stride = img.w * 4
  const raw = Buffer.alloc(img.h * (stride + 1))
  for (let y = 0; y < img.h; y++) img.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.w, 0)
  ihdr.writeUInt32BE(img.h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]))
}

// ---------- helpers ----------
const sheet = decodeRGBA(SHEET)
const px = (x, y) => (y * sheet.w + x) * 4

// the sheet's background is ~1% opaque haze with noisy colour: clear it, keep real artwork (alpha ~ 98-99%) intact
function cleanAlpha(a) {
  const v = (a - 10) / (248 - 10)
  return Math.round(Math.max(0, Math.min(1, v)) * 255)
}

// bounding box of artwork (alpha > 128) inside a search window
function bbox(x0, y0, x1, y1) {
  let minX = x1, minY = y1, maxX = x0, maxY = y0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (sheet.data[px(x, y) + 3] > 128) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function crop(box, pad = 0) {
  const x0 = Math.max(0, box.x - pad), y0 = Math.max(0, box.y - pad)
  const w = Math.min(sheet.w - x0, box.w + 2 * pad), h = Math.min(sheet.h - y0, box.h + 2 * pad)
  const out = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = px(x0 + x, y0 + y)
      const o = (y * w + x) * 4
      const a = cleanAlpha(sheet.data[i + 3])
      if (a === 0) continue
      out[o] = sheet.data[i]
      out[o + 1] = sheet.data[i + 1]
      out[o + 2] = sheet.data[i + 2]
      out[o + 3] = a
    }
  }
  return { w, h, data: out }
}

// area-average downscale on premultiplied colour (keeps edges clean)
function scaleTo(img, newW) {
  const newH = Math.max(1, Math.round((img.h * newW) / img.w))
  const out = Buffer.alloc(newW * newH * 4)
  const sx = img.w / newW, sy = img.h / newH
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0
      for (let yy = Math.floor(y * sy); yy < Math.min(img.h, Math.ceil((y + 1) * sy)); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.min(img.w, Math.ceil((x + 1) * sx)); xx++) {
          const i = (yy * img.w + xx) * 4
          const al = img.data[i + 3] / 255
          r += img.data[i] * al
          g += img.data[i + 1] * al
          b += img.data[i + 2] * al
          a += al
          n++
        }
      }
      const o = (y * newW + x) * 4
      if (a > 0) {
        out[o] = Math.round(r / a)
        out[o + 1] = Math.round(g / a)
        out[o + 2] = Math.round(b / a)
      }
      out[o + 3] = Math.round((a / n) * 255)
    }
  }
  return { w: newW, h: newH, data: out }
}

// ---------- 1. full-colour logo for light backgrounds ----------
const top = bbox(200, 120, 1340, 520)
const onLight = scaleTo(crop(top, 6), 640)
encodeRGBA(onLight, path.join(root, 'public/logo-on-light.png'))

// ---------- 2. white lockup for dark backgrounds (the sheet's plum tile, background made transparent) ----------
const tile = bbox(20, 660, 800, 980)
const margin = 36 // stay clear of the tile's rounded corners
const inner = { x0: tile.x + margin, y0: tile.y + margin, x1: tile.x + tile.w - margin, y1: tile.y + tile.h - margin }
const colAt = (x, y) => [sheet.data[px(x, y)], sheet.data[px(x, y) + 1], sheet.data[px(x, y) + 2]]
const meanOf = (xa, xb) => {
  const s = [0, 0, 0]
  let n = 0
  for (let y = inner.y0; y < inner.y1; y += 4) for (let x = xa; x < xb; x += 4) { const c = colAt(x, y); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++ }
  return s.map((v) => v / n)
}
const bgLeft = meanOf(inner.x0, inner.x0 + 40)
const bgRight = meanOf(inner.x1 - 40, inner.x1)
const bgAt = (x) => {
  const t = Math.max(0, Math.min(1, (x - inner.x0) / (inner.x1 - inner.x0)))
  return [0, 1, 2].map((k) => bgLeft[k] + (bgRight[k] - bgLeft[k]) * t)
}
// the artwork inside the tile = pixels that differ clearly from the flat background
let fx0 = inner.x1, fy0 = inner.y1, fx1 = inner.x0, fy1 = inner.y0
for (let y = inner.y0; y < inner.y1; y++) {
  for (let x = inner.x0; x < inner.x1; x++) {
    const c = colAt(x, y), b = bgAt(x)
    if (Math.abs(c[0] - b[0]) + Math.abs(c[1] - b[1]) + Math.abs(c[2] - b[2]) > 60) {
      if (x < fx0) fx0 = x
      if (x > fx1) fx1 = x
      if (y < fy0) fy0 = y
      if (y > fy1) fy1 = y
    }
  }
}
const PAD = 8
const lx0 = fx0 - PAD, ly0 = fy0 - PAD, lw = fx1 - fx0 + 1 + 2 * PAD, lh = fy1 - fy0 + 1 + 2 * PAD
const lock = Buffer.alloc(lw * lh * 4)
for (let y = 0; y < lh; y++) {
  for (let x = 0; x < lw; x++) {
    const sx = lx0 + x, sy = ly0 + y
    const c = colAt(sx, sy), B = bgAt(sx)
    // smallest alpha for which the foreground colour F stays within 0..255, so that F over B reproduces the pixel
    let a = 0
    for (let k = 0; k < 3; k++) {
      if (c[k] > B[k]) a = Math.max(a, (c[k] - B[k]) / (255 - B[k]))
      else if (c[k] < B[k]) a = Math.max(a, (B[k] - c[k]) / B[k])
    }
    a = Math.min(1, a)
    if (a < 0.02) continue // pure background
    const o = (y * lw + x) * 4
    for (let k = 0; k < 3; k++) lock[o + k] = Math.max(0, Math.min(255, Math.round((c[k] - (1 - a) * B[k]) / a)))
    lock[o + 3] = Math.round(a * 255)
  }
}
encodeRGBA({ w: lw, h: lh, data: lock }, path.join(root, 'public/logo-on-dark.png'))

// ---------- 3. favicon: the plum app icon from the sheet ----------
const icon = bbox(1190, 660, 1500, 980)
encodeRGBA(scaleTo(crop(icon, 0), 128), path.join(root, 'public/favicon.png'))

console.log(JSON.stringify({ lightLogo: [onLight.w, onLight.h], darkLockup: [lw, lh], favicon: [128, 128], tile, icon, bgLeft: bgLeft.map(Math.round), bgRight: bgRight.map(Math.round) }))
