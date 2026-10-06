// audio/polyfill against the real thing: one scenario runs on Chromium's own HTMLAudioElement (Playwright) and on the
// polyfill in Node, and what each observes (events in order, properties, errors, promises) must be the same. Where they
// part, the browser is right: a difference is a defect of the polyfill, or of the engine under it.
//   node test/polyfill.js
import test from 'tst'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { Audio } from '../polyfill.js'

// What a page and Node both run: `Audio` the class, `src` a 2 s mono WAV, `missing` a source that isn't there. Each
// observation goes in the log by name; times round to what both clocks can promise.
async function scenario(Audio, src, missing, log) {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  // the events of `types` that `a` fires until `last` (or ms pass), in order; the noisy ones (progress, timeupdate) left out
  const events = (a, last, ms = 5000, keep = t => !['progress', 'suspend', 'stalled', 'waiting', 'timeupdate', 'abort'].includes(t)) => new Promise(resolve => {
    const seen = [], types = ['abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied', 'ended', 'error', 'loadeddata', 'loadedmetadata', 'loadstart', 'pause', 'play', 'playing', 'progress', 'ratechange', 'seeked', 'seeking', 'stalled', 'suspend', 'timeupdate', 'volumechange', 'waiting']
    const on = e => { if (keep(e.type)) seen.push(e.type); if (e.type === last) done() }
    const done = () => { for (const t of types) a.removeEventListener(t, on); clearTimeout(timer); resolve(seen) }
    for (const t of types) a.addEventListener(t, on)
    const timer = setTimeout(done, ms)
  })
  const fails = fn => { try { fn(); return 'none' } catch (e) { return e.name } }

  const empty = new Audio()
  log.constants = [empty.HAVE_NOTHING, empty.HAVE_METADATA, empty.HAVE_ENOUGH_DATA, empty.NETWORK_NO_SOURCE]
  log.empty = { src: empty.src, currentSrc: empty.currentSrc, paused: empty.paused, ended: empty.ended, currentTime: empty.currentTime, duration: String(empty.duration), readyState: empty.readyState, networkState: empty.networkState, volume: empty.volume, muted: empty.muted, playbackRate: empty.playbackRate, loop: empty.loop, error: empty.error, preload: empty.preload, buffered: empty.buffered.length }
  log.canPlayType = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/ogg; codecs="vorbis"', 'audio/ogg; codecs="nonsense"', 'video/x-nothing'].map(t => empty.canPlayType(t) !== '')

  const a = new Audio()
  const loading = events(a, 'canplaythrough')
  a.src = src
  log.loading = await loading
  a.muted = true
  await wait(50)
  log.loaded = { duration: a.duration.toFixed(3), readyState: a.readyState, paused: a.paused, currentTime: a.currentTime, seekable: [a.seekable.length, a.seekable.end(0).toFixed(3)] }

  log.volume = [fails(() => a.volume = 2), fails(() => a.volume = -0.1)]
  let changes = events(a, 'volumechange', 1000)
  a.volume = 0.5
  log.volumeChange = [await changes, a.volume]
  log.rate = [fails(() => a.playbackRate = 100), fails(() => a.playbackRate = NaN)]
  changes = events(a, 'ratechange', 1000)
  a.playbackRate = 1.5
  log.rateChange = await changes
  a.playbackRate = 1

  let handled = 0
  a.onplay = () => handled++
  const starting = events(a, 'playing')
  const p = a.play()
  log.play = { promise: p instanceof Promise, paused: a.paused, events: await starting, resolved: await p.then(() => true) }
  let ticks = 0
  const tick = () => ticks++
  a.addEventListener('timeupdate', tick)
  await wait(400)
  a.removeEventListener('timeupdate', tick)
  log.timeupdates = ticks >= 1
  log._playing = a.currentTime  // the raw value, shown when the two differ, not compared
  log.playing = { onplay: handled, moving: log._playing > 0.2 && log._playing < 1 }

  const pausing = events(a, 'pause', 1000, t => true)
  a.pause()
  log.pause = { paused: a.paused, events: await pausing }
  const at = a.currentTime
  await wait(200)
  log.held = Math.abs(a.currentTime - at) < 0.01

  const seeking = events(a, 'seeked', 2000, t => t !== 'progress' && t !== 'suspend')
  a.currentTime = 0.2
  log.seek = { seeking: a.seeking, events: await seeking, time: a.currentTime.toFixed(2), seekingAfter: a.seeking }

  const pausedFirst = a.play()
  a.pause()
  log.abort = await pausedFirst.then(() => 'resolved', e => e.name)

  a.currentTime = 1.6
  await events(a, 'seeked', 2000)
  const ending = events(a, 'ended', 4000)
  await a.play()
  log.end = { events: await ending, ended: a.ended, paused: a.paused, time: a.currentTime.toFixed(2) }
  await a.play()
  log.restart = { ended: a.ended, early: a.currentTime < 0.5 }
  a.pause()

  a.loop = true
  a.currentTime = 1.8
  await events(a, 'seeked', 2000)
  const looping = events(a, 'ended', 1000)
  await a.play()
  log.loop = { events: await looping, ended: a.ended, paused: a.paused, wrapped: a.currentTime < 1 }
  a.loop = false
  a.pause()
  log.played = { some: a.played.length > 0, from: a.played.length ? a.played.start(0).toFixed(1) : null }

  const playingThen = a.play()
  const reloading = events(a, 'loadstart', 2000, t => t !== 'progress' && t !== 'suspend' && t !== 'timeupdate')
  a.src = src
  log.reload = { events: await reloading, promise: await playingThen.then(() => 'resolved', e => e.name), paused: a.paused, currentTime: a.currentTime }
  a.pause()

  const b = new Audio()
  const failing = events(b, 'error', 5000)
  b.src = missing
  log.missing = { events: await failing, code: b.error?.code, networkState: b.networkState, readyState: b.readyState }
  log.missingPlay = await b.play().then(() => 'resolved', e => e.name)
  return log
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wav': 'audio/wav' }
const server = createServer(async (req, res) => {
  if (req.url === '/') return res.end('<!doctype html><title>polyfill</title>')
  let body
  try { body = await readFile(new URL('..' + req.url, import.meta.url)) } catch { return res.writeHead(404).end() }
  let type = types[req.url.slice(req.url.lastIndexOf('.'))] || 'application/octet-stream'
  // ranges, as a real server answers them: without, a page's element can't seek
  let range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
  if (!range) return res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length }).end(body)
  let from = +range[1] || 0, to = range[2] ? +range[2] : body.length - 1
  res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to}/${body.length}`, 'content-length': to - from + 1 }).end(body.subarray(from, to + 1))
}).listen(0)
const origin = `http://127.0.0.1:${server.address().port}`

test('polyfill ≡ HTMLAudioElement, observation by observation', { timeout: 120000 }, async t => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const page = await browser.newPage()
  await page.goto(origin + '/')
  // each side fills its log as it goes; one that stalls is compared as far as it got, the step after its last its failure
  const stall = ms => new Promise(r => setTimeout(() => r('stalled'), ms))
  const ours = {}
  const real = await page.evaluate(`window.log = {}; Promise.race([(${scenario})(Audio, '/test/fixture.wav', '/test/missing.wav', window.log), new Promise(r => setTimeout(r, 40000))]).then(() => window.log)`)
  await browser.close()
  const end = await Promise.race([scenario(Audio, 'test/fixture.wav', 'test/missing.wav', ours), stall(40000)])
  server.close()
  if (end === 'stalled') console.log('polyfill stalled after: ' + Object.keys(ours).at(-1))
  // `_` keys are raw readings, not compared: shown with a difference, to say what the polyfill saw
  const keys = Object.keys(real).filter(k => k[0] !== '_'), raw = Object.keys(real).filter(k => k[0] === '_')
  const differ = keys.filter(k => JSON.stringify(ours[k]) !== JSON.stringify(real[k]))
  for (const k of differ) console.log(`${k}\n  polyfill: ${JSON.stringify(ours[k])}\n  browser:  ${JSON.stringify(real[k])}`)
  if (differ.length) for (const k of raw) console.log(`${k}: polyfill ${ours[k]}, browser ${real[k]}`)
  t.is(differ, [], 'what the polyfill observes differently')
  for (const key of keys) t.is(ours[key], real[key], key)
})
