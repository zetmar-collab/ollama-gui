// Generuje build/icon.png (256x256 RGBA) i build/icon.ico bez zewnetrznych bibliotek.
// Motyw: fioletowy zaokraglony kwadrat + biala chmurka czatu z trzema kropkami.
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const SIZE = 256
const buf = new Uint8Array(SIZE * SIZE * 4) // RGBA

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
  const i = (y * SIZE + x) * 4
  // Alpha blend na istniejacym pikselu.
  const sa = a / 255
  const da = buf[i + 3] / 255
  const oa = sa + da * (1 - sa)
  if (oa === 0) return
  buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / oa)
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / oa)
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / oa)
  buf[i + 3] = Math.round(oa * 255)
}

function inRoundRect(x, y, x0, y0, x1, y1, rad) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + rad), x1 - rad)
  const cy = Math.min(Math.max(y, y0 + rad), y1 - rad)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= rad * rad
}

function fillRoundRect(x0, y0, x1, y1, rad, colorFn) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (inRoundRect(x, y, x0, y0, x1, y1, rad)) {
        const c = colorFn(x, y)
        set(x, y, c[0], c[1], c[2], c[3])
      }
    }
  }
}

function fillCircle(cx, cy, r, col) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy <= r * r) set(x, y, col[0], col[1], col[2], col[3])
    }
  }
}

function fillTriangle(ax, ay, bx, by, cx, cy, col) {
  const minX = Math.floor(Math.min(ax, bx, cx))
  const maxX = Math.ceil(Math.max(ax, bx, cx))
  const minY = Math.floor(Math.min(ay, by, cy))
  const maxY = Math.ceil(Math.max(ay, by, cy))
  const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = (bx - ax) * (y - ay) - (cx - ax) * (y - ay) // unused
      const s = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / area
      const t = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / area
      if (s >= 0 && t >= 0 && s + t <= 1) set(x, y, col[0], col[1], col[2], col[3])
    }
  }
}

// Tlo: gradient pionowy fioletu z zaokraglonymi rogami.
const top = [108, 92, 231]
const bot = [147, 130, 245]
fillRoundRect(6, 6, 249, 249, 52, (x, y) => {
  const t = (y - 6) / 243
  return [
    Math.round(top[0] + (bot[0] - top[0]) * t),
    Math.round(top[1] + (bot[1] - top[1]) * t),
    Math.round(top[2] + (bot[2] - top[2]) * t),
    255
  ]
})

// Chmurka czatu (biala) z ogonkiem.
const white = [255, 255, 255, 255]
fillRoundRect(60, 74, 196, 168, 26, () => white)
fillTriangle(84, 168, 84, 206, 122, 168, white)

// Trzy kropki (fioletowe).
const dot = [108, 92, 231, 255]
fillCircle(98, 121, 11, dot)
fillCircle(128, 121, 11, dot)
fillCircle(158, 121, 11, dot)

// ---- Kodowanie PNG ----
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function encodePng() {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0 // filter none
    for (let x = 0; x < SIZE * 4; x++) {
      raw[y * (SIZE * 4 + 1) + 1 + x] = buf[y * SIZE * 4 + x]
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---- Kodowanie ICO (osadzony PNG) ----
function encodeIco(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // typ = ikona
  header.writeUInt16LE(1, 4) // liczba obrazow
  const entry = Buffer.alloc(16)
  entry[0] = 0 // 256 -> 0
  entry[1] = 0
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4) // planes
  entry.writeUInt16LE(32, 6) // bpp
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12) // offset = 6 + 16
  return Buffer.concat([header, entry, png])
}

const outDir = path.join(__dirname, '..', 'build')
fs.mkdirSync(outDir, { recursive: true })
const png = encodePng()
fs.writeFileSync(path.join(outDir, 'icon.png'), png)
fs.writeFileSync(path.join(outDir, 'icon.ico'), encodeIco(png))
console.log('Wygenerowano build/icon.png (' + png.length + ' B) i build/icon.ico')
