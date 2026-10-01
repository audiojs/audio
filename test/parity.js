import test from 'tst'
import audio from '../audio.js'

const BS = audio.BLOCK_SIZE, SR = 48000
const mean = x => x.reduce((s, v) => s + v, 0) / x.length
const ms = x => x.reduce((s, v) => s + v * v, 0) / x.length

test('parity: K-energy weights a one-sample final block', async t => {
  // A final impulse has no preceding filter state or following decay samples.
  // Compare its energy to the one-frame impulse, divided by the full sample count.
  let unit = audio.from([Float32Array.of(.5)], { sampleRate: SR })
  let x = new Float32Array(BS + 1); x[BS] = .5
  let a = audio.from([x], { sampleRate: SR })
  try {
    let expected = await unit.stat('energy') / x.length
    t.almost(await a.stat('energy'), expected, 1e-9)
    t.almost((await a.stat('energy', { bins: 1 }))[0], expected, 1e-9)
  } finally { unit.dispose(); a.dispose() }
})

test('parity: legacy reducers remain unbound and receive optional block context', async t => {
  audio.stat('parityReducer', {
    block: chs => chs.map(mean),
    reduce(values, from, to) {
      t.is(this, undefined, 'same receiver as the original three-argument call')
      t.is(arguments[3].length, 1, 'sample count is available as argument four')
      return values[from]
    }
  })
  let a = audio.from([Float32Array.of(.25)], { sampleRate: SR })
  try {
    t.is(await a.stat('parityReducer'), .25)
    t.is(await a.stat('parityReducer', { bins: 1 }), Float32Array.of(.25))
  } finally { a.dispose(); delete audio.stat().parityReducer }
})

test('parity: empty statistics and zero-work ranges stay finite', async t => {
  for (let channels of [1, 2]) {
    let a = audio.from(Array.from({ length: channels }, () => new Float32Array(0)), { sampleRate: SR })
    try {
      for (let name of ['dc', 'ms', 'energy']) {
        t.is(await a.stat(name), 0)
        t.is(await a.stat(name, { bins: 1 }), Float32Array.of(0))
        t.is(await a.stat(name, { bins: 0 }), new Float32Array(0))
      }
      t.is(await a.stat('correlation'), channels === 1 ? 1 : 0)
    } finally { a.dispose() }
    let b = audio.from(Array.from({ length: channels }, () => Float32Array.of(.5)), { sampleRate: SR })
    try {
      for (let name of ['dc', 'ms', 'energy']) {
        t.is(await b.stat(name, { at: 1 / SR }), 0, `${name} at EOF`)
        t.is(await b.stat(name, { duration: 0 }), 0, `${name} zero duration`)
      }
    } finally { b.dispose() }
  }
})

test('parity: pushed statistics survive empty writes, final-boundary splits and A/A/B', async t => {
  let A = Float32Array.of(.5), B = Float32Array.from({ length: BS + 1 }, (_, i) => i === BS ? -.5 : .125)
  for (let x of [new Float32Array(0), A, A, B]) for (let split of [Math.max(0, x.length - 1), x.length]) {
    let a = audio(null, { sampleRate: SR, channels: 1 })
    try {
      a.push(new Float32Array(0))
      a.push(x.subarray(0, split)); a.push(x.subarray(split)); a.stop()
      for (let repeat = 0; repeat < 2; repeat++) {
        t.is((await a.read())[0], x, 'PCM unchanged on repeat')
        t.almost(await a.stat('dc'), x.length ? mean(x) : 0, 1e-7)
        t.almost(await a.stat('ms'), x.length ? ms(x) : 0, 1e-7)
        t.is((await a.read({ at: x.length / SR }))[0].length, 0, 'zero-work EOF read')
      }
    } finally { a.dispose() }
  }
})

for (let n of [1, BS - 1, BS, BS + 1, 2 * BS + 17]) {
  test(`parity: sample-weighted DC/MS at ${n} frames, scalar and bins`, async t => {
    let x = Float32Array.from({ length: n }, (_, i) => i >= 2 * BS ? -.5 : i >= BS ? .75 : .125)
    let y = Float32Array.from(x, v => -v / 2)
    let a = audio.from([x, y], { sampleRate: SR })
    try {
      for (let [name, measure] of [['dc', mean], ['ms', ms]]) {
        let expected = (measure(x) + measure(y)) / 2
        t.almost(await a.stat(name), expected, 1e-7, `${name} stereo`)
        t.almost(await a.stat(name, { channel: 1 }), measure(y), 1e-7, `${name} channel`)
        let each = await a.stat(name, { channel: [0, 1] })
        t.almost(each[0], measure(x), 1e-7)
        t.almost(each[1], measure(y), 1e-7)
        t.almost((await a.stat(name, { bins: 1 }))[0], expected, 1e-7, `${name} one bin`)
        let bins = await a.stat(name, { bins: 1, channel: [0, 1] })
        t.almost(bins[0][0], measure(x), 1e-7)
        t.almost(bins[1][0], measure(y), 1e-7)
        if (n > 2 * BS) {
          let range = { at: BS / SR, channel: 0 }
          t.almost(await a.stat(name, range), measure(x.subarray(BS)), 1e-7, `${name} aligned range`)
          let bins = await a.stat(name, { bins: 2, channel: 0 })
          t.almost(bins[0], measure(x.subarray(0, BS)), 1e-7)
          t.almost(bins[1], measure(x.subarray(BS)), 1e-7, `${name} partial final bin`)
        }
      }
      t.almost(await a.stat('ms'), (await a.stat('rms')) ** 2, 1e-7, 'MS equals RMS squared')
    } finally { a.dispose() }
  })
}

test('parity: correlation weights the final block by samples', async t => {
  let l = new Float32Array(BS + 1).fill(.25), r = l.slice()
  r[BS] = -.25
  let a = audio.from([l, r], { sampleRate: SR })
  try {
    t.almost(await a.stat('correlation'), (BS - 1) / (BS + 1), 1e-7)
    t.almost(await a.stat('correlation', { at: BS / SR }), -1, 1e-7)
  } finally { a.dispose() }
})

test('parity: weighted statistics survive gain, crop, reverse and undo', async t => {
  let x = Float32Array.from({ length: 2 * BS + 17 }, (_, i) => (i % 29 - 14) / 32)
  let a = audio.from([x], { sampleRate: SR })
  try {
    for (let edit of [a => a.gain(-6), a => a.crop({ at: BS / SR }), a => a.reverse(), a => a.undo(3)]) {
      edit(a)
      let out = (await a.read())[0]
      t.almost(await a.stat('dc'), mean(out), 1e-7)
      t.almost(await a.stat('ms'), ms(out), 1e-7)
    }
  } finally { a.dispose() }
})

test('parity: reversed partial and whole blocks are measured on the output grid', async t => {
  for (let length of [BS + 17, 2 * BS]) {
    let x = Float32Array.from({ length }, (_, i) => i < BS ? .125 : .75)
    let a = audio.from([x], { sampleRate: SR }).reverse()
    try {
      let out = (await a.read())[0]
      for (let [name, measure] of [['dc', mean], ['ms', ms]]) {
        let bins = await a.stat(name, { bins: 2 })
        t.almost(bins[0], measure(out.subarray(0, BS)), 1e-7)
        t.almost(bins[1], measure(out.subarray(BS)), 1e-7)
      }
      t.is(await a.stat('max', { bins: 2 }), Float32Array.of(.75, .125))
    } finally { a.dispose() }
  }
})

for (let name of ['lowpass', 'highpass']) {
  test(`parity: ${name} rejects unsupported orders`, async t => {
    for (let order of [0, 1, 3, -2, 2.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      for (let unified of [false, true]) {
        let a = audio.from([Float32Array.of(1, 0, 0)], { sampleRate: SR })
        try {
          await t.rejects(async () => {
            if (unified) a.filter(name, 1000, { order })
            else a[name](1000, order)
            await a.read()
          }, /order (must be an even integer >= 2|is NaN)/, String(order))
          a.undo()
          t.is((await a.read())[0], Float32Array.of(1, 0, 0), 'rejected render did not change the source')
        } finally { a.dispose() }
      }
    }
  })
  test(`parity: ${name} accepts default and even orders`, async t => {
    for (let order of [undefined, null, 2, 4, 6, 8, 10]) for (let length of [0, 1, 3]) {
      let input = new Float32Array(length); if (length) input[0] = 1
      let a = audio.from([input], { sampleRate: SR })[name](1000, order)
      try {
        let out = (await a.read())[0]
        t.is(out.length, length)
        t.ok(out.every(Number.isFinite), String(order))
        if (length) t.ok(out[0] > 0 && out[0] < 1, 'the impulse is filtered, not bypassed')
      }
      finally { a.dispose() }
    }
  })
}
