// The agent, through the local bridge, and its conversations; the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { page, errors, open, tab, show, shown } from './page.js'

// The agent, through the local bridge (bin/bridge.js): the page connects with the bridge's address and key, the agent
// the bridge started with named, no choice to make; it answers the agent's tool calls as the MCP server sends them (an
// edit written into the script, one step; the state of the sound; a measurement and a picture, changing nothing; the
// file as it opened, level-matched), and the chat streams the agent's words as Markdown, what it runs while it answers,
// the tools it used. The conversation is the page's, kept: a reload brings it back, a new one starts empty, the old one
// is a click away, another tab shows it still (the agent's `open` and `tabs` move between tabs mid-conversation). The agent here is a stand-in on PATH printing what
// `claude -p --output-format stream-json --verbose --include-partial-messages` prints, a tool's run held for a moment
test('editor: through the local bridge, an agent measures and edits the sound open; its words as Markdown, kept across tabs', async () => {
  const { spawn } = await import('node:child_process'), { mkdtempSync, writeFileSync, chmodSync, readFileSync } = await import('node:fs'), { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'audio-agent-')), S = 'b1d0c0de-0000-4000-8000-000000000001', KEY = 'editor-test-key', log = join(dir, 'log')
  const ev = event => ({ type: 'stream_event', event, session_id: S, parent_tool_use_id: null })
  const say = text => ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  writeFileSync(join(dir, 'claude'), `#!${process.execPath}
const fs = require('fs'), input = fs.readFileSync(0, 'utf8')
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), input }) + '\\n')
const out = l => process.stdout.write(JSON.stringify(l) + '\\n'), wait = ms => new Promise(r => setTimeout(r, ms))
;(async () => {
  // asked again: three calls at once, answered in another order, the check refused; the measurement made through the
  // bridge as the agent's MCP server makes it
  const mcp = JSON.parse(process.argv[process.argv.indexOf('--mcp-config') + 1]).mcpServers.audio.args, at = flag => mcp[mcp.indexOf(flag) + 1]
  if (input.includes('peak')) return ${JSON.stringify([
    { type: 'system', subtype: 'init', session_id: S },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'mcp__audio__measure', input: { code: "out.stat(['truepeak', 'loudness'])" } }, { type: 'tool_use', id: 'b', name: 'mcp__audio__check', input: { spec: 'podcast' } }, { type: 'tool_use', id: 'c', name: 'mcp__audio__look', input: { at: 1, d: 2 } }, { type: 'tool_use', id: 'd', name: 'mcp__audio__edit', input: { call: 'fade(0.02, 0.1)' } }] }, parent_tool_use_id: null, session_id: S },
    'call',
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'no', is_error: true }, { type: 'tool_result', tool_use_id: 'a', content: '-1' }, { type: 'tool_result', tool_use_id: 'c', content: '' }, { type: 'tool_result', tool_use_id: 'd', content: '' }] }, parent_tool_use_id: null, session_id: S },
    { type: 'result', subtype: 'success', is_error: false, result: '', session_id: S }
  ])}.reduce((p, l) => p.then(() => l === 'call' ? fetch(at('--playground') + '/call', { method: 'POST', headers: { authorization: 'Bearer ' + at('--key') }, body: JSON.stringify({ tool: 'measure', args: { code: "out.stat(['truepeak', 'loudness'])" } }) }) : out(l)), Promise.resolve())
  for (const l of ${JSON.stringify([
    { type: 'system', subtype: 'init', session_id: S },
    ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    say('It is **6.5 s** '), say('long.\n\n| Rule | Value |\n|---|---|\n| Peak | `−1.0dB` |'),
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__audio__state', input: {} }] }, parent_tool_use_id: null, session_id: S }
  ])}) out(l)
  await wait(800)
  out(${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }] }, parent_tool_use_id: null, session_id: S })})
  // thinking past the page's next tick of its seconds (each second, from whenever) on a runner that runs it late
  await wait(3000)
  out(${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '', session_id: S })})
})()
`)
  chmodSync(join(dir, 'claude'), 0o755)
  const runs = () => readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const proc = spawn(process.execPath, [fileURLToPath(new URL('../../bin/cli.js', import.meta.url)), '--bridge', '--port', '0', '--key', KEY], { env: { ...process.env, AUDIO_BRIDGE_KEY: '', PATH: dir }, stdio: ['ignore', 'pipe', 'inherit'] })
  try {
    const url = await new Promise(resolve => proc.stdout.on('data', d => { const m = String(d).match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve(m[0]) }))
    // the bridge is the one other address the page may reach
    await page.route(url + '/**', route => route.continue())
    await open()
    await tab('Agent')
    await page.getByRole('textbox', { name: 'The bridge\'s address' }).fill(url)
    await page.getByLabel('The bridge\'s key').fill(KEY)
    await page.getByRole('button', { name: 'Connect' }).click()
    await page.locator('.chat-form textarea[placeholder="Ask Claude Code…"]').waitFor()
    assert.equal(await page.getByRole('textbox', { name: 'The bridge\'s address' }).count(), 0, 'its address and key gone once connected')
    assert.equal(await page.locator('.chat-empty').count(), 0, 'connected, nothing said: the box says who answers, no choice of agent')
    assert.equal(await page.locator('.chat-head').count(), 0, 'no conversations yet')
    // the agent's tools, as its MCP server calls them
    const call = (tool, args = {}) => fetch(`${url}/call?key=${KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tool, args }) }).then(r => r.json())
    const edited = await call('edit', { call: 'gain(-6)' })
    assert.equal(edited.result.ok, true, JSON.stringify(edited))
    await page.waitForFunction(() => /\.gain\(-6\)$/.test(scriptText().trim()))
    const { result: now } = await call('state')
    assert.ok(now.script.trim().endsWith('.gain(-6)') && now.duration > 6 && Number.isFinite(now.stats.loudness), JSON.stringify(now))
    // a measurement of the output as shown, every edit in, and of the file as it opened; nothing changes
    const script = await page.evaluate(() => scriptText())
    const { result: levels } = await call('measure', { code: "out.stat(['loudness', 'db'])" })
    assert.ok(Math.abs(levels[0] - now.stats.loudness) < 0.01 && Math.abs(levels[1] - now.stats.peak) < 0.01, JSON.stringify({ levels, now }))
    const { result: before } = await call('measure', { code: "const l = await src.stat('loudness')\nl - 6" })
    assert.ok(Math.abs(before - (await call('measure', { code: "src.stat('loudness')" })).result + 6) < 1e-6, 'a script\'s statements, its last expression the answer')
    assert.ok(Math.abs((await call('measure', { code: 'out.duration' })).result - now.duration) < 1e-5, 'to 7 digits')
    assert.deepEqual((await call('measure', { code: '[1 / 0, -1 / 0, new Float32Array([0.5, 0.25])]' })).result, ['Infinity', '-Infinity', [0.5, 0.25]], 'what JSON has no word for as text, typed arrays whole')
    assert.match((await call('measure', { code: 'out.nope()' })).error, /nope/, 'its error, said')
    // the picture, the waveform over the spectrogram, of the range asked; the view as it was
    const { result: picture } = await call('look', { at: 1, d: 2 })
    assert.match(picture.image, /^data:image\/png;base64,/)
    assert.ok(picture.image.length > 4000 && picture.text.startsWith('0:01.000 to 0:03.000'), picture.text)
    assert.equal(await page.evaluate(() => scriptText()), script, 'measured and looked at, the script as it was')
    // the agent's edit drawn over the picture as its card draws it; a pitch edit's, the pitch curve before it and after,
    // the spectrogram turned to, its look told so; gone once the script moves on
    assert.equal((await call('edit', { call: 'intonation(1.5)' })).result.ok, true)
    assert.equal(await shown(), 'Spectrogram')
    assert.match((await call('look')).result.text, /the pitch curve before your last edit, dashed, and after it$/)
    await call('undo')
    assert.doesNotMatch((await call('look')).result.text, /pitch curve/)
    await show('wave')
    // the caret or a range put where it does not show comes into sight, as the user's own would
    await page.locator('.plot').focus()
    for (let i = 0; i < 4; i++) await page.keyboard.press('=')
    const sight = async () => (await call('look')).result.text.match(/^([\d:.]+) to ([\d:.]+)/).slice(1).map(t => +t.split(':')[1])
    const [a0, b0] = await sight()
    assert.ok(b0 - a0 < 2 && b0 < 5.5, `zoomed in: ${a0}–${b0}`)
    await call('select', { cursor: 5.5 })
    const [a1, b1] = await sight()
    assert.ok(a1 <= 5.5 && 5.5 <= b1 && Math.abs(b1 - a1 - (b0 - a0)) < .01, `the caret in sight, the zoom kept: ${a1}–${b1}`)
    await call('select', { at: .5, d: 5 })
    const [a2, b2] = await sight()
    assert.ok(a2 <= .5 && b2 >= 5.5, `a range longer than what shows, all of it: ${a2}–${b2}`)
    // the file as it opened, level-matched, then the output again
    assert.equal((await call('play', { original: true })).result.original, true)
    assert.equal((await call('play', { original: false })).result.original, false)
    await call('stop')
    await call('undo')
    await page.waitForFunction(() => !scriptText().includes('gain('))
    // a box of a band, on the spectrogram, which then shows
    const { result: boxed } = await call('select', { at: 1, d: 1, low: 1000, high: 3000 })
    assert.deepEqual([boxed.selection, boxed.band], [[1, 2], [1000, 3000]])
    assert.equal(await shown(), 'Spectrogram')
    assert.deepEqual((await call('state')).result.band, [1000, 3000])
    // scrubbed: the caret swept to where it ends, the moment under it sounding on the way
    assert.equal((await call('scrub', { at: 1, to: 2, d: .3 })).result.cursor, 2)
    assert.equal(await page.locator('.time').innerText(), '0:02.000')
    // its edits as the Edits panel's cards: turned off and on, moved, taken away, one step each
    const calls = async () => (await call('state')).result.steps.map(s => (s.on ? '' : '~') + s.call)
    assert.deepEqual(await calls(), ['trim()', 'normalize(-1)', 'fade(0.02, 0.1)'])
    for (const [args, after] of [[{ index: 2, on: false }, ['trim()', 'normalize(-1)', '~fade(0.02, 0.1)']], [{ index: 2, on: true }, ['trim()', 'normalize(-1)', 'fade(0.02, 0.1)']],
      [{ index: 1, to: 0 }, ['normalize(-1)', 'trim()', 'fade(0.02, 0.1)']], [{ index: 0, remove: true }, ['trim()', 'fade(0.02, 0.1)']]]) {
      assert.equal((await call('step', args)).result.ok, true, JSON.stringify(args))
      assert.deepEqual(await calls(), after, JSON.stringify(args))
    }
    assert.match((await call('step', { index: 5, on: false })).error, /No edit 5/)
    assert.match((await call('step', { index: 0, to: 2 })).error, /No place 2 to move it to: there are 2/)
    assert.match((await call('step', { index: 0 })).error, /on, remove, to or call/, 'nothing asked of it')
    assert.deepEqual((await call('step', { index: 0, on: true })).result, { ok: true, unchanged: true }, 'on already')
    assert.deepEqual((await call('step', { index: 1, to: 1 })).result, { ok: true, unchanged: true }, 'where it is')
    await call('undo')
    assert.deepEqual(await calls(), ['normalize(-1)', 'trim()', 'fade(0.02, 0.1)'], 'one undo, one act')
    await call('script', { code: script })
    // through the edits: one as the sound enters and leaves it, what it takes out, where a range of the output was as it
    // entered it (none for trim, which changes the timing); turned off over a range alone, its mix 0 there ramped over the
    // splices (10 ms), and on again; written anew; seen and heard up to it, or what it takes out, the panel as it was after
    assert.deepEqual(await calls(), ['trim()', 'normalize(-1)', 'fade(0.02, 0.1)', 'gain(-6)'])
    const { result: through } = await call('measure', { code: "const s = step(3), w = s.where({ at: 1, d: 1 }); [s.call, s.before.stat('db') - s.after.stat('db'), s.takes.stat('db', w), step(0).takes, w.at, w.d]" })
    assert.equal(through[0], 'gain(-6)', JSON.stringify(through))
    assert.ok(Math.abs(through[1] - 6) < .01, `6 dB less after it: ${through[1]}`)
    assert.ok(through[2] < -6, `what it takes out, a half of it less: ${through[2]}`)
    assert.equal(through[3], null, 'trim changes the timing: nothing taken to say')
    assert.ok(Math.abs(through[4] - 1) < 1e-3 && Math.abs(through[5] - 1) < 1e-3, `nothing after it moves the time: ${through.slice(4)}`)
    assert.equal((await call('step', { index: 3, on: false, at: 1, d: 1 })).result.ok, true)
    assert.equal((await call('state')).result.steps[3].call, 'gain(-6, { mix: { t: [0.99, 1, 2, 2.01], v: [1, 0, 0, 1] } })')
    const { result: kept } = await call('measure', { code: "[out.stat('db', { at: 1.2, d: 0.6 }) - step(3).before.stat('db', { at: 1.2, d: 0.6 }), out.stat('db', { at: 3, d: 1 }) - step(3).before.stat('db', { at: 3, d: 1 })]" })
    assert.ok(Math.abs(kept[0]) < .01 && Math.abs(kept[1] + 6) < .01, `off there alone: ${kept}`)
    assert.equal((await call('step', { index: 3, on: true, at: 1, d: 1 })).result.ok, true)
    assert.equal((await call('state')).result.steps[3].call, 'gain(-6)', 'on again everywhere: no mix')
    assert.equal((await call('step', { index: 3, call: 'gain(-3)' })).result.ok, true)
    assert.equal((await call('state')).result.steps[3].call, 'gain(-3)', 'written anew')
    const { result: delta } = await call('look', { step: 3, takes: true, at: 1, d: 1 })
    assert.match(delta.image, /^data:image\/png;base64,/)
    assert.equal((await call('state')).result.shown, null, 'looked at, the panel as it was')
    assert.match((await call('look', { step: 0, takes: true })).error, /changes the timing/)
    await call('play', { step: 2 })
    assert.deepEqual((await call('state')).result.shown, { step: 2, takes: false }, 'heard up to it, its card chosen')
    await call('play')
    assert.equal((await call('state')).result.shown, null, 'the whole chain again')
    await call('stop')
    await call('script', { code: script })
    // the chat: while it answers, what it runs; then its words as Markdown, the tools it used
    await tab('Agent')
    const box = page.getByRole('textbox', { name: 'A message to the agent' })
    await box.fill('How long is it?')
    await page.keyboard.press('Enter')
    // its call as the user would say it while it runs; its answer read, thinking, the seconds the turn has taken beside
    // it (counted each second); the call done, in its place after the words before it
    await page.locator('.chat-busy', { hasText: 'Reading the sound' }).waitFor()
    await page.locator('.chat-busy', { hasText: /Thinking\s*[1-9]\d*s$/ }).waitFor()
    await page.locator('.chat-message.agent .md strong', { hasText: '6.5 s' }).waitFor()
    assert.deepEqual(await page.locator('.chat-message.agent .md td').allInnerTexts(), ['Peak', '−1.0dB'], 'a table, its code')
    await page.locator('.chat-busy').waitFor({ state: 'detached' })
    assert.deepEqual(await page.locator('.chat-message.agent > *').evaluateAll(els => els.map(e => e.className)), ['md', 'chat-step'])
    assert.deepEqual(await page.locator('.chat-message.agent .chat-step > *').allInnerTexts(), ['Read the sound'], 'the page answered no such call since it began: nothing beside it')
    assert.equal(await page.locator('.chat-message.user').innerText(), 'How long is it?')
    assert.equal(await page.locator('.chat-title').innerText(), 'How long is it?', 'the conversation named by its first words')
    // the next message goes on with the agent's session
    await box.fill('And the peak?')
    await page.keyboard.press('Enter')
    await page.locator('.chat-busy').waitFor()
    await page.locator('.chat-busy').waitFor({ state: 'detached' })
    const resumed = runs().at(-1).argv
    assert.equal(resumed[resumed.indexOf('--resume') + 1], S)
    // each call's answer matched to its call, whatever their order
    const second = page.locator('.chat-message.agent').nth(1)
    assert.deepEqual(await second.locator('.chat-step').evaluateAll(els => els.map(e => [e.querySelector('button, span > span:not(.chat-note)').textContent, e.classList.contains('failed')])), [['Checked against Apple Podcasts', true], ['Measured', false], ['Looked at 0:01.000–0:03.000', false], ['Applied fade(0.02, 0.1)', false]])
    // what the page measured, under it, stat by stat as the check's rules are in Export
    const measured = await second.locator('.chat-step:has-text("Measured") + .chat-table tr').evaluateAll(rows => rows.map(r => [...r.cells].map(c => c.textContent)))
    assert.equal(measured.length, 2)
    assert.equal(measured[0][0], 'True peak')
    assert.match(measured[0][1], /^−\d+(\.\d+)?dBTP$/)
    assert.equal(measured[1][0], 'Loudness')
    assert.match(measured[1][1], /^−\d+(\.\d+)?LUFS$/)
    assert.equal(await second.locator('.chat-table').count(), 1, 'the check refused: no table')
    // a step's place on the sound, a click away
    await second.getByRole('button', { name: 'Looked at 0:01.000–0:03.000' }).click()
    assert.deepEqual((await call('state')).result.selection, [1, 3])
    await second.getByRole('button', { name: 'Applied fade(0.02, 0.1)' }).click()
    assert.equal(await page.locator('.step.chosen .step-name').innerText(), 'Fade', 'its card chosen among the edits')
    await tab('Agent')
    // reloaded, the conversation is back; a new one starts empty, the old a click away
    await page.reload()
    await page.locator('.chat-message.user').nth(1).waitFor()
    assert.deepEqual(await page.locator('.chat-message.user').allInnerTexts(), ['How long is it?', 'And the peak?'])
    await page.getByRole('button', { name: 'New conversation' }).click()
    assert.equal(await page.locator('.chat-message').count(), 0)
    assert.equal(await page.locator('.chat-title').innerText(), 'New conversation')
    await page.locator('.chat-title').click()
    await page.locator('#chats-menu .chat-item', { hasText: 'How long is it?' }).locator('.menu-item').click()
    assert.equal(await page.locator('.chat-message.user').count(), 2)
    // another tab, the same conversation: the agent's, not the tab's
    await page.getByRole('button', { name: 'New tab' }).click()
    assert.equal(await page.locator('.chat-message.user').count(), 2, 'shown still')
    assert.equal(await page.locator('.chat-title').innerText(), 'How long is it?')
    // deleted, it goes; none left, nor the list of them
    await page.locator('.chat-title').click()
    await page.getByRole('button', { name: 'Delete How long is it?' }).click()
    assert.equal(await page.locator('.chat-message').count(), 0)
    assert.equal(await page.locator('.chat-head').count(), 0, 'none left')
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')).chats), undefined, 'nor kept')
    // a file of the user's machine, read through the bridge, in the tab shown, which is empty
    const opened = await call('open', { path: fileURLToPath(new URL('../fixture.wav', import.meta.url)) })
    assert.deepEqual([opened.result.ok, opened.result.name], [true, 'fixture.wav'], JSON.stringify(opened))
    assert.equal(await page.locator('.file.current').innerText(), 'fixture.wav')
    assert.match((await call('open', { path: fileURLToPath(new URL('../../package.json', import.meta.url)) })).error, /Not an audio or video file/)
    errors.splice(0, Infinity, ...errors.filter(e => !/ 415 /.test(e)))  // the browser's own word on the refusal, asked for
  } finally { proc.kill() }
})

// Conversations an earlier page kept with each tab come back as the page's: every tab's, a closed one's too, the oldest
// first, the one the tab shown had open, open; shown whichever tab shows, and kept so
test('editor: conversations kept with each tab come back as the page\'s, whichever tab shows', async () => {
  const chat = (id, title) => ({ id, at: id, title, agent: 'claude', session: null, messages: [{ role: 'user', text: title }, { role: 'agent', parts: [{ text: 'Done.' }] }] })
  await page.addInitScript(old => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('audio-repl', JSON.stringify(old)) } }, {
    doc: 1,
    docs: [{ code: "audio('chime.wav')", chats: [chat(1, 'First')], chat: 1 }, { code: "audio('chime.wav').gain(-3)", chats: [chat(3, 'Third')], chat: 3 }],
    closed: [{ code: "audio('chime.wav').gain(-6)", chats: [chat(2, 'Second')], chat: 2, at: 0, shut: 1 }]
  })
  await open()
  await tab('Agent')
  assert.equal(await page.locator('.chat-title').innerText(), 'Third', 'the one the tab shown had open')
  await page.locator('.chat-title').click()
  assert.deepEqual(await page.locator('#chats-menu .chat-item .menu-item').allInnerTexts().then(t => t.map(s => s.split('\n')[0])), ['Third', 'Second', 'First'], 'every tab\'s, newest first')
  await page.keyboard.press('Escape')
  await page.locator('.file').first().click()
  await page.waitForFunction(() => document.querySelector('.file.current') === document.querySelector('.file'))
  assert.equal(await page.locator('.chat-title').innerText(), 'Third', 'another tab: the same conversation')
  assert.deepEqual(await page.locator('.chat-message.user').allInnerTexts(), ['Third'])
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('audio-repl')))
  assert.deepEqual([kept.chats.map(c => c.title), kept.chat, kept.docs.some(d => 'chats' in d)], [['First', 'Second', 'Third'], 3, false], 'kept as the page\'s')
})
