
      import { parentPort } from 'worker_threads'
      import * as assert from 'file:///Users/div/projects/audio/node_modules/tst/assert.js'

      let assertCount = 0
      assert.onPass(({ operator, message }) => {
        assertCount++
        parentPort.postMessage({ type: 'assertion', operator, message, n: assertCount })
      })

      
  const revive = v => {
    if (v && typeof v === 'object') {
      if ('__tst_fn__' in v) return eval('(' + v['__tst_fn__'] + ')')
      for (const k in v) v[k] = revive(v[k])
    }
    return v
  }

      const fn = (async t => {
  // Reproduces encode error -2: when buildPlan returns null (filter before trim),
  // save.js falls back to whole-file encode which hits WASM memory limit.
  let { default: audio } = await import('./audio.js')
  let { join } = await import('path')
  let { unlinkSync } = await import('fs')
  let outPath = join(process.cwd(), 'test', 'tmp-filter-large.mp3')
  try {
    let sr = 48000, dur = 1800, n = sr * dur
    let ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr)
    let a = audio.from([ch, new Float32Array(ch)], { sampleRate: sr })
    a.highpass(50)
    a.trim()
    a.fade(2)
    a.fade(-2)
    await a.save(outPath)
    let result = await audio(outPath)
    t.ok(result.duration > 1700, `mp3 duration: ${result.duration.toFixed(0)}s`)
  } finally {
    try { unlinkSync(outPath) } catch {}
  }
})
      const data = revive(undefined)
      const start = performance.now()
      ;(async () => fn(assert, data))().then(
        () => parentPort.postMessage({ type: 'done', ok: true, time: performance.now() - start, assertCount }),
        e => parentPort.postMessage({ type: 'done', ok: false, error: e.message, time: performance.now() - start, assertCount })
      )
    