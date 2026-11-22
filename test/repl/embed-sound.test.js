// <audio-repl> as a sound to the page's parts (repl/embed.js, repl/editor/host.js): an embedded editor answers a play
// button, a clock and a save of the page's own as <audio-sound> does (elements/part.js), and its script is the page's
// to read and to set
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, origin, poll } from './page.js'

async function stage(body) {
  await page.goto(`${origin}/blank.html`)
  await page.evaluate(html => { document.body.style.margin = '0'; document.body.innerHTML = html }, body)
  for (const url of ['/elements/index.js', '/repl/embed.js']) await page.addScriptTag({ type: 'module', url })
  await page.evaluate(() => Promise.all(['audio-repl', 'audio-code', 'audio-play', 'audio-time', 'audio-save'].map(n => customElements.whenDefined(n))))
}

test('audio-repl: a sound to the page\'s parts: its length and place said, played from the page, its script the page\'s code block both ways', async () => {
  await stage(`<audio-repl id="ed" panel="none" height="240" style="width: 700px"><pre><code>audio('chime.wav')
  .gain(-3)</code></pre></audio-repl>
<audio-play for="ed"></audio-play><audio-time for="ed"></audio-time><audio-save for="ed"></audio-save>
<audio-code id="mirror"><pre><code>audio('chime.wav')
  .gain(-3)</code></pre></audio-code>`)
  await page.evaluate(() => {
    const ed = document.getElementById('ed'), mirror = document.getElementById('mirror')
    ed.inputs = []
    ed.addEventListener('input', () => { ed.inputs.push(ed.code); if (mirror.value !== ed.code) mirror.value = ed.code })
    mirror.addEventListener('input', () => { ed.code = mirror.value })
  })
  const ed = page.locator('#ed'), sound = () => ed.evaluate(e => ({ code: e.code, opens: e.opens, saves: e.saves, playing: e.playing, working: e.working, duration: e.duration, time: e.time, error: e.error }))
  // the chime, 8 s (repl/samples.js), said by the frame once its sound is in
  const s = await poll(sound, now => assert.ok(now.duration === 8 && !now.working, JSON.stringify(now)), 30000)
  assert.deepEqual([s.code, s.opens, s.saves, s.playing], ["audio('chime.wav')\n  .gain(-3)", ['chime.wav'], [], false])
  await poll(() => page.locator('audio-time').innerText(), text => assert.equal(text.trim(), '0:00 / 0:08'))
  assert.equal((await page.locator('audio-save').innerText()).trim(), 'Save')
  // played and paused from the page's button
  await page.locator('audio-play button').click()
  await poll(sound, now => assert.ok(now.playing && now.time > .2, JSON.stringify(now)), 15000)
  assert.equal(await page.locator('audio-play button').getAttribute('aria-label'), 'Pause')
  await page.locator('audio-play button').click()
  await poll(sound, now => assert.equal(now.playing, false))
  // the page's code is the frame's script, a step of its history there; the frame's echo of it is no news
  await page.locator('#mirror').evaluate(m => { m.value = "audio('chime.wav')\n  .gain(-3)\n  .save('quiet.flac')"; m.dispatchEvent(new Event('input', { bubbles: true })) })
  // (the files it saves are said by the frame alone, of the script it holds: host.js)
  await poll(sound, now => assert.deepEqual(now.saves, ['quiet.flac']), 10000)
  await poll(() => page.locator('audio-save').innerText(), text => assert.equal(text.trim(), 'quiet.flac'))
  assert.deepEqual(await ed.evaluate(e => e.inputs), [], 'no input event for the script the page itself set')
  // an edit made in the frame is the page's: an input event, the code block's text
  await ed.evaluate(e => e.edit('reverse'))
  await poll(() => page.locator('#mirror').evaluate(m => m.value), text => assert.equal(text, "audio('chime.wav')\n  .gain(-3)\n  .reverse()\n  .save('quiet.flac')"), 15000)
  assert.deepEqual(await ed.evaluate(e => e.inputs), ["audio('chime.wav')\n  .gain(-3)\n  .reverse()\n  .save('quiet.flac')"])
  // saved from the page: the frame's own export, the file the script names
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('audio-save button').click()])
  assert.equal(download.suggestedFilename(), 'quiet.flac')
})
