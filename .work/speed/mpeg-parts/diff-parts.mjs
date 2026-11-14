// Differential: every part fn/parts.js plans (solve(), as a thread runs it) against the one decoder through the whole
// file, sample bits, the head's count where the serial decoder's samples begin, and the total; at page sizes that cut
// the files in many places. Files that do not part are named, with why if the serial decode says so.
//   node diff-parts.mjs <audioDir> files...
import { readFileSync } from 'node:fs'
const [dir, ...files] = process.argv.slice(2)
const parts = await import(dir + '/fn/parts.js')
const raw = async (format, bytes) => { let { decoder } = await import(`${dir}/node_modules/@audio/decode/members/${format}.js`); let d = await decoder(); try { let r = d.decode(bytes); let n = r.samplesDecoded ?? r.channelData[0].length; return r.channelData.map(c => c.subarray(0, n)) } finally { d.free() } }
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0
let bad = 0, n = 0, unparted = 0
for (let f of files) {
  let bytes = new Uint8Array(readFileSync(f)), format = /\.wav$/i.test(f) ? 'wav' : 'mp3'
  let whole = await raw(format, bytes)
  for (let PS of (process.env.PS || '65536,100000,1048576').split(',').map(Number)) {
    let plan = format === 'wav' ? parts.wav(bytes.subarray(0, 1 << 18), bytes.length, PS) : parts.mpeg(bytes, PS)
    if (!plan) { unparted++; console.log('whole ', f.split('/').pop(), PS, '(does not part)'); continue }
    let channels = format === 'mp3' && whole.length === 2 && whole[0].every((v, i) => i % 37 || v === whole[1][i]) ? 1 : whole.length
    // the first page's bytes: as many samples as the plan says, the serial decoder's, a frame past the page in MPEG
    let head = await raw(format, bytes.subarray(0, plan.first.end)), ok = plan.total === whole[0].length, why = ok ? '' : `total ${plan.total} vs ${whole[0].length}`
    if (!(head[0].length === plan.first.count && head[0].length >= PS + (format === 'mp3' ? 1 : 0) && head.every((c, k) => same(c, whole[k].subarray(0, c.length))))) { ok = false; why ||= `first page: ${head[0].length} samples, plan ${plan.first.count}` }
    let shared = { path: f, format, prefix: plan.prefix }
    for (let [i, p] of plan.parts.entries()) {
      let r = await parts.solve(shared, p), s = (i + 1) * PS
      n++
      let good = r && r.length === whole.length * (p.tail ? 2 : 1) && r.slice(0, channels).every((c, k) => same(c, whole[k].subarray(s, s + p.keep))) &&
        (!p.tail || r.slice(whole.length, whole.length + channels).every((c, k) => same(c, whole[k].subarray(s + p.keep, s + p.keep + p.tail))))
      if (!good) { ok = false; why ||= `part ${i + 1} ${r ? 'differs' : 'not decoded'}` }
    }
    if (!ok) bad++
    console.log(ok ? 'same ' : 'DIFF ', f.split('/').pop(), `PS ${PS}: ${plan.parts.length} parts, total ${plan.total}${plan.d != null ? `, d ${plan.d}` : ''}`, why)
  }
}
console.log(`${n} parts checked; ${bad} plans differ; ${unparted} do not part`)
process.exit(bad ? 1 : 0)
