// Differential, end to end: audio(file) through the new tree and the baseline at the same page size, the decoded samples
// and every stats field bit for bit, loudness, peak, rms, clipping, the header and bit depth, and the 'data' deltas taken
// together the stats; the path each file takes in the new tree named (pages: a WAV a page at a time; parts: MPEG on
// threads; stream: as before), from its planners.
//   node diff-pages.mjs <new> <old> <pageSize|default> files...
import { readFileSync, statSync } from 'node:fs'
const [newDir, oldDir, ps, ...files] = process.argv.slice(2)
const A = (await import(newDir + '/audio.js')).default, B = (await import(oldDir + '/audio.js')).default
const parts = await import(newDir + '/fn/parts.js')
if (ps !== 'default') A.PAGE_SIZE = B.PAGE_SIZE = +ps
const PS = A.PAGE_SIZE, bits = x => Buffer.from(x.buffer, x.byteOffset, x.byteLength), eq = (a, b) => Buffer.compare(bits(a), bits(b)) === 0
const path = f => { let b = readFileSync(f), size = statSync(f).size
  if (/\.wav$/i.test(f)) return parts.wav(new Uint8Array(b.subarray(0, 1 << 18)), size, PS) ? 'pages' : 'stream'
  return size >= 1 << 18 && parts.mpeg(new Uint8Array(b), PS)?.parts.length >= 2 ? 'parts' : 'stream' }
let bad = 0, seen = {}
for (let f of files) {
  let way = path(f), deltas = []
  seen[way] = (seen[way] || 0) + 1
  let a = A(f), b = B(f)
  a.on('data', ({ delta }) => deltas.push(delta))
  let ea, eb
  try { await a } catch (e) { ea = e.message }
  try { await b } catch (e) { eb = e.message }
  if (ea || eb) { let ok = ea === eb; if (!ok) bad++; console.log(ok ? 'same' : 'DIFF', way.padEnd(6), f.split('/').pop(), `throws: ${ea} | ${eb}`); continue }
  let pa = await a.read(), pb = await b.read()
  let samples = pa.length === pb.length && pa.every((c, i) => eq(c, pb[i]))
  let fields = Object.keys(b.stats), stats = Object.keys(a.stats).join() === fields.join() && fields.every(k => typeof b.stats[k] === 'number' ? a.stats[k] === b.stats[k] : a.stats[k].length === b.stats[k].length && a.stats[k].every((c, i) => eq(c, b.stats[k][i])))
  // the deltas, in order, are the stats' blocks
  let joined = fields.filter(k => Array.isArray(a.stats[k])).every(k => a.stats[k].every((c, ch) => { let o = 0; for (let d of deltas) { if (d.fromBlock !== o) return false; let x = d[k][ch]; if (!eq(x, c.subarray(o, o + x.length))) return false; o += x.length } return o === c.length }))
  let q = async x => [await x.stat('loudness'), await x.stat('peak'), await x.stat('rms'), (await x.stat('clipping')).length, x.bitDepth, x.sampleRate, x.channels, x.duration]
  let [qa, qb] = [await q(a), await q(b)], queries = qa.every((v, i) => Object.is(v, qb[i]))
  let header = eq(a._.header ?? new Uint8Array(0), b._.header ?? new Uint8Array(0))
  let ok = samples && stats && queries && header && joined
  if (!ok) bad++
  console.log(ok ? 'same' : 'DIFF', way.padEnd(6), f.split('/').pop(), `${pa.length}ch ${pa[0].length} samples, ${a.pages.length} pages, ${deltas.length} deltas`,
    samples ? '' : 'SAMPLES', stats ? '' : 'STATS', queries ? '' : `QUERIES ${qa} | ${qb}`, header ? '' : 'HEADER', joined ? '' : 'DELTAS')
  a.dispose(); b.dispose()
}
console.log(`${files.length} files at page size ${PS} (${Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(', ')}): ${bad} differ`)
process.exit(bad ? 1 : 0)
