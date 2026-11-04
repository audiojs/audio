// The script as code.js reads and writes it, and as the CLI runs it; the words the page says of it (doing, markdown,
// help, icons, time); the server, the page and the helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import audio from '../../audio.js'
import { prepare, error, bare, chain, append, source, callAt, setArg, cli, groups, steps, dropStep, moveStep, moveLines, group, ungroup, renameGroup, turnOff, turnOn, tracks, focus, toTrack, voiceTrack, stemTracks, soundOf, written, addTrack, dropTrack, renameTrack, splitOf, master, addMaster, rollback, stages, sharing, residual, takes, carried, useTake, retake, addTake, dropTake, raise } from '../../playground/code.js'
import { ops, guides, previews, SCALES } from '../../playground/ops.js'
import { SCALES as NOTE_SCALES, snapMidi } from '@audio/note'
import { help, layout, layouts, texts } from '../../playground/help.js'
import opIcons from '../../playground/icons.js'
import clock from '../../playground/time.js'
import recipes from '../../playground/recipes.js'
import md from '../../playground/markdown.js'
import doing, { measures, noted } from '../../playground/doing.js'
import { sine, wavBytes } from './page.js'

// What the agent does while it answers (doing.js), as the page's user would say it, from the call alone
test('doing: an agent\'s tool call said as the user would say it, only what the call names', () => {
  const time = t => `${t}s`, spec = k => ({ podcast: 'Apple Podcasts' })[k] ?? k
  const say = (tool, input) => doing(tool, input, { time, spec }).now
  assert.equal(say('state', {}), 'Reading the sound')
  assert.equal(say('measure', { code: "out.stat(['loudness', 'truepeak', 'lra'])" }), 'Measuring loudness, true peak, and loudness range')
  assert.equal(say('measure', { code: "out.stat('loudness', { bins: 35 })" }), 'Measuring loudness over time')
  assert.equal(say('measure', { code: "src.stat('dialog')" }), 'Measuring dialogue loudness of the original')
  assert.equal(say('measure', { code: 'out.silence({ threshold: -45 })' }), 'Measuring pauses')
  assert.equal(say('measure', { code: 'out.duration' }), 'Measuring', 'no stat named: no guess')
  assert.equal(say('look', { at: 1, d: 2 }), 'Looking at 1s–3s')
  assert.equal(say('look', {}), 'Looking at the picture')
  assert.equal(say('edit', { call: "normalize('podcast')" }), "Applying normalize('podcast')")
  assert.equal(say('edit', { call: "mark(12.5, 'hum')" }), 'Marking “hum” at 12.5s')
  assert.equal(say('edit', { call: "mark({ at: 2, d: 1.5 }, 'chorus')" }), 'Marking “chorus” 2s–3.5s')
  assert.equal(say('check', { spec: 'podcast' }), 'Checking against Apple Podcasts')
  assert.equal(say('play', { original: true, at: 4 }), 'Playing the original from 4s')
  assert.equal(say('select', { cursor: 0 }), 'Putting the caret at 0s')
  assert.equal(say('Bash', { command: 'ls ~/Downloads', description: 'List the downloads' }), 'List the downloads', 'the agent\'s own words for it')
  assert.equal(say('command_execution', { command: 'ffprobe a.wav\nmore' }), 'Running ffprobe a.wav')
  assert.equal(say('Read', { file_path: '/Users/me/voice.wav' }), 'Reading voice.wav')
  assert.equal(say('WebFetch', { url: 'not a url' }), 'Reading a page')
  assert.equal(say('measure'), 'Measuring', 'no input')
  assert.equal(say('mcp_unknown', {}), 'mcp_unknown', 'a tool it does not know, by its name')
  // once done, the same in the past
  assert.deepEqual(doing('measure', { code: "out.stat('lra')" }), { now: 'Measuring loudness range', then: 'Measured loudness range', show: null })
  assert.deepEqual(doing('edit', { call: "mark(1, 'breath')" }, { time }), { now: 'Marking “breath” at 1s', then: 'Marked “breath” at 1s', show: { caret: 1 } })
  assert.deepEqual(doing('undo', {}), { now: 'Undoing', then: 'Undid', show: null })
  assert.deepEqual(doing('Bash', { description: 'List the downloads' }), { now: 'List the downloads', then: 'List the downloads', show: null })
  // where on the sound it acted, to go to
  assert.deepEqual(doing('select', { at: 1, d: 2, low: 3000, high: 4000 }, { time }), { now: 'Selecting 1s–3s, 3kHz–4kHz', then: 'Selected 1s–3s, 3kHz–4kHz', show: { range: [1, 3], band: [3000, 4000] } })
  assert.deepEqual(doing('edit', { call: "normalize('podcast')" }).show, { edit: "normalize('podcast')" })
  assert.deepEqual(doing('scrub', { at: 1, to: 3 }, { time }), { now: 'Scrubbing 1s–3s', then: 'Scrubbed 1s–3s', show: { caret: 3 } })
  assert.equal(doing('step', { index: 2, to: 0 }).then, 'Moved edit 3 to 1')
  assert.equal(doing('step', { index: 0, on: false }).then, 'Turned off edit 1')
  assert.equal(doing('open', { path: '/Users/me/voice.wav' }).then, 'Opened voice.wav')
})

// What a call came to, said beside its step: values in their units, a series by its span, an edit by the output after it
test('doing: what a call came to, from what the page answered', () => {
  assert.equal(noted('measure', { code: "out.stat(['loudness', 'truepeak'])" }, [-21.123, -0.913]), '−21.12LUFS, −0.91dBTP')
  assert.equal(noted('measure', { code: "out.stat('loudness', { bins: 4 })" }, [-20, -21, '-Infinity', -19]), '4 values, −21\u00a0to\u00a0−19LUFS', 'silence left out of the span, the span held together')
  assert.equal(noted('measure', { code: "out.stat('db')" }, '-Infinity'), '−∞dBFS')
  assert.equal(noted('measure', { code: 'out.duration' }, 6.524), '6.52')
  assert.equal(noted('measure', { code: 'out.silence()' }, [{ at: 1, duration: .5 }]), '[{"at":1,"duration":0.5}]')
  assert.equal(noted('measure', { code: 'x' }, 'a'.repeat(80)).length, 60, 'long, cut')
  assert.equal(noted('measure', { code: 'x' }, undefined), '')
  assert.equal(noted('edit', { call: 'gain(-3)' }, { ok: true, duration: 6, loudness: -16.04, peak: -1 }), 'now −16.04LUFS, peak −1dBFS')
  assert.equal(noted('edit', { call: 'nope()' }, { ok: false, problem: 'nope is not a function' }), 'nope is not a function')
  assert.equal(noted('check', { spec: 'podcast' }, { pass: false, rules: [{ name: 'Loudness', pass: false }, { name: 'True peak', pass: true }] }), 'fails loudness')
  assert.equal(noted('check', { spec: 'podcast' }, { pass: true, rules: [] }), 'passes')
  assert.equal(noted('play', {}, { playing: true }), '')
  assert.equal(noted('state', {}, { duration: 6.4, sampleRate: 44100, channels: 2 }), '6.4s, 2 ch, 44.1kHz')
  assert.equal(noted('state', {}, { duration: 0, sampleRate: null, channels: null, problem: null }), 'no sound open', 'a new tab: no sound, not "null ch"')
  assert.equal(noted('state', {}, { duration: 0, sampleRate: null, channels: null, problem: 'nope is not defined' }), 'nope is not defined', 'a script that fails: why')
  assert.equal(noted('measure', { code: 'x' }, { nf: -49.3 }, [{ of: 'out', name: 'noisefloor', opts: {}, value: -49.30758 }]), '−49.31dBFS', 'one stat noted: its value, whatever the answer')
  assert.equal(noted('measure', { code: 'x' }, { a: 1, b: 2 }, [{ name: 'db', value: -1 }, { name: 'lra', value: 4 }]), '', 'several: the table says them')
})

// What a measure measured, stat by stat as the page noted it (worker.js evaluate), as rows: its name, where it was taken,
// its value as the page writes it. Peak and RMS are sample values (stats.js), their dBFS is db
test('doing: what a measure measured, stat by stat, its rows', () => {
  const time = t => `${t}s`, row = (name, value, opts = {}, of = 'out') => measures([{ of, name, opts, value }], { time })[0]
  assert.deepEqual(row('loudness', -27.20224), { name: 'Loudness', after: '−27.2LUFS' })
  assert.deepEqual(row('truepeak', -14.659), { name: 'True peak', after: '−14.66dBTP' })
  assert.deepEqual(row('noisefloor', -51.57, {}, 'src'), { name: 'Noise floor, original', after: '−51.57dBFS' })
  assert.deepEqual(row('peak', .30049), { name: 'Peak', after: '0.3' })
  assert.deepEqual(row('correlation', 1), { name: 'Stereo correlation', after: '1' })
  assert.deepEqual(row('centroid', 2079.7), { name: 'Brightness', after: '2.08kHz' })
  assert.deepEqual(row('loudness', [-20, -21, '-Infinity', -19, 'NaN'], { bins: 5 }), { name: 'Loudness over time', after: '5 values, −21\u00a0to\u00a0−19LUFS' })
  assert.deepEqual(row('db', -3, { at: 1, d: 2, channel: 0 }), { name: 'Peak, 1s–3s, channel 1', after: '−3dBFS' })
  assert.deepEqual(row('spectrum', Array(64).fill(-40), { bins: 64 }), { name: 'Spectrum', after: '64 bands' })
  assert.deepEqual(row('silence', [{ at: 1, duration: .5 }, { at: 3, duration: 1.25 }]), { name: 'Pauses', after: '2, the longest 1.25s' })
  assert.deepEqual(row('silence', []), { name: 'Pauses', after: 'none' })
  assert.deepEqual(row('clipping', []), { name: 'Clipping', after: 'none' })
  assert.deepEqual(row('onsets', [0, 1.5]), { name: 'Onsets', after: '2' })
  assert.deepEqual(row('key', { tonic: 9, mode: 'minor', label: 'Am' }), { name: 'Key', after: 'Am' })
  assert.deepEqual(row('detect', { bpm: 120, beats: [0, .5] }), { name: 'Tempo', after: '120 BPM' })
  assert.deepEqual(row('replaygain', { gain: -6.0876, lufs: -11.9 }), { name: 'ReplayGain', after: '−6.09dB' })
  assert.deepEqual(row('notes', [{ midi: 64, note: 'E4' }, { midi: 57, note: 'A3' }]), { name: 'Notes', after: '2, A3 to E4' })
  assert.deepEqual(row('melody', { times: [0, 1, 2], f0: [220, 0, 440], voiced: [true, false, true] }), { name: 'Melody', after: '220Hz to 440Hz' })
  assert.deepEqual(measures(undefined), [])
})

// The agent's words (markdown.js): what it writes as GitHub renders it, every character escaped, links only to the web
test('markdown: an agent\'s answer as GitHub shows it, nothing in it markup of its own', () => {
  assert.equal(md('**To meet the spec:** raise it 5 dB. `normalize(\'podcast\')` keeps\nthe peak.'), '<p><strong>To meet the spec:</strong> raise it 5 dB. <code>normalize(&#39;podcast&#39;)</code> keeps\nthe peak.</p>')
  assert.equal(md('| | Value |\n|---|--:|\n| Loudness | −21.1 LUFS |'), '<div class="md-table"><table><thead><tr><th></th><th class="right">Value</th></tr></thead><tbody><tr><td>Loudness</td><td class="right">−21.1 LUFS</td></tr></tbody></table></div>')
  assert.equal(md('1. **One**\n   - a\n   - b\n2. Two'), '<ol><li><strong>One</strong><ul><li>a</li><li>b</li></ul></li><li>Two</li></ol>')
  assert.equal(md('- a\n\n- b'), '<ul><li><p>a</p></li><li><p>b</p></li></ul>', 'loose')
  assert.equal(md('## Add\n\n> said\n\n---'), '<h2>Add</h2><blockquote><p>said</p></blockquote><hr>')
  assert.equal(md('```js\nx < 1 && y\n```'), '<pre><code>x &lt; 1 &amp;&amp; y</code></pre>')
  assert.equal(md('```\nstill coming'), '<pre><code>still coming</code></pre>', 'an open fence, as it streams in')
  assert.equal(md('snake_case and 5 * 3 * 2, ~~gone~~ \\*kept\\*'), '<p>snake_case and 5 * 3 * 2, <del>gone</del> *kept*</p>')
  assert.equal(md('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://a.dev/?q=1&r=2)'), '<p>&lt;img src=x onerror=alert(1)&gt; x) <a href="https://a.dev/?q=1&amp;r=2" target="_blank" rel="noopener noreferrer">y</a></p>')
  assert.equal(md('see https://audiojs.dev/editor.'), '<p>see <a href="https://audiojs.dev/editor" target="_blank" rel="noopener noreferrer">https://audiojs.dev/editor</a>.</p>')
  assert.equal(md('line  \nbreak'), '<p>line<br>break</p>')
})

// Layers, as the edits panel moves them: a step before or after another, set in as that one is, so into a group or out of
// one; a group moved whole among the steps outside groups; steps made a group under a comment of its name, the group
// unmade or named anew; a step put in right after another (append's `after`); a step turned off and on by its comment
// marks alone, its text where it was
test('code: layers moved by their lines, made a group, unmade, named; a step put in after another; turned off by its marks', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const a = `audio('a.wav')\n  .gain(-3)\n  .reverse()\n  .highpass(80)\n  .fade(1)`, at = (code, name) => { const s = steps(code).find(s => s.name === name).call; return { from: s.from, to: s.to } }
  const g = apply(a, group(a, 1, 2, 'Montage'))
  assert.equal(g, `audio('a.wav')\n  .gain(-3)\n  // Montage\n    .reverse()\n    .highpass(80)\n  .fade(1)`)
  assert.deepEqual(groups(g).map(x => x.name), ['Montage'])
  assert.equal(group(g, 0, 1), null, 'not across a group')
  const [m] = groups(g)
  assert.equal(apply(g, moveLines(g, at(g, 'fade'), m, { into: true })), `audio('a.wav')\n  .gain(-3)\n  // Montage\n    .fade(1)\n    .reverse()\n    .highpass(80)`, 'into the group, first')
  assert.equal(apply(g, moveLines(g, at(g, 'gain'), at(g, 'highpass'), { after: true })), `audio('a.wav')\n  // Montage\n    .reverse()\n    .highpass(80)\n    .gain(-3)\n  .fade(1)`, 'set in as the step it lands by')
  assert.equal(apply(g, moveLines(g, at(g, 'reverse'), at(g, 'fade'), { after: true })), `audio('a.wav')\n  .gain(-3)\n  // Montage\n    .highpass(80)\n  .fade(1)\n  .reverse()`, 'out of it')
  assert.equal(apply(g, moveLines(g, m, at(g, 'fade'), { after: true })), `audio('a.wav')\n  .gain(-3)\n  .fade(1)\n  // Montage\n    .reverse()\n    .highpass(80)`, 'a group whole')
  assert.equal(moveLines(g, m, at(g, 'reverse')), null, 'not into itself')
  assert.equal(apply(g, ungroup(g, m)), a)
  assert.equal(apply(g, renameGroup(g, m, ' Cuts ')), g.replace('Montage', 'Cuts'))
  assert.equal(renameGroup(g, m, '  '), null)
  assert.equal(apply(a, append(a, 'gain(-6)', at(a, 'gain').to)), `audio('a.wav')\n  .gain(-3)\n  .gain(-6)\n  .reverse()\n  .highpass(80)\n  .fade(1)`)
  const b = `audio('a.wav').gain(-3).fade(1)`
  assert.equal(apply(b, append(b, 'trim()', b.indexOf('.fade'))), `audio('a.wav').gain(-3).trim().fade(1)`, 'on one line')
  const c = `audio('a.wav').gain(-3).fade(1)`, off = apply(c, turnOff(c, chain(c).calls[0]))
  assert.equal(off, `audio('a.wav')/* .gain(-3) */.fade(1)`)
  assert.equal(apply(off, turnOn(off, steps(off)[0].call)), c)
  // one turned off, set where it stands, in its comment: the script runs as it did
  const d = `audio('a.wav')\n  // .gain(-3)\n  .fade(1)`, set = apply(d, setArg(steps(d)[0].call, 0, -6))
  assert.equal(set, `audio('a.wav')\n  // .gain(-6)\n  .fade(1)`)
  assert.equal(apply(off, setArg(steps(off)[0].call, 0, -6)), `audio('a.wav')/* .gain(-6) */.fade(1)`)
  const e = `audio('a.wav')/* .gate({ threshold: -40 }) */`
  assert.equal(apply(e, setArg(steps(e)[0].call, 'threshold', -50)), `audio('a.wav')/* .gate({ threshold: -50 }) */`)
  const f = `audio('a.wav')\n  // .fade()`
  assert.equal(apply(f, setArg(steps(f)[0].call, 0, .5)), `audio('a.wav')\n  // .fade(0.5)`, 'its first setting')
  assert.equal(bare(set), bare(d), 'comments aside, the same script')
  assert.notEqual(bare(c), bare(off), 'a step turned off is another')
  assert.equal(bare(`a /* b\nc */ d // e`), `a  \n  d  `, 'its line breaks kept')
})

// Takes: recordings of one place, a write() of each side by side, one heard, the others turned off. One recorded where
// another went in joins it, after it, heard, the one heard before turned off, the steps after them kept after them; one
// turned on is heard alone. A write of a sound made in the script, or with more than where it goes, is no take
test('code: takes of one place side by side, one heard; another recorded there joins them; one turned on, the others off', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const at2 = name => `write(audio('${name}'), { at: 2 })`
  const a = `audio('a.wav')\n  .gain(-3)\n  .write(audio('take.wav'), { at: 2 })\n  .fade(1)`
  assert.deepEqual(takes(a).map(r => [r.at, r.list.map(x => [x.name, x.on])]), [[2, [['take.wav', true]]]], 'a recording alone, a take of one')
  const b = apply(a, retake(a, at2('take-2.wav')))
  assert.equal(b, `audio('a.wav')\n  .gain(-3)\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })\n  .fade(1)`)
  const c = apply(b, retake(b, at2('take-3.wav')))
  assert.deepEqual(takes(c).map(r => r.list.map(x => [x.name, x.on])), [[['take.wav', false], ['take-2.wav', false], ['take-3.wav', true]]])
  assert.equal(retake(c, `write(audio('x.wav'), { at: 3 })`), null, 'another place: none there')
  assert.equal(retake(c, `gain(-1)`), null, 'no recording')
  const [run] = takes(c), first = apply(c, useTake(c, run.list[0].from))
  assert.equal(first, `audio('a.wav')\n  .gain(-3)\n  .write(audio('take.wav'), { at: 2 })\n  // .write(audio('take-2.wav'), { at: 2 })\n  // .write(audio('take-3.wav'), { at: 2 })\n  .fade(1)`)
  assert.equal(useTake(first, takes(first)[0].list[0].from), null, 'heard alone already')
  assert.equal(useTake(first, steps(first).find(s => s.name === 'fade').call.from), null, 'no take')
  // on one line: turned off within it, the new one after the sound
  const d = `audio('a.wav').write(audio('take.wav'), { at: 2 })`, e = apply(d, retake(d, at2('take-2.wav')))
  assert.deepEqual(takes(e).map(r => r.list.map(x => [x.name, x.on])), [[['take-2.wav', true], ['take.wav', false]]])
  // no takes: a sound made in the script, a write with more than its place and its length, two places apart
  assert.deepEqual(takes(`audio('a.wav')\n  .write(audio('b.wav').gain(-3), { at: 2 })\n  .write(audio('c.wav'), { at: 2, channel: 1 })`), [])
  assert.deepEqual(takes(`audio('a.wav')\n  .write(audio('b.wav'), { at: 2 })\n  .write(audio('c.wav'), { at: 3 })`).map(r => r.list.length), [1, 1])
  // nothing to read or join: no script, a group of calls, a take in the steps a copy shares (its own part's alone join)
  assert.deepEqual([takes(''), useTake('', 0), retake('', at2('t.wav')), retake(a, { name: 'Group', calls: ['gain(-1)'] })], [[], null, null, null])
  const g = `let take = audio('a.wav')\n  .write(audio('take.wav'), { at: 2 })\n\nlet copy = take.clone()\n  .gain(-1)`
  assert.equal(retake(g, at2('take-2.wav')), null, 'not into the steps it shares')
  assert.deepEqual(takes(g).map(r => r.part), [0])
})

// An empty take added to a place (+ on its numbers): silence as long as the place, heard, the others off; no second while
// it is there; a recording there goes into it, heard. The take heard deleted, the one before heard in its place
test('code: an empty take added, recorded into; the one heard deleted, the one before heard', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const a = `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`
  const b = apply(a, addTake(a, takes(a)[0], 1.5))
  assert.equal(b, `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  // .write(audio('take-2.wav'), { at: 2 })\n  .write(audio.from(1.5), { at: 2 })`)
  assert.deepEqual(takes(b)[0].list.map(x => [x.name, x.on, x.empty ?? null]), [['take.wav', false, null], ['take-2.wav', false, null], ['', true, 1.5]])
  assert.equal(addTake(b, takes(b)[0], 1.5), null, 'one empty take at a time')
  // recorded into, the empty one heard or not
  // (the place's length kept: what is not recorded of it is silence, not what was there before)
  const filled = `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  // .write(audio('take-2.wav'), { at: 2 })\n  .write(audio('take-3.wav'), { at: 2, d: 1.5 })`
  assert.equal(apply(b, retake(b, `write(audio('take-3.wav'), { at: 2 })`)), filled)
  const off = apply(b, useTake(b, takes(b)[0].list[0].from))
  assert.equal(apply(off, retake(off, `write(audio('take-3.wav'), { at: 2 })`)), filled)
  // the one heard deleted, the one before heard; the first deleted, the next
  assert.deepEqual(takes(filled)[0].list.map(x => x.d ?? null), [null, null, 1.5])
  // another recorded there writes over the place too
  assert.match(apply(filled, retake(filled, `write(audio('take-4.wav'), { at: 2 })`)), /\.write\(audio\('take-4\.wav'\), \{ at: 2, d: 1\.5 \}\)$/)
  assert.equal(apply(filled, dropTake(filled, takes(filled)[0].list[2].from)), `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`)
  const first = apply(filled, useTake(filled, takes(filled)[0].list[0].from))
  assert.equal(apply(first, dropTake(first, takes(first)[0].list[0].from)), `audio('a.wav')\n  .write(audio('take-2.wav'), { at: 2 })\n  // .write(audio('take-3.wav'), { at: 2, d: 1.5 })`)
  assert.equal(dropTake(a, 999), null, 'no take there')
})

// Takes under a write after them over their place (a recording at another caret): one more recorded there brings them
// over it, the newest heard (it once stayed under it, unheard, the picture going back to what covered it as it stopped);
// past writes alone, which sound the same in either order where they cover nothing of each other's place, those that
// don't cover it (as long as their files are, `len`; one of no length known may) left after them
test('code: takes under a later write brought over it as one more is recorded there, past writes alone', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const at2 = name => `write(audio('${name}'), { at: 2 })`, len = name => ({ 'take.wav': 3, 'take-2.wav': 3, 'over.wav': 2, 'far.wav': 1 })[name]
  // over.wav, 3 to 5 s, over their place, 2 to 5: they go after it, as they stood, the new one heard; the fade after
  // them still after them
  const a = `audio('a.wav')\n  .write(audio('take.wav'), { at: 2 })\n  .write(audio('over.wav'), { at: 3 })\n  .fade(1)`
  assert.equal(apply(a, retake(a, at2('take-2.wav'), len)), `audio('a.wav')\n  .write(audio('over.wav'), { at: 3 })\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })\n  .fade(1)`)
  // far.wav, 6 to 7 s, past it: left after them, the takes where they stand; of no length known, it may cover it
  const b = `audio('a.wav')\n  .write(audio('take.wav'), { at: 2 })\n  .write(audio('far.wav'), { at: 6 })`
  assert.equal(apply(b, retake(b, at2('take-2.wav'), len)), `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })\n  .write(audio('far.wav'), { at: 6 })`)
  assert.equal(apply(b, retake(b, at2('take-2.wav'))), `audio('a.wav')\n  .write(audio('far.wav'), { at: 6 })\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`)
  // a step that changes the sound between: past it, it would no longer change them; none (the page writes the
  // recording on top, a take of its own)
  const c = `audio('a.wav')\n  .write(audio('take.wav'), { at: 2 })\n  .gain(-3)\n  .write(audio('over.wav'), { at: 3 })`
  assert.equal(retake(c, at2('take-2.wav'), len), null)
  assert.equal(raise(c, takes(c)[0], len), null)
  // as they stand, turned off or heard, past a step turned off; nothing over them, as it is
  const d = `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })\n  // .gain(-3)\n  .write(audio('over.wav'), { at: 3 })`
  assert.equal(raise(d, takes(d)[0], len), `audio('a.wav')\n  // .gain(-3)\n  .write(audio('over.wav'), { at: 3 })\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`)
  assert.equal(raise(b, takes(b)[0], len), b)
  // an empty take added there brought over it too, heard, for the next recording to go into
  assert.equal(apply(d, addTake(d, takes(d)[0], 3, len)), `audio('a.wav')\n  // .gain(-3)\n  .write(audio('over.wav'), { at: 3 })\n  // .write(audio('take.wav'), { at: 2 })\n  // .write(audio('take-2.wav'), { at: 2 })\n  .write(audio.from(3), { at: 2 })`)
})

// Where takes' place is once the steps after them are done: where it was past a step that keeps time (a fade, a marker,
// a delete past its end, a step turned off); a delete before it moves it back by as much, one over its end cuts it
// short, a crop moves it to the crop's start, a pad on by the silence before; gone with a delete of all of it; unknown
// past a step whose time the script alone doesn't say (a trim)
test('code: takes\' place carried through the steps after them', () => {
  const a = `audio('a.wav')\n  // .write(audio('take.wav'), { at: 2 })\n  .write(audio('take-2.wav'), { at: 2 })`
  const at = tail => { const code = `${a}\n  ${tail}`; return carried(code, takes(code)[0], [2, 5]) }
  assert.deepEqual(carried(a, takes(a)[0], [2, 5]), [2, 5])
  for (const tail of ['.fade(1)', '.mark(1, \'A\')', '.remove({ at: 7, d: 2 })', '.remove({ at: 5, d: 1 })', '// .trim()', '.gain(-3, { at: 0, d: 1 })']) assert.deepEqual(at(tail), [2, 5], tail)
  assert.deepEqual(at('.remove({ at: 0.5, d: 1 })'), [1, 4], 'a delete before it')
  assert.deepEqual(at('.cut({ at: 0, d: 0.5, xfade: 0.01 })'), [1.5, 4.5], 'a cut before it, crossfaded: as long as without')
  assert.deepEqual(at('.remove({ at: 4, d: 2 })'), [2, 4], 'a delete over its end')
  assert.deepEqual(at('.remove(1, 2)'), [1, 3], 'its place and length as arguments')
  assert.deepEqual(at('.crop({ at: 1, d: 10 })'), [1, 4])
  assert.deepEqual(at('.pad(1, 2)'), [3, 6])
  // a delete ending where it starts, or starting where it ends, at the boundary: moved back whole, or left as it is
  assert.deepEqual([at('.remove({ at: 1, d: 1 })'), at('.remove({ at: 5, d: 1 })')], [[1, 4], [2, 5]])
  assert.deepEqual([at('.remove({ at: 1, d: 6 })'), at('.crop({ at: 0, d: 1 })'), at('.trim()'), at('.speed(2)'), at('.remove({ at: start, d: 1 })'), at('.remove({ at: -1, d: 1 })'), at('.remove({ at: 1 })'), at('.pad({ before: 1 })')], [null, null, null, null, null, null, null, null], 'gone, or not for the script to say')
  // one after another, each where the one before left it
  assert.deepEqual(at('.remove({ at: 9, d: 1 })\n  .remove({ at: 0, d: 1 })\n  .pad(0.5)'), [1.5, 4.5])
})

// The chain's edits as an agent acts on them (step): listed in order, those turned off among them; one taken away,
// on its line or within one; one moved, before or after another, a group's comment staying where it stands
test('code: the edits listed in order, one taken away or moved where it stands', () => {
  const apply = (code, change) => [change].flat().sort((p, q) => q.from - p.from).reduce((c, x) => c.slice(0, x.from) + (x.insert ?? '') + c.slice(x.to ?? x.from), code)
  const a = `audio('a.wav')\n  .trim()\n  // .gain(-3)\n  .normalize(-1)\n  .fade(0.1)`
  assert.deepEqual(steps(a).map(s => [s.text, s.on]), [['.trim()', true], ['.gain(-3)', false], ['.normalize(-1)', true], ['.fade(0.1)', true]])
  assert.equal(apply(a, moveStep(a, 0, 3)), `audio('a.wav')\n  // .gain(-3)\n  .normalize(-1)\n  .fade(0.1)\n  .trim()`, 'to the end')
  assert.equal(apply(a, moveStep(a, 3, 0)), `audio('a.wav')\n  .fade(0.1)\n  .trim()\n  // .gain(-3)\n  .normalize(-1)`, 'to the start')
  assert.equal(apply(a, moveStep(a, 2, 1)), `audio('a.wav')\n  .trim()\n  .normalize(-1)\n  // .gain(-3)\n  .fade(0.1)`, 'before one turned off')
  assert.equal(moveStep(a, 1, 0), null, 'one turned off stays put')
  assert.equal(moveStep(a, 0, 0), null)
  assert.equal(moveStep(a, 0, 9), null)
  assert.equal(apply(a, dropStep(a, 1)), `audio('a.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.1)`, 'one turned off, taken away')
  assert.equal(apply(a, dropStep(a, 0)), `audio('a.wav')\n  // .gain(-3)\n  .normalize(-1)\n  .fade(0.1)`)
  const b = `audio('a.wav').trim().normalize(-1)`
  assert.equal(apply(b, moveStep(b, 1, 0)), `audio('a.wav').normalize(-1).trim()`, 'on one line')
  assert.equal(apply(b, dropStep(b, 0)), `audio('a.wav').normalize(-1)`)
  assert.deepEqual(steps(`audio.from(3).noise({ color: 'pink' }).gain(-3)`).map(s => s.text), [".noise({ color: 'pink' })", '.gain(-3)'], 'audio.from() makes the sound: no edit')
  const c = `audio('a.wav')\n  // Vinyl\n  .declick()\n  .decrackle()`
  assert.equal(apply(c, moveStep(c, 1, 0)), `audio('a.wav')\n  // Vinyl\n  .decrackle()\n  .declick()`, "a group's name stays over it")
  assert.deepEqual([steps(''), dropStep('', 0), moveStep('x', 0, 1)], [[], null, null], 'no chain')
})

// Tracks: sounds declared side by side that nothing else reads, the last of them the script's last statement, returned by
// name; one edited at a time (focus), its chain the one the edits list and every edit joins, the others kept as they are.
// A range moved to a track of its own: cropped and put back at its time; silence where it was. The voice split to one:
// the model's voice there, the rest here. The steps the track had are both parts' then, written once: its sound so far
// declared apart (`chimeTake`), each part a copy of it, its chain those shared steps and then its own
test('code: tracks are the sounds declared that nothing reads, edited one at a time; a range moved to one of its own', () => {
  const apply = (code, change) => code.slice(0, change.from) + change.insert + code.slice(change.to ?? change.from)
  const names = code => tracks(code).map(t => t.name)
  assert.deepEqual(names(`let a = audio('a.wav')\nlet b = audio('b.wav')`), ['a', 'b'])
  assert.deepEqual(names(`let a = audio.from(3).noise()\nconst b = await audio('b.wav').trim()`), ['a', 'b'], 'made, awaited')
  for (const code of [
    `let a = audio('a.wav')`,
    `let a = audio('a.wav')\nlet b = audio('b.wav')\na.mix(b)`,
    `let noise = audio('n.wav')\nlet v = audio('v.wav').denoise({ noise })`,
    `let a = audio('a.wav')\nlet b = a.clone().gain(-3)`,
    `let a = audio('a.wav')\nlet b = audio('b.wav')\nconsole.log(1)`
  ]) assert.deepEqual(names(code), [], code)
  assert.match(prepare(`let a = audio('a.wav')\nlet b = audio('b.wav')`).code, /;return __out\(\{ a, b \}, true\)$/)
  // the sound moved out of: named for its file, declared; the piece under it
  const one = `audio('chime.wav')\n  .trim()\n  .normalize(-1)`, made = toTrack(one, { at: '0.5', d: '0.25' })
  assert.equal(made.name, 'chime2')
  assert.equal(made.code, `let chimeTake = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet chime = chimeTake.clone()\n  .gain(-Infinity, { at: 0.5, d: 0.25 })\n\nlet chime2 = chimeTake.clone()\n  .crop({ at: 0.5, d: 0.25 })\n  .pad(0.5, 0)`)
  assert.equal(toTrack(`audio('chime.wav')`, { at: '0', d: '1' }).code, `let chime = audio('chime.wav')\n  .gain(-Infinity, { at: 0, d: 1 })\n\nlet chime2 = audio('chime.wav')\n  .crop({ at: 0, d: 1 })`, 'from the start: no pad')
  assert.equal(toTrack(`let a = audio('a.wav')\na.gain(-3)`, { at: '0', d: '1' }), null, 'a chain on a name: no sound of its own')
  // the voice split to a track of its own: the model's voice there, the rest here, the chain as it stood under both
  const sung = voiceTrack(one)
  assert.equal(sung.name, 'voice')
  assert.equal(sung.code, `let chimeTake = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet chime = chimeTake.clone()\n  .vocals('remove', { model: 'mel-roformer' })\n\nlet voice = chimeTake.clone()\n  .vocals({ model: 'mel-roformer' })`)
  assert.deepEqual(names(voiceTrack(sung.code).code), ['chime', 'voice', 'voice2'], 'again: the voice, the last, split, named on')
  assert.equal(voiceTrack(`let a = audio('a.wav')\na.gain(-3)`), null, 'a chain on a name: no sound of its own')
  // four stems to four tracks: the voice, the bass, the drums each alone, the rest (with the residual) here
  const solo = k => `rebalance(${[0, 1, 2, 3].map(i => i === k ? 0 : '-Infinity').join(', ')}, { residual: -Infinity })`, four = stemTracks(one)
  assert.equal(four.name, 'voice')
  assert.equal(four.code, `let chimeTake = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet chime = chimeTake.clone()\n  .rebalance(-Infinity, -Infinity, -Infinity)\n\n${['voice', 'bass', 'drums'].map((n, k) => `let ${n} = chimeTake.clone()\n  .${solo(k)}`).join('\n\n')}`)
  assert.equal(stemTracks(`audio('a.wav')`).code, `let a = audio('a.wav')\n  .rebalance(-Infinity, -Infinity, -Infinity)\n\n${['voice', 'bass', 'drums'].map((n, k) => `let ${n} = audio('a.wav')\n  .${solo(k)}`).join('\n\n')}`, 'no steps: each from the file')
  assert.deepEqual(names(stemTracks(four.code).code), ['chime', 'voice', 'bass', 'drums', 'voice2', 'bass2', 'drums2'], 'again: the last split, named on')
  // a track's sound on one line, for another to line up with: its steps turned off left out, no name read, the sound it
  // copies written into it (a track declared before that sound reads it too)
  assert.equal(soundOf(sung.code, 'voice'), `audio('chime.wav').trim().normalize(-1).vocals({ model: 'mel-roformer' })`)
  assert.equal(soundOf(`let a = await audio('a .wav')\n  // .fade(1)\n  .gain(-3) /* .trim() */  .reverse()\n\nlet b = audio('b.wav')`, 'a'), `audio('a .wav').gain(-3).reverse()`)
  assert.equal(soundOf(sung.code, 'nothing'), null)
  // the sound the page edits, as another tab pastes a piece of it: its sinks (save, play) left out, a comment in one too,
  // the sound a copy starts from written into it; none without a chain
  assert.equal(written(`audio('a.wav')\n  .gain(-3) // louder\n  // .lowpass(200)\n  .fade(0.1)\n  .save('x.wav' /* here */)`), `audio('a.wav').gain(-3).fade(0.1)`)
  assert.equal(written(`let a = audio('a.wav').trim()\nlet b = a.clone().gain(-3).play()`), `audio('a.wav').trim().gain(-3)`)
  assert.equal(written(`audio('a.wav')`), `audio('a.wav')`)
  assert.equal(written(''), null)
  try {
    // the first edited: its steps, an edit joining it, rolled back with the other kept, a measure's stages of it alone
    focus('chime')
    const two = made.code
    assert.deepEqual(steps(two).map(s => [s.text, s.call.part]), [['.trim()', 0], ['.normalize(-1)', 0], ['.gain(-Infinity, { at: 0.5, d: 0.25 })', 1]], 'the shared steps, then its own')
    assert.deepEqual(sharing(two), [['chime2'], []])
    assert.equal(apply(two, append(two, 'reverse()')), two.replace('0.25 })\n\n', '0.25 })\n  .reverse()\n\n'), 'an edit joins its own steps')
    // rolled back into the shared steps: its own statement the sound copied up to there, the other track's as it was
    assert.equal(rollback(two, 1), two.replace(`let chime = chimeTake.clone()\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`, `let chime = audio('chime.wav')\n  .trim()`))
    assert.equal(rollback(two, 2), two.replace(`\n  .gain(-Infinity, { at: 0.5, d: 0.25 })\n\nlet chime2`, `\n\nlet chime2`).replace(`let chime = chimeTake.clone()`, `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)`))
    assert.equal(rollback(two, 0), two.replace(`let chime = chimeTake.clone()\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`, `let chime = audio('chime.wav')`), 'to the sound alone')
    assert.equal(rollback(two, 3), two, 'all of it: as it is')
    assert.ok(stages(two).every(s => s.before.endsWith('\nchime') && s.after.endsWith('\nchime')))
    // what a shared step takes out: the sound before it written out, the step on a copy
    assert.match(residual(two, 1), /\nconst __before = audio\('chime\.wav'\)\n {2}\.trim\(\)\n__before\.clone\(\)\.mix\(__before\.clone\(\)\.normalize\(-1\)/)
    // a step stays in its part: no move or group across the copy
    assert.equal(moveStep(two, 1, 2), null)
    assert.equal(group(two, 1, 2), null)
    // again: the next piece right under it, named on, the steps the track has of its own shared in turn
    const again = toTrack(two, { at: '1', d: '0.5' }).code
    assert.deepEqual(names(again), ['chime', 'chime3', 'chime2'])
    assert.match(again, /let chimeTake2 = chimeTake\.clone\(\)\n {2}\.gain\(-Infinity, \{ at: 0\.5, d: 0\.25 \}\)\n\nlet chime = chimeTake2\.clone\(\)\n {2}\.gain\(-Infinity, \{ at: 1, d: 0\.5 \}\)\n\nlet chime3 = chimeTake2\.clone\(\)/)
    assert.deepEqual(chain(again).parts.map(p => p.name), ['chimeTake', 'chimeTake2', 'chime'])
    // one of three taken away: the sound it shared with one other goes into that one, the one all three share stays
    assert.equal(apply(again, dropTrack(again, 'chime3')), `let chimeTake = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet chime = chimeTake.clone()\n  .gain(-Infinity, { at: 0.5, d: 0.25 })\n  .gain(-Infinity, { at: 1, d: 0.5 })\n\nlet chime2 = chimeTake.clone()\n  .crop({ at: 0.5, d: 0.25 })\n  .pad(0.5, 0)`)
    // a step turned off is the track's own too: shared once it parts, back with the steps when they rejoin
    const muted = toTrack(`let a = audio('a.wav')\n  // .fade(1)`, { at: '0', d: '1' }).code
    assert.equal(muted, `let aTake = audio('a.wav')\n  // .fade(1)\n\nlet a = aTake.clone()\n  .gain(-Infinity, { at: 0, d: 1 })\n\nlet a2 = aTake.clone()\n  .crop({ at: 0, d: 1 })`)
    assert.equal(apply(muted, dropTrack(muted, 'a2')), `let a = audio('a.wav')\n  // .fade(1)\n  .gain(-Infinity, { at: 0, d: 1 })`)
    // steps turned off are each track's own, to the next statement
    const off = `let a = audio('a.wav')\n  .trim()\n  // .fade(1)\n\nlet b = audio('b.wav')\n  // .gain(-3)\n  .reverse()`
    focus('a')
    assert.deepEqual(steps(off).map(s => [s.text, s.on]), [['.trim()', true], ['.fade(1)', false]])
    focus('b')
    assert.deepEqual(steps(off).map(s => [s.text, s.on]), [['.gain(-3)', false], ['.reverse()', true]])
    // a file a track of its own, named for it; a track taken away, its steps and the blank line before it with it
    focus('chime')
    assert.equal(addTrack(one, `audio('My take-2.wav')`, 'My take-2.wav').code, `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n\nlet myTake2 = audio('My take-2.wav')`)
    assert.equal(addTrack(one, `audio('audio.wav')`, 'audio.wav').name, 'sound', 'no name the script cannot take')
    // a file under the track edited; an empty one, made under the lanes, under the last, whichever is edited
    focus('a')
    assert.equal(addTrack(off, `audio('c.wav')`, 'c.wav').code, `let a = audio('a.wav')\n  .trim()\n  // .fade(1)\n\nlet c = audio('c.wav')\n\nlet b = audio('b.wav')\n  // .gain(-3)\n  .reverse()`)
    assert.equal(addTrack(off, 'audio.from(0)', 'track', { last: true }).code, `${off}\n\nlet track = audio.from(0)`)
    focus('chime')
    // the other part taken away, the shared steps go back into the one left: one sound, as before they parted
    assert.equal(apply(two, dropTrack(two, 'chime2')), `let chime = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`)
    assert.equal(apply(two, dropTrack(two, 'chime')), `let chime2 = audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .crop({ at: 0.5, d: 0.25 })\n  .pad(0.5, 0)`)
    assert.equal(apply(off, dropTrack(off, 'a')), `let b = audio('b.wav')\n  // .gain(-3)\n  .reverse()`)
    assert.equal(dropTrack(one, 'chime'), null)
    const three = `let a = audio('a.wav')\n\nlet b = audio('b.wav')\n  .gain(-3)\n\nlet c = audio('c.wav')`
    assert.equal(apply(three, dropTrack(three, 'b')), `let a = audio('a.wav')\n\nlet c = audio('c.wav')`, 'one between others')
    // the step a model's split parted a track by, taken away from any of its parts: the split with it, the sound whole
    // again, the steps shared before it back in it, those after it on that part kept; any other step, itself alone
    const split = stemTracks(one).code + '\n  .gain(-6)'
    for (const name of ['chime', 'voice', 'drums']) {
      focus(name)
      const i = steps(split).findIndex(s => s.name === 'rebalance' && s.call.part === 1)
      assert.equal(apply(split, dropStep(split, i)), `let ${name} = audio('chime.wav')\n  .trim()\n  .normalize(-1)${name === 'drums' ? '\n  .gain(-6)' : ''}`, `the split undone from ${name}`)
    }
    focus('drums')
    assert.equal(apply(split, dropStep(split, steps(split).findIndex(s => s.name === 'gain'))), stemTracks(one).code, 'a step after it: itself alone')
    const bypassed = apply(split, turnOff(split, steps(split).find(s => s.name === 'rebalance' && s.call.part === 1).call))
    assert.equal(apply(bypassed, dropStep(bypassed, steps(bypassed).findIndex(s => s.name === 'rebalance' && !s.on))), split.replace('\n  .rebalance(-Infinity, -Infinity, 0, -Infinity, { residual: -Infinity })', ''), 'turned off, then taken away: itself alone, the split as it was')
    focus('voice')
    const sung2 = voiceTrack(`audio('a.wav')`).code
    assert.equal(apply(sung2, dropStep(sung2, 0)), `let voice = audio('a.wav')`, 'the voice split undone')
    focus('chime')
    assert.equal(apply(two, dropStep(two, 2)), two.replace(`\n  .gain(-Infinity, { at: 0.5, d: 0.25 })`, ''), 'a range moved to a track of its own is no model\'s split: the silence alone')
    assert.deepEqual(splitOf(`let a = audio('a.wav')\n  .vocals()\n\nlet b = audio('b.wav')\n  .vocals()`, 'a'), [], 'another file: no split')
  } finally { focus(null) }
  // none edited: the last
  assert.equal(chain(made.code).declared, 'chime2')
})

// A sidechain's key keeps the track it reads (a voice the bed ducks under is still heard); a master, the last statement a
// copy of one track with the others mixed in, then steps of its own, leaves them tracks and is edited as one: its steps
// those after the mix; tracks made, opened or taken away keep it mixing every track; a key's step goes with its track
// A track named anew as a script names a sound, every reference to it with it (a key that ducks another under it), a
// name no other sound has; a name that makes none, the one it has, or no such track: nothing
test('code: a track renamed, its references with it, to a name of its own', () => {
  const code = "let chime = audio('chime.wav')\n\nlet track = audio.from(0)\n  .write(audio('take.wav'), { at: 1 })\n\nlet bed = audio('rhodes.wav').ducker({ key: track, range: -15 })"
  assert.deepEqual(renameTrack(code, 'track', 'Lead vocal'), { name: 'leadVocal', code: code.replace('let track', 'let leadVocal').replace('key: track', 'key: leadVocal') })
  assert.equal(renameTrack(code, 'track', 'chime').name, 'chime2')
  for (const [from, to] of [['track', '!!!'], ['track', 'track'], ['nope', 'x']]) assert.equal(renameTrack(code, from, to), null, `${from} → ${to}`)
})

test('code: a key keeps a track; a master mixes the tracks, then steps of its own', () => {
  const apply = (code, change) => code.slice(0, change.from) + change.insert + code.slice(change.to ?? change.from)
  const names = code => tracks(code).map(t => t.name)
  const duck = `let voice = audio('v.wav')\n  .deepfilter()\n\nlet bed = audio('m.wav')\n  .ducker({ key: voice, range: -15 })`
  assert.deepEqual(names(duck), ['voice', 'bed'], 'a key: both tracks')
  assert.deepEqual(names(`let voice = audio('v.wav')\nlet bed = audio('m.wav').ducker({ key: voice.clone() })`), ['voice', 'bed'], 'a key a copy of it: both')
  assert.deepEqual(names(`let noise = audio('n.wav')\nlet v = audio('v.wav').denoise({ noise })`), [], 'a noise print feeds the one it learns for')
  assert.equal(master(duck), null)
  const mixed = `${duck}\n\nvoice.clone().mix(bed)\n  .normalize('podcast')`
  assert.deepEqual(names(mixed), ['voice', 'bed'], 'a master: the tracks it mixes')
  assert.deepEqual([master(mixed).name, master(mixed).names], ['master', ['voice', 'bed']])
  assert.match(prepare(mixed).code, /return __out\(\{ voice, bed \}, true, \{ name: "master", value: voice\.clone\(\)\.mix\(bed\)\n {2}\.normalize\('podcast'\) \}\)$/)
  for (const code of [`let a = audio('a.wav')\nlet b = audio('b.wav')\nlet c = audio('c.wav')\na.clone().mix(b)`, `let a = audio('a.wav')\nlet b = audio('b.wav')\na.mix(b)`, `let a = audio('a.wav')\nlet b = audio('b.wav')\na.clone().mix(b, 0, -6)`])
    assert.equal(master(code), null, `not a master: ${code.split('\n').at(-1)}`)
  assert.equal(master(`let master = audio('a.wav')\nlet b = audio('b.wav')\nmaster.clone().mix(b)`).name, 'master2', 'named apart from the tracks')
  try {
    focus('master')
    assert.deepEqual(steps(mixed).map(s => s.text), [".normalize('podcast')"], 'its steps: those after the mix')
    assert.equal(apply(mixed, append(mixed, 'limiter()')), `${mixed}\n  .limiter()`)
    assert.equal(rollback(mixed, 0), `${duck}\n\nvoice.clone().mix(bed)`)
    assert.equal(voiceTrack(mixed), null, 'the master splits into no tracks')
    // a file opened as a track: before the master, mixed into it
    assert.equal(addTrack(mixed, `audio('fx.wav')`, 'fx.wav').code, `${duck}\n\nlet fx = audio('fx.wav')\n\nvoice.clone().mix(bed).mix(fx)\n  .normalize('podcast')`)
    // the master taken away: the tracks as they were
    assert.equal(apply(mixed, dropTrack(mixed, 'master')), duck)
    focus('voice')
    assert.deepEqual(steps(mixed).map(s => s.text), ['.deepfilter()'])
    // the voice split from a track: the master mixes it too
    assert.equal(voiceTrack(mixed).code, `let voiceTake = audio('v.wav')\n  .deepfilter()\n\nlet voice = voiceTake.clone()\n  .vocals('remove', { model: 'mel-roformer' })\n\nlet voice2 = voiceTake.clone()\n  .vocals({ model: 'mel-roformer' })\n\nlet bed = audio('m.wav')\n  .ducker({ key: voice, range: -15 })\n\nvoice.clone().mix(bed).mix(voice2)\n  .normalize('podcast')`)
    // a track taken away: out of the master, the steps keyed on it with it
    assert.equal(apply(mixed, dropTrack(mixed, 'voice')), `let bed = audio('m.wav')\n\nbed.clone()\n  .normalize('podcast')`)
    assert.equal(apply(mixed, dropTrack(mixed, 'bed')), `let voice = audio('v.wav')\n  .deepfilter()\n\nvoice.clone()\n  .normalize('podcast')`)
    const copied = `let voice = audio('v.wav')\n\nlet bed = audio('m.wav')\n  .ducker({ key: voice.clone() })\n  .gain(-3)`
    assert.equal(apply(copied, dropTrack(copied, 'voice')), `let bed = audio('m.wav')\n  .gain(-3)`, 'its step keyed on a copy of it too')
  } finally { focus(null) }
  // a master added: the one given a copy, the others mixed in
  assert.deepEqual(addMaster(duck, 'bed'), { code: `${duck}\n\nbed.clone().mix(voice)`, name: 'master' })
  assert.equal(addMaster(mixed, 'voice'), null, 'one already')
})

test('code: the last expression is returned, loops check their time, and imports become dynamic, on the same lines', () => {
  // the value comes back boxed, so a sound still arriving (thenable) streams instead of being waited out
  assert.equal(prepare(`audio('a.wav')\n  .gain(-3)`).code, `return __out(audio('a.wav')\n  .gain(-3))`)
  assert.equal(prepare(`let a = audio('a.wav')`).code, `let a = audio('a.wav');return __out(a)`)
  const loop = prepare(`import audio from 'audio'\nimport fx from 'https://x/fx.js'\nfor (;;) x()\nwhile (1) { y() }`).code.split('\n')
  assert.equal(loop.length, 4)
  assert.equal(loop[0].trim(), '')
  assert.equal(loop[1], `const { default: fx } = await import('https://x/fx.js')`)
  assert.equal(loop[2], 'for (;;) {__loop();x()}')
  assert.equal(loop[3], 'while (1) {__loop(); y() }')
  assert.deepEqual(prepare(`audio(['a.wav', "b.mp3"]).mix(audio('c.flac'))`).names, ['a.wav', 'b.mp3', 'c.flac'])
  assert.deepEqual(error(`audio('a').gain(`), { from: 16, to: 17 })
  assert.equal(error(`audio('a').gain(-3)`), null)
})

// An edit goes on a line of its own, as the edits are a card each, indented as the chain's lines are
test('code: edits from the waveform join the output chain, a line each, before a closing save', () => {
  const run = (code, call) => { const c = append(code, call); return code.slice(0, c.from) + c.insert + code.slice(c.to ?? c.from) }
  assert.equal(run(`audio('a.wav')`, 'reverse()'), `audio('a.wav')\n  .reverse()`)
  assert.equal(run(`audio('a.wav').gain(-3)`, 'reverse()'), `audio('a.wav').gain(-3)\n  .reverse()`)
  assert.equal(run(`audio('a.wav').gain(-3).save('b.wav')`, 'reverse()'), `audio('a.wav').gain(-3)\n  .reverse()\n  .save('b.wav')`)
  assert.equal(run(`audio('a.wav')\n  .trim()\n  .save('b.wav')`, 'reverse()'), `audio('a.wav')\n  .trim()\n  .reverse()\n  .save('b.wav')`)
  assert.equal(run(`let a = audio('a.wav')\na`, 'reverse()'), `let a = audio('a.wav')\na.reverse()\na`)
  assert.equal(append('', 'reverse()'), null)
  assert.deepEqual(source(`let a = audio('a.wav')\na.gain(-3)`).strings.map(s => s.name), ['a.wav'])
  assert.deepEqual(source(`audio(['a.wav', 'b.wav'])`).array, [6, 24])
})

test('code: sliders rewrite one argument, by position or by name, filling the ones before it', () => {
  const edit = (code, at, where, value, fill) => { const c = setArg(callAt(code, code.indexOf(at) + at.length), where, value, fill); return code.slice(0, c.from) + c.insert + code.slice(c.to ?? c.from) }
  assert.equal(edit(`a.gain(-3)`, 'gain(', 0, -6), `a.gain(-6)`)
  assert.equal(edit(`a.eq()`, 'eq(', 2, 2, [1000, 0, 1]), `a.eq(1000, 0, 2)`)
  assert.equal(edit(`a.gain({ at: 1, duration: 2 })`, 'gain(', 0, -6, [0]), `a.gain(-6, { at: 1, duration: 2 })`)
  assert.equal(edit(`a.compressor({ threshold: -20 })`, 'compressor(', 'ratio', 4), `a.compressor({ threshold: -20, ratio: 4 })`)
  assert.equal(edit(`a.compressor({ threshold: -20 })`, 'compressor(', 'threshold', -30), `a.compressor({ threshold: -30 })`)
  assert.equal(edit(`a.compressor()`, 'compressor(', 'ratio', 4), `a.compressor({ ratio: 4 })`)
  const call = callAt(`a.fade(0.5, -2, 'exp')`, 7)
  assert.deepEqual(call.args.map(a => a.value), [.5, -2, 'exp'])
  // a range given by name is a value: one, or several
  assert.deepEqual(callAt(`a.denoise({ noise: { at: 1, duration: 0.5 } })`, 3).args[0].props[0].value, { at: 1, duration: .5 })
  assert.deepEqual(callAt(`a.denoise({ noise: [{ at: 0, duration: 0.4 }, { at: 7 }] })`, 3).args[0].props[0].value, [{ at: 0, duration: .4 }, { at: 7 }])
  assert.equal(callAt(`a.denoise({ noise: { at: t, duration: 0.5 } })`, 3).args[0].props[0].kind, 'other')
})

// A recipe's calls show in the menu and open as units in the rack, with sliders: each is a method the editor describes.
// Measuring recipes and loops over files have no output chain; audio.from() is the source a generator starts from.
// Groups: a recipe's calls under its name, a comment on a line of its own, set in under it (as append writes them)
test('code: a group is a comment alone between the calls, the steps set in under it; nothing else is', () => {
  const apply = (code, ch) => code.slice(0, ch.from) + ch.insert + code.slice(ch.to ?? ch.from)
  const echo = { name: 'Remove room echo', calls: ['highpass(80)', 'dereverb()'] }
  // on a chain of several lines, a single line, one with no calls, one closed by a save()
  let code = apply("audio('a.wav')\n  .trim()", append("audio('a.wav')\n  .trim()", echo))
  assert.equal(code, "audio('a.wav')\n  .trim()\n  // Remove room echo\n    .highpass(80)\n    .dereverb()")
  assert.deepEqual(groups(code), [{ name: 'Remove room echo', from: code.indexOf('  // Remove'), to: code.length }])
  assert.deepEqual(chain(code).calls.map(k => k.name), ['trim', 'highpass', 'dereverb'])
  assert.equal(apply("audio('a.wav').trim()", append("audio('a.wav').trim()", echo)), "audio('a.wav').trim()\n  // Remove room echo\n    .highpass(80)\n    .dereverb()")
  assert.equal(apply("audio('a.wav')", append("audio('a.wav')", echo)), "audio('a.wav')\n  // Remove room echo\n    .highpass(80)\n    .dereverb()")
  const saved = apply("audio('a.wav')\n  .trim()\n  .save('b.wav')", append("audio('a.wav')\n  .trim()\n  .save('b.wav')", echo))
  assert.equal(saved, "audio('a.wav')\n  .trim()\n  // Remove room echo\n    .highpass(80)\n    .dereverb()\n  .save('b.wav')")
  assert.equal(groups(saved)[0].to, saved.indexOf('\n  .save'))
  // a call after it, set as the chain's are, is not its own; a step of it turned off stays in it
  const after = apply(code, append(code, 'fade(0.5)'))
  assert.equal(groups(after)[0].to, code.length)
  const off = code.replace('    .dereverb()', '    // .dereverb()')
  assert.deepEqual(groups(off), [{ name: 'Remove room echo', from: off.indexOf('  // Remove'), to: off.length }])
  // none: a comment with nothing set in under it, at the end, a step turned off, a note after a call on its line, one
  // inside a call's arguments, one before the chain
  for (const text of [
    "audio('a.wav')\n  // a note\n  .trim()",
    "audio('a.wav')\n  .trim()\n  // a note",
    "audio('a.wav')\n  // .trim()\n    .gain(-3)",
    "audio('a.wav')\n  .trim() // a note\n    .gain(-3)",
    "audio('a.wav')\n  .gain({\n    // the curve\n      t: [0, 1], v: [0, -3] })",
    "// a note\n  audio('a.wav')\n    .trim()"
  ]) assert.deepEqual(groups(text), [], text)
  assert.deepEqual(groups(''), [])
})

// The rack's tooltips (help.js): every setting of every op the rack can build a slider for, a plugin's read from its
// manifest as the engine reads it, says what it does in a sentence or two, and the layouts name those settings, each once
test('help: every setting of every op says what it does; the texts and layouts name only settings that exist', async () => {
  const settings = {}, thresholds = []
  for (const [name, op] of Object.entries(ops)) {
    let spec = op.params
    // (an optional package that is not installed has none to read)
    if (!spec && audio.plugins[name]) spec = await audio.use(name).then(() => Object.entries(audio.op(name).plugin.params).map(([n, s]) => ({ name: n, unit: s.unit })), () => null)
    // a source, a band and what is learned from a selection are set in the code or on the picture, not by a slider
    if (spec) settings[name] = spec.filter(s => s.name !== 'source' && s.name !== 'band' && !s.selection).map(s => s.name)
    if (spec?.some(s => s.name === 'threshold' && s.unit !== 'dB')) thresholds.push(name)
  }
  const bad = []
  for (const [name, names] of Object.entries(settings)) for (const setting of names) {
    const text = help(name, setting)
    if (typeof text !== 'string' || !text.endsWith('.') || text.length > 250 || text.includes(String.fromCharCode(8212))) bad.push(`${name}.${setting}: ${text}`)
  }
  assert.deepEqual(bad, [], 'a sentence or two ending in a full stop, 250 letters at most, no long dash')
  assert.deepEqual(Object.entries(texts).flatMap(([name, t]) => name === '*' ? [] : Object.keys(t).filter(setting => settings[name] && !settings[name].includes(setting)).map(setting => `${name}.${setting}`)), [], 'texts for settings that are gone')
  for (const [name, text] of Object.entries(layouts)) if (settings[name]) {
    assert.deepEqual(text.replace('|', ' ').split(/\s+/).filter(Boolean).sort(), [...settings[name]].sort(), `${name}: its layout names each setting once`)
    const [shown, folded] = layout(name, settings[name])
    assert.ok(shown.length && settings[name].length === shown.length + folded.length, `${name}: some shown, the rest folded`)
  }
  // a new setting, one the layout does not name, is shown; a folded one the manifest lacks leaves nothing to fold
  assert.deepEqual(layout('declick', ['threshold', 'longest', 'extra']), [['threshold', 'extra'], ['longest']])
  assert.deepEqual(layout('declick', ['threshold']), [['threshold'], []])
  assert.deepEqual(layout('trim', ['threshold']), [['threshold'], []])
  // a setting of an op without words of its own has its name's, or none
  assert.equal(help('crop', 'at'), texts['*'].at)
  assert.equal(help('declick', 'nope'), undefined)
  // a threshold draws a level on the picture only where it is in dB: declick's and decrackle's are multiples of the
  // sound's own error, and any plugin that comes with one like them is found here
  assert.ok(thresholds.includes('declick') && thresholds.includes('decrackle'))
  assert.deepEqual(thresholds.filter(name => guides(name, { threshold: 1 }, 8).some(g => g.level != null)), [])
})

// A tune's guide is the notes it lands on: the scale tables are @audio/note's, which @audio/tune-snap snaps by, and
// every scale its manifest offers has one; each note listed is one snapMidi keeps (on the scale), and none it would
// keep between A0 and C8 (MIDI 21–108, the piano's) is missing; A4 is the tuning set, its range the span
test('code: a tune guides by the notes of its scale, as @audio/note snaps', async () => {
  assert.deepEqual(SCALES, NOTE_SCALES)
  const { tune } = await import('@audio/tune-snap/audio')
  for (const scale of tune.params.scale.values) for (const root of [0, 2, 7, 11]) {
    const [g] = guides('tune', { scale, root }, 8), keeps = Array.from({ length: 88 }, (_, i) => 21 + i).filter(m => snapMidi(m, { scale, root }) === m)
    assert.deepEqual(g.notes, keeps, `${scale} from ${root}`)
  }
  assert.deepEqual(guides('tune', {}, 8)[0], { notes: Array.from({ length: 88 }, (_, i) => 21 + i), root: 0, a4: 440 })
  assert.deepEqual(guides('tune', { scale: 'major', a4: 432, at: 1, duration: 2 }, 8).map(g => g.span ?? g.range), [[1, 3], [1, 3]])
  assert.equal(guides('tune', { scale: 'nope' }, 8).length, 0)
})

test('code: every recipe calls only methods the menu and the rack know', () => {
  for (const r of recipes) for (const call of chain(r.code.replaceAll('$src', `audio('a.wav')`))?.calls || [])
    assert.ok(ops[call.name] || call.name === 'save' || call.name === 'from', `${r.name}: .${call.name}()`)
})

test('code: each guide follows its call: levels, fades, ranges and frequencies', () => {
  assert.deepEqual(guides('trim', { threshold: -40 }, 8), [{ level: -40 }])
  // a threshold that is not a level in dB draws none: declick's and decrackle's are multiples of the sound's own error
  assert.deepEqual(guides('declick', { threshold: 4 }, 8), [])
  // nor deesser's: the sibilance band over the voice body, in dB, not a level of the sound
  assert.deepEqual(guides('deesser', { threshold: 6 }, 8), [])
  assert.deepEqual(guides('decrackle', { threshold: 2.5 }, 8), [])
  assert.deepEqual(guides('remove', { at: 1, duration: .5 }, 8), [{ range: [1, 1.5] }])
  assert.deepEqual(guides('crop', { at: 1, duration: .5 }, 8), [{ range: [1, 1.5] }])
  // fade(in, out) ramps at the ends; fade(d, { at }) one from `at`, out when d < 0 (fn/fade.js)
  assert.deepEqual(guides('fade', { in: .02, out: .1 }, 8), [{ ramps: [[0, .02, 'in', 'linear'], [7.9, 8, 'out', 'linear']] }])
  assert.deepEqual(guides('fade', { in: -.5, at: 3.5, curve: 'cos' }, 8), [{ ramps: [[3.5, 4, 'out', 'cos']] }])
  assert.deepEqual(guides('fade', { in: .5 }, 8), [{ ramps: [[0, .5, 'in', 'linear']] }])
  assert.deepEqual(guides('highpass', { freq: 80 }, 8), [{ freq: 80 }])
  assert.deepEqual(guides('normalize', { target: -1 }, 8), [{ level: -1 }])
  assert.deepEqual(guides('normalize', { target: -16, mode: 'lufs' }, 8), [])
  // where denoise learns its noise, each range
  assert.deepEqual(guides('denoise', { reduction: 12, threshold: 0, noise: { at: 0, duration: .4 } }, 8), [{ range: [0, .4], label: 'noise' }])
  assert.deepEqual(guides('denoise', { noise: [{ at: 0, duration: .4 }, { at: 7, duration: .5 }], at: 1, duration: 5 }, 8).map(g => g.range), [[1, 6], [0, .4], [7, 7.5]])
})

// A slider's move shows at once on the picture where a level says it: the factor its new settings change the level by
test('code: a step\'s new settings preview as the level they change: gain, normalize, a fade\'s curve', () => {
  assert.ok(Math.abs(previews.gain({ value: -6 }, { value: 0 })(1) - 10 ** (6 / 20)) < 1e-9)
  assert.equal(previews.gain({ value: 0, at: 1, duration: 1 }, { value: -6, at: 1, duration: 1 })(3), 1, 'outside its range, as it was')
  assert.ok(Math.abs(previews.normalize({ target: -1 }, { target: -7 })(0) - 10 ** (-6 / 20)) < 1e-9)
  assert.equal(previews.normalize({ target: -1 }, { target: -16, mode: 'lufs' }), null, 'another mode: no level says it')
  // a line from 0 over 0.5 s, then over 1 s: at 0.25 s the level halves; past both, as it was
  const fade = previews.fade({ in: .5 }, { in: 1 }, 8)
  assert.ok(Math.abs(fade(.25) - .5) < 1e-9 && fade(2) === 1)
  assert.equal(previews.fade({ in: .5, at: 2 }, { in: 1, at: 2 }, 8), null, 'placed fades show when their output comes')
})

// The command a script translates to (for a CLI view, when it returns) makes the same audio: both run, the outputs
// compared sample by sample.
test('code: the CLI translation makes the same audio as the script (bin/cli.js on the same file)', async () => {
  const dir = await mkdtemp(resolve(tmpdir(), 'audio-repl-cli-'))
  try {
    const input = resolve(dir, 'in.wav')
    await writeFile(input, await wavBytes([sine(2, 440, .5), sine(2, 660, .25)]))
    const scripts = [
      `audio('in.wav').trim().normalize(-1).fade(0.02, 0.1)`,
      `audio('in.wav').highpass(80).remove({ at: 0.5, duration: 0.25 }).gain(-6, { at: 1, duration: 0.5 })`,
      `audio('in.wav').eq(1000, -3, 2).crop({ at: 0.25, duration: 1 }).reverse()`,
      `audio('in.wav').denoise({ noise: { at: 0, duration: 0.4 } })`,
      `audio('in.wav').denoise(20, { noise: { at: 0, duration: 0.4 }, at: 1, duration: 0.5 })`
    ]
    for (const [i, script] of scripts.entries()) {
      const command = cli(script, name => ops[name]?.params)
      assert.ok(command, script)
      const args = command.split(' ').slice(1).map(a => a === 'in.wav' ? input : a)
      const out = resolve(dir, `cli-${i}.wav`)
      await promisify(execFile)('node', [fileURLToPath(new URL('../../bin/cli.js', import.meta.url)), ...args, 'save', out, '32bit', '-f'])
      const js = await new Function('audio', 'return ' + script.replace("'in.wav'", JSON.stringify(input)))(audio).read()
      const fromCli = await audio(out).read()
      assert.equal(fromCli[0].length, js[0].length, command)
      let diff = 0
      for (let c = 0; c < js.length; c++) for (let n = 0; n < js[c].length; n++) diff = Math.max(diff, Math.abs(js[c][n] - fromCli[c][n]))
      assert.ok(diff < 1e-6, `${command}: differs by ${diff}`)
    }
    assert.equal(cli(`audio.from(t => t, { duration: 1 })`), null)
    // a range by name is name:from..to; the call's own range comes last; several ranges no command says
    assert.equal(cli(scripts[3], name => ops[name]?.params), 'audio in.wav denoise noise:0s..0.4s')
    assert.equal(cli(scripts[4], name => ops[name]?.params), 'audio in.wav denoise 20db noise:0s..0.4s 1s..1.5s')
    assert.equal(cli(`audio('in.wav').denoise({ noise: [{ at: 0, duration: 0.4 }, { at: 1, duration: 0.2 }] })`), null)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// ── The scrub voice ────────────────────────────────────────────

// One way to write a time, on the clock, the time row, the pointer and the edits: minutes and seconds, seconds, samples;
// rounded once, so a time a hair under a minute reads a minute, not 0:60.000
// Each method its own icon, in the palette and on its card: one for every op, none twice, each a path on the 24 grid
test('icons: every method has its own', () => {
  assert.deepEqual(Object.keys(opIcons).sort(), Object.keys(ops).sort())
  assert.equal(new Set(Object.values(opIcons)).size, Object.keys(ops).length)
  for (const [name, d] of Object.entries(opIcons)) assert.match(d, /^[Mm][\d\s.,MLHVCSQTAZmlhvcsqtaz-]+$/, name)
})

test('time: minutes and seconds, seconds or samples, rounded once', () => {
  assert.equal(clock(65.4321), '1:05.432')
  assert.equal(clock(59.9996), '1:00.000')
  assert.equal(clock(5, 'clock', { digits: 0 }), '0:05')
  assert.equal(clock(5.05, 'clock', { digits: 1 }), '0:05.1')
  assert.equal(clock(2.5, 'seconds'), '2.500s')
  assert.equal(clock(59.99996, 'seconds', { digits: 4 }), '60.0000s')
  assert.equal(clock(2, 'samples', { rate: 44100 }), '88200')
  assert.equal(clock(0), '0:00.000')
})

// ── The engine, in a browser worker ─────────────────────────────
