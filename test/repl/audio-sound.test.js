// <audio-sound> and its parts (elements/sound.js, part.js, play.js, seek.js, time.js, status.js, open.js, save.js): a
// script run by the editor's engine in the page, played by its player, saved as the script says, with no editor round
// it. The reference for what a script comes to is the library itself, in Node: the same calls on the same file, its
// length and the bytes it encodes
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import audio from '../../audio.js'
import { samples, RATE as SAMPLED } from '../../repl/samples.js'
import { page, origin, poll, wavBytes, sine, RATE } from './page.js'

const FIXTURE = new URL('../fixture.wav', import.meta.url)
// A page of the elements: `body` as its markup, every element defined
async function stage(body) {
  await page.goto(`${origin}/blank.html`)
  await page.evaluate(html => { document.body.innerHTML = html }, body)
  await page.addScriptTag({ type: 'module', url: '/elements/index.js' })
  await page.evaluate(() => Promise.all(['audio-sound', 'audio-code', 'audio-play', 'audio-seek', 'audio-time', 'audio-status', 'audio-open', 'audio-save'].map(n => customElements.whenDefined(n))))
}
const TAKE = `<audio-sound id="take">
  <audio src="/test/fixture.wav" data-name="take.wav" preload="none"></audio>
  <audio-code><pre><code>audio('take.wav')
  .reverse()
  .gain(-6)
  .save('out.wav')</code></pre></audio-code>
  <audio-play></audio-play><audio-seek></audio-seek><audio-time></audio-time><audio-status></audio-status><audio-open></audio-open><audio-save></audio-save>
</audio-sound>`
// what the page asks for, by path
function asked() { const got = []; page.on('request', r => got.push(new URL(r.url()).pathname)); return got }
const sound = (id = 'take') => page.locator(`#${id}`)
const state = (id = 'take') => sound(id).evaluate(s => ({ playing: s.playing, working: s.working, status: s.status, error: s.error, duration: s.duration, time: s.time, opens: s.opens, saves: s.saves, files: s.files, code: s.code }))
const settled = (id = 'take', ms = 20000) => poll(() => state(id), s => assert.ok(s.duration > 0 && !s.working, JSON.stringify(s)), ms)
// a download the page makes: its name and its bytes
async function saved(press) {
  const [download] = await Promise.all([page.waitForEvent('download'), press()])
  return { name: download.suggestedFilename(), bytes: await readFile(await download.path()) }
}

test('audio-sound: at rest no engine, no worker, no script editor: its parts say what its script opens and saves', async () => {
  const got = asked()
  await stage(TAKE)
  await poll(() => page.locator('audio-save').innerText(), text => assert.equal(text.trim(), 'out.wav'))
  assert.equal((await page.locator('audio-open').innerText()).trim(), 'take.wav')
  assert.equal((await page.locator('audio-time').innerText()).trim(), '0:00')
  assert.equal(await page.locator('audio-play button').getAttribute('aria-label'), 'Play')
  assert.equal(await page.locator('audio-status').getAttribute('role'), 'status')
  assert.equal((await page.locator('audio-status').innerText()).trim(), '')
  assert.equal(await page.locator('audio-seek input').isDisabled(), true, 'nothing to move along till it has run')
  assert.deepEqual(await state(), { playing: false, working: false, status: '', error: '', duration: 0, time: 0, opens: ['take.wav'], saves: ['out.wav'], files: ['take.wav'], code: "audio('take.wav')\n  .reverse()\n  .gain(-6)\n  .save('out.wav')" })
  // lays no box, and the file it names is not its picture
  assert.equal(await sound().evaluate(s => getComputedStyle(s).display), 'contents')
  assert.equal(await sound().evaluate(s => getComputedStyle(s.querySelector('audio')).display), 'none')
  // the player once it is in sight (the first press then opens the device in the press); nothing else
  await poll(() => got.includes('/repl/player.js'), ok => assert.ok(ok))
  await page.waitForTimeout(300)
  for (const path of ['/repl/engine.js', '/repl/dist/worker.js', '/assets/codemirror.js', '/test/fixture.wav']) assert.ok(!got.includes(path), `${path} not asked for at rest`)
})

test('audio-sound: play runs its script in the engine and plays it; its length and the file it saves are the library\'s own', async () => {
  await stage(TAKE)
  await page.locator('audio-play button').click()
  assert.equal(await page.locator('audio-play').evaluate(e => e.hasAttribute('data-playing')), true, 'wanted at once')
  const s = await settled()
  // the library in Node, the same calls on the same file
  const ours = audio(await readFile(FIXTURE)).reverse().gain(-6)
  await ours.ready
  assert.ok(Math.abs(s.duration - ours.duration) < 1e-9, `${s.duration} s, the library's ${ours.duration}`)
  await poll(() => state(), now => assert.ok(now.playing && now.time > .1, JSON.stringify(now)))
  assert.equal(await page.locator('audio-play button').getAttribute('aria-label'), 'Pause')
  const clock = t => `${Math.floor(Math.round(t) / 60)}:${String(Math.round(t) % 60).padStart(2, '0')}`
  assert.match((await page.locator('audio-time').innerText()).trim(), new RegExp(`^\\d:\\d\\d / ${clock(ours.duration)}$`))
  assert.ok(+await page.locator('audio-play').evaluate(e => e.style.getPropertyValue('--played')) > 0, '--played says how far')
  assert.equal(+await page.locator('audio-seek input').getAttribute('max'), s.duration)
  // paused: where it is kept
  await page.locator('audio-play button').click()
  const at = (await state()).time
  assert.equal((await state()).playing, false)
  await page.waitForTimeout(200)
  assert.equal((await state()).time, at, 'still')
  // and from there it plays on
  await page.locator('audio-play button').click()
  await poll(() => state(), now => assert.ok(now.playing && now.time > at && now.time < at + 1, JSON.stringify(now)))
  await page.locator('audio-play button').click()
  // saved: the file its save() names, the bytes the library encodes
  const file = await saved(() => page.locator('audio-save button').click())
  assert.equal(file.name, 'out.wav')
  assert.deepEqual([...file.bytes], [...await ours.encode('wav')])
})

test('audio-sound: a part outside its sound names it; a script with no save() saves its output as the part\'s name says', async () => {
  await stage(`<audio-play for="apart"></audio-play><audio-time for="apart"></audio-time><audio-save for="apart" name="chime.flac"></audio-save>
<audio-sound id="apart"><audio-code><pre><code>audio('chime.wav')
  .gain(-3)</code></pre></audio-code></audio-sound>`)
  assert.equal((await page.locator('audio-save').innerText()).trim(), 'chime.flac')
  await page.locator('audio-play button').click()
  const s = await settled('apart')
  // the editor's own sample, as it makes it (repl/sources.js sample, over samples.js)
  const ours = audio.from(samples.chime.make(), { sampleRate: SAMPLED }).gain(-3)
  assert.ok(Math.abs(s.duration - ours.duration) < 1e-9)
  await poll(() => page.locator('audio-time').innerText(), text => assert.match(text.trim(), /^0:0\d \/ 0:0\d$/))
  await page.locator('audio-play button').click()
  const file = await saved(() => page.locator('audio-save button').click())
  assert.equal(file.name, 'chime.flac')
  assert.equal(file.bytes.subarray(0, 4).toString('latin1'), 'fLaC')
  assert.deepEqual([...file.bytes], [...await ours.encode('flac')])
})

test('audio-sound: with no script, its src alone: audio(src), sought along by audio-seek', async () => {
  await stage(`<audio-sound id="file" src="/test/fixture.wav"><audio-play></audio-play><audio-seek></audio-seek><audio-time></audio-time></audio-sound>`)
  assert.equal((await state('file')).code, 'audio("/test/fixture.wav")')
  await page.locator('audio-play button').click()
  const s = await settled('file')
  const ours = audio(await readFile(FIXTURE))
  await ours.ready
  assert.ok(Math.abs(s.duration - ours.duration) < 1e-9)
  await poll(() => state('file'), now => assert.ok(now.time > .05))
  await page.locator('audio-play button').click()
  const to = s.duration / 2
  await page.locator('audio-seek input').evaluate((el, to) => { el.value = to; el.dispatchEvent(new Event('input', { bubbles: true })) }, to)
  assert.ok(Math.abs((await state('file')).time - to) < 1e-6)
  assert.equal(await page.locator('audio-seek input').getAttribute('aria-label'), 'Position')
  // played from there
  await page.locator('audio-play button').click()
  await poll(() => state('file'), now => assert.ok(now.playing && now.time > to && now.time < to + 1, JSON.stringify(now)))
  await page.locator('audio-play button').click()
})

test('audio-sound: its script changed runs again once it has run, taking over where it plays; before, nothing runs', async () => {
  const got = asked()
  await stage(TAKE)
  const edit = to => page.locator('audio-code').evaluate((el, to) => { el.value = to; el.dispatchEvent(new Event('input', { bubbles: true })) }, to)
  await edit("audio('take.wav')\n  .gain(-6)")
  await page.waitForTimeout(600)
  assert.ok(!got.includes('/repl/engine.js'), 'a script edited before any run runs nothing')
  assert.equal((await page.locator('audio-save').innerText()).trim(), 'Save', 'its parts say the script as it is now')
  await page.locator('audio-play button').click()
  const first = await settled()
  await poll(() => state(), now => assert.ok(now.time > .05))
  await edit("audio('take.wav')\n  .stretch(2)")
  const ours = audio(await readFile(FIXTURE)).stretch(2)
  await ours.ready
  const next = await poll(() => state(), now => assert.ok(Math.abs(now.duration - ours.duration) < 1e-9, `${now.duration} s, the library's ${ours.duration}`), 20000)
  assert.ok(next.duration > first.duration * 1.9)
  assert.equal(next.playing, true, 'playing on')
})

test('audio-sound: what goes wrong is said, not thrown: a syntax error by its line, a call that fails by its message', async () => {
  await stage(TAKE)
  const edit = to => page.locator('audio-code').evaluate((el, to) => { el.value = to; el.dispatchEvent(new Event('input', { bubbles: true })) }, to)
  const heard = await sound().evaluate(s => { s.errors = []; s.addEventListener('error', e => s.errors.push(e.detail.message)); return true })
  assert.ok(heard)
  await edit("audio('take.wav')\n  .trim(")
  await page.locator('audio-play button').click()
  await poll(() => state(), s => assert.equal(s.error, 'Syntax error on line 2'))
  assert.equal(await page.locator('audio-status').evaluate(e => e.hasAttribute('data-error')), true)
  assert.equal((await page.locator('audio-status').innerText()).trim(), 'Syntax error on line 2')
  assert.equal((await state()).playing, false)
  await edit("audio('take.wav')\n  .nosuch()")
  await page.locator('audio-play button').click()
  await poll(() => state(), s => assert.match(s.error, /nosuch is not a function/))
  assert.equal((await state()).playing, false)
  // mended: it runs, and the error is gone
  await edit("audio('take.wav')\n  .gain(-6)")
  await page.locator('audio-play button').click()
  const s = await settled()
  assert.equal(s.error, '')
  assert.equal(await page.locator('audio-status').evaluate(e => e.hasAttribute('data-error')), false)
  assert.deepEqual(await sound().evaluate(s => s.errors), ['Syntax error on line 2', 'audio(...).nosuch is not a function'])
  await page.locator('audio-play button').click()
})

test('audio-sound: a file of the reader\'s own opens in place of the one the script names, by a name free on the page', async () => {
  await stage(TAKE)
  await page.locator('audio-play button').click()
  await settled()
  await page.locator('audio-play button').click()
  // a second and a half of a tone, named as the file the page already has
  const tone = [sine(1.5, 440, .25)]
  await page.locator('audio-open input[type=file]').setInputFiles({ name: 'take.wav', mimeType: 'audio/wav', buffer: await wavBytes(tone) })
  const s = await poll(() => state(), now => assert.ok(Math.abs(now.duration - 1.5) < 1e-9 && !now.working, JSON.stringify(now)), 20000)
  assert.deepEqual(s.opens, ['take-2.wav'])
  assert.equal(s.code, "audio('take-2.wav')\n  .reverse()\n  .gain(-6)\n  .save('out.wav')")
  assert.equal((await page.locator('audio-open').innerText()).trim(), 'take-2.wav')
  assert.ok(s.files.includes('take-2.wav') && s.files.includes('take.wav'))
  // its saved file: the library's for the same calls on the tone
  const ours = audio.from(tone, { sampleRate: RATE }).reverse().gain(-6)
  const file = await saved(() => page.locator('audio-save button').click())
  const theirs = audio(file.bytes)
  await theirs.ready
  const [a, b] = [await ours.read(), await theirs.read()]
  assert.equal(b[0].length, a[0].length)
  assert.ok(a[0].every((v, i) => Math.abs(v - b[0][i]) < 1e-6), 'the samples the library makes')
})

test('audio-sound: inside one, the script editor completes its files in audio(\'…\'), and ⌘↵ plays it', async () => {
  await stage(`<audio-sound id="take">
  <audio src="/test/fixture.wav" data-name="take.wav" preload="none"></audio>
  <audio-code><pre><code>audio('')</code></pre></audio-code>
  <audio-play></audio-play>
</audio-sound>`)
  const el = page.locator('audio-code')
  await poll(() => el.evaluate(e => e.hasAttribute('data-drawn')), d => assert.ok(d))
  await el.locator('.cm-line').first().click()
  await poll(() => el.evaluate(e => e.hasAttribute('data-live') && e.contains(document.activeElement)), ok => assert.ok(ok))
  await page.keyboard.press('Home')
  for (let i = 0; i < "audio('".length; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.type('t')
  const list = page.locator('.cm-tooltip-autocomplete')
  await poll(() => list.locator('.cm-completionLabel').allTextContents(), labels => assert.deepEqual(labels, ['take.wav']))
  await list.locator('li').first().click()
  assert.equal(await el.evaluate(e => e.value), "audio('take.wav')")
  await page.keyboard.press('ControlOrMeta+Enter')
  await settled()
  await poll(() => state(), now => assert.ok(now.playing))
  await page.keyboard.press('ControlOrMeta+Enter')
  assert.equal((await state()).playing, false)
})
