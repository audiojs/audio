// temporary: how long Node's speaker takes to start on this machine
const t0 = performance.now(), ms = () => Math.round(performance.now() - t0)
const { default: Speaker } = await import('@audio/speaker')
console.log('import', ms())
const write = Speaker({ sampleRate: 44100, channels: 2, bitDepth: 32 })
console.log('open', ms(), write.backend ?? '')
const buf = new Uint8Array(1024 * 2 * 4)
let n = 0
const tick = () => { n++; if (n === 1 || n === 5 || n === 20 || n === 60) console.log('write', n, ms()); if (n < 60) write(buf, tick); else write.close() }
write(buf, tick)
