// The fallbacks forced: a tree with mpeg-parts.patch and fallback-inject.patch against one that streams (HEAD's core.js), the
// same samples and stats by each way a part can fail: FAIL=count (the first page's count off by one), part (a part does
// not come back), seam (its first sample off), throw (its thread throws); AT the first byte of the part that fails
// (parts.mpeg(bytes, audio.PAGE_SIZE).parts[i].from)
//   FAIL=seam AT=1710959 node fallback.mjs <patched and injected> <streaming> file.mp3
const [newDir, oldDir, file] = process.argv.slice(2)
const A = (await import(newDir + '/audio.js')).default, B = (await import(oldDir + '/audio.js')).default
const bits = x => Buffer.from(x.buffer, x.byteOffset, x.byteLength)
let t = performance.now(), a = await A(file), pa = await a.read(), ms = performance.now() - t, b = await B(file), pb = await b.read()
let same = pa.every((c, i) => Buffer.compare(bits(c), bits(pb[i])) === 0) && Object.keys(b.stats).every(k => typeof b.stats[k] === 'number' || b.stats[k].every((c, i) => Buffer.compare(bits(c), bits(a.stats[k][i])) === 0))
console.log((process.env.FAIL || 'none').padEnd(6), same ? 'same' : 'DIFF', `${a.pages.length} pages, ${ms.toFixed(0)} ms`, file.split('/').pop())
