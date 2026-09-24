import sprae, { batch } from './assets/sprae.js'
import audio from './assets/audio.js'
import { samples, RATE } from './site-samples.js'

// The demo accepts method calls with literal numbers, not arbitrary JavaScript. Crop and remove take a time range,
// { at, duration }; every other method but pad takes one as an optional last argument, to apply to that range only.
const span = { at: { label: 'Start', unit: 's' }, duration: { label: 'Duration', unit: 's' } }
const hz = label => ({ label, min: 20, max: 10000, step: 10, unit: 'Hz' })
const methods = {
  trim: { arity: [0, 1], args: [], icon: 'M7 4v16M17 4v16M2.5 12h2m15 0h2M10 10v4m2-6v8m2-6v4', description: 'Cut edge silence', params: [{ label: 'Threshold', min: -80, max: 0, step: 1, unit: 'dB' }] },
  crop: { args: [{ at: 0, duration: 1 }], icon: 'M8 3v13a2 2 0 0 0 2 2h11M3 8h13a2 2 0 0 1 2 2v11', description: 'Keep a range', params: span },
  remove: { args: [{ at: 0, duration: 1 }], icon: 'M3 6a3 3 0 1 0 6 0 3 3 0 1 0-6 0m0 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0M8.1 8.1 12 12m8-8L8.1 15.9m6.7-1.1L20 20', description: 'Cut a range', params: span },
  pad: { arity: [1, 2], args: [.5, .5], whole: true, icon: 'M12 8v8m-2.5-6v4m5-4v4M7 12H2.5m2-2-2 2 2 2M17 12h4.5m-2-2 2 2-2 2', description: 'Add silence', params: [{ label: 'Before', min: 0, max: 5, step: .05, unit: 's' }, { label: 'After', min: 0, max: 5, step: .05, unit: 's' }] },
  shrink: { arity: [0, 2], args: [.3], icon: 'M4 6v12M20 6v12M7 12h4m-2-2 2 2-2 2m8-2h-4m2-2-2 2 2 2', description: 'Shorten pauses', params: [{ label: 'Gap', min: 0, max: 2, step: .05, unit: 's' }, { label: 'Threshold', min: -80, max: 0, step: 1, unit: 'dB' }] },
  repeat: { arity: [1, 1], args: [2], icon: 'm17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3', description: 'Repeat n times', params: [{ label: 'Times', min: 1, max: 8, step: 1, unit: '×' }] },
  reverse: { arity: [0, 0], args: [], icon: 'M20 7H4m5-5L4 7l5 5M4 17h16m-5-5 5 5-5 5', description: 'Play backwards', params: [] },
  gain: { arity: [1, 1], args: [-6], icon: 'm11 5-5 4H3v6h3l5 4ZM16 12h5', description: 'Change volume', params: [{ label: 'Gain', min: -36, max: 12, step: .1, unit: 'dB' }] },
  normalize: { arity: [0, 1], args: [-1], icon: 'M4 5h16M4 19h16m-8-3V8m-3 3 3-3 3 3', description: 'Set peak level', params: [{ label: 'Peak', min: -36, max: 0, step: .1, unit: 'dB' }] },
  fade: { arity: [1, 2], args: [.02, .1], icon: 'm3 18 5-12h8l5 12', description: 'Fade in and out', params: [{ label: 'Fade in', unit: 's' }, { label: 'Fade out', unit: 's' }] },
  speed: { arity: [1, 1], args: [1.25], icon: 'm4 6 8 6-8 6Zm9 0 8 6-8 6Z', description: 'Speed and pitch', params: [{ label: 'Speed', min: .25, max: 4, step: .05, unit: '×' }] },
  stretch: { arity: [1, 1], args: [1.5], icon: 'M3 12h18M6 9l-3 3 3 3m12-6 3 3-3 3M12 8v8', description: 'Tempo, same pitch', params: [{ label: 'Stretch', min: .25, max: 4, step: .05, unit: '×' }] },
  pitch: { arity: [1, 1], args: [7], icon: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4', description: 'Pitch, same tempo', params: [{ label: 'Pitch', min: -24, max: 24, step: 1, unit: 'st' }] },
  lowpass: { arity: [1, 1], args: [1000], icon: 'M3 7h9c3 0 5 4 7 10', description: 'Cut highs', params: [hz('Cutoff')] },
  highpass: { arity: [1, 1], args: [500], icon: 'M21 7h-9c-3 0-5 4-7 10', description: 'Cut lows', params: [hz('Cutoff')] },
  eq: { arity: [2, 3], args: [1000, 6], icon: 'M3 17c4 0 5-10 9-10s5 10 9 10', description: 'Boost or cut a band', params: [hz('Frequency'), { label: 'Gain', min: -24, max: 24, step: .5, unit: 'dB' }, { label: 'Q', min: .1, max: 10, step: .1, unit: '' }] }
}
const ranged = type => methods[type].params === span
const formats = { wav: { label: 'WAV', mime: 'audio/wav', description: 'Uncompressed, exact samples' }, mp3: { label: 'MP3', mime: 'audio/mpeg', description: 'Compressed, a tenth of the size' } }
const step = (type, ...args) => ({ type, args })
const defaults = () => [step('trim'), step('normalize', -1), step('fade', .02, .1)]

// A step written as a JavaScript call and as CLI arguments. CLI numbers use decimal notation;
// its fade shorthand also needs an explicit out.
const decimal = new Intl.NumberFormat('en-US', { useGrouping: false, maximumSignificantDigits: 21 }).format
function notation({ type, args }) {
  const numbers = args.filter(value => typeof value === 'number'), scope = args.find(value => typeof value === 'object')
  const js = scope && `{ at: ${scope.at}, duration: ${scope.duration} }`
  const cli = scope && `${decimal(scope.at)}..${Number.isFinite(scope.at + scope.duration) ? decimal(scope.at + scope.duration) : ''}`
  const values = type === 'fade' ? [numbers[0], numbers[1] ? -Math.abs(numbers[1]) : 0] : numbers
  return {
    js: `${type}(${[...numbers, ...(scope ? [js] : [])].join(', ')})`,
    cli: [type, ...(ranged(type) ? [] : values.map(decimal)), ...(scope ? [cli] : [])].join(' ')
  }
}
// The program is all editable text: audio(…) names its source, a built-in sample or an opened file in quotes; one
// edit per line follows; .save('…') names the file to download, its extension picking the format.
const quote = text => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const unquote = literal => literal.slice(1, -1).replace(/\\(.)/g, '$1')
const program = (steps, from = state.sample || quote(state.filename), to = state.saveName) =>
  [`audio(${from})`, ...steps.map(edit => '  .' + notation(edit).js), `  .save(${quote(to)})`].join('\n')
const literal = String.raw`'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"`
const opening = new RegExp(String.raw`^\s*audio\s*\(\s*(${literal}|[A-Za-z_$][\w$]*)\s*\)`)
const closing = new RegExp(String.raw`\.\s*save\s*\(\s*(${literal})\s*\)\s*;?\s*$`)
// Where the program's two names sit: the literal between the quotes included.
function names(code) {
  const open = opening.exec(code), close = closing.exec(code), place = (match, at) => ({ from: at, to: at + match[1].length })
  return {
    source: open && place(open, open.index + open[0].indexOf(open[1])),
    save: close && close.index >= (open?.[0].length ?? 0) ? place(close, close.index + close[0].indexOf(close[1])) : null,
    body: [open ? open[0].length : 0, close ? close.index : code.length]
  }
}

function parseProgram(code) {
  if (code.length > 8192) throw Error('Use at most 4,096 characters of edits.')
  const open = opening.exec(code), close = closing.exec(code)
  if (!open) throw Error("Start with audio('file.wav').")
  if (!close || close.index < open[0].length) throw Error("End with .save('file.wav').")
  const name = unquote(close[1]), format = /\.(\w+)$/.exec(name)?.[1].toLowerCase()
  if (!/[^/\\]\.\w+$/.test(name)) throw Error("Name the file with its format, as in .save('edited.wav').")
  if (!Object.hasOwn(formats, format)) throw Error(`Save as .wav or .mp3, not .${format}.`)
  const quoted = /^['"]/.test(open[1]), sample = quoted ? '' : open[1]
  if (sample && !Object.hasOwn(samples, sample)) throw Error(`There is no sample named ${sample}: try ${Object.keys(samples).join(', ')}.`)
  if (quoted && state.sample) throw Error('Open a file from the list in audio(…) to use it.')
  return { sample, source: quoted ? unquote(open[1]) : sample, steps: parseChain(code.slice(open[0].length, close.index)), save: name, format }
}

function parseChain(code) {
  // The edits' own text counts, not the line breaks around them.
  if (code.replace(/^\n|\n[^\S\n]*$/g, '').length > 4096) throw Error('Use at most 4,096 characters of edits.')
  let rest = code.trim(), steps = []
  const number = value => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(+value))
      throw Error('Use finite numbers for edit arguments.')
    return +value
  }
  while (rest) {
    const call = /^\.\s*(\w+)\s*\(([^()]*)\)/.exec(rest)
    if (!call) throw Error('Use a chain such as .trim().gain(-6).')
    const [, type, raw] = call
    if (!Object.hasOwn(methods, type)) throw Error(`Unknown edit: ${type}(). Type a dot to see the methods.`)
    // A trailing { at, duration } scopes the call to a time range; crop and remove take nothing else.
    const scope = /(?:^|,)\s*(\{[^{}]*\})\s*$/.exec(raw), numbers = scope ? raw.slice(0, scope.index) : raw
    if (ranged(type) && (!scope || numbers.trim())) throw Error(`Use .${type}({ at: 0, duration: 1 }).`)
    if (scope && methods[type].whole) throw Error(`${type}() applies to the whole audio.`)
    const args = numbers.trim() ? numbers.split(',').map(value => number(value.trim())) : []
    if (!ranged(type)) {
      const [min, max] = methods[type].arity
      if (args.length < min || args.length > max) throw Error(`${type}() takes ${min === max ? min : `${min}–${max}`} numeric argument${max === 1 ? '' : 's'}.`)
      if (type === 'speed' && args[0] === 0) throw Error('Speed must be nonzero.')
    }
    if (scope) {
      const options = {}
      for (const field of scope[1].trim().slice(1, -1).split(',')) {
        const pair = /^\s*(at|duration)\s*:\s*(.*?)\s*$/.exec(field)
        if (!pair || Object.hasOwn(options, pair[1])) throw Error('A range accepts at and duration once each.')
        options[pair[1]] = number(pair[2])
      }
      if (options.duration == null || options.duration < 0 || (options.at ?? 0) < 0)
        throw Error('A range needs a nonnegative start and duration in seconds.')
      args.push({ at: options.at ?? 0, duration: options.duration })
    }
    steps.push({ type, args })
    if (steps.length > 64) throw Error('Use up to 64 edits in this demo.')
    rest = rest.slice(call[0].length).trim()
  }
  return steps
}

function examples(steps, format) {
  const selected = steps.map(notation)
  const chain = selected.map(edit => '.' + edit.js)
  const lines = chain.map(edit => '\n  ' + edit).join('')
  return {
    node: `import audio from 'audio'

await audio('recording.wav')${lines}
  .save('edited.${format}')`,
    browser: `import audio from 'audio'

// file is a File from an <input type="file">
const bytes = await audio(file)${lines}
  .encode('${format}')
const url = URL.createObjectURL(
  new Blob([bytes], { type: '${formats[format].mime}' })
)
// Set a download link's href to url.
// Revoke the URL after use.`,
    cli: `npm i -g audio

audio recording.wav \\
${selected.map(edit => '  ' + edit.cli + ' \\\n').join('')}\
  save edited.${format}

# Run the same chain over a folder
audio '*.wav' ${selected.map(edit => edit.cli + ' ').join('')}save '{name}.out.{ext}'`,
    mcp: `# Claude Desktop, Cursor, VS Code
{ "mcpServers": { "audio": {
  "command": "npx", "args": ["-y", "audio", "--mcp"]
} } }

# Claude Code
claude mcp add audio -- npx -y audio --mcp

# The agent calls the audio tool with CLI arguments
recording.wav ${selected.map(edit => edit.cli + ' ').join('')}save edited.${format}`
  }
}

// The code screen reserves the tallest example, so switching tabs never changes its height.
const codeLines = examples => Math.max(...Object.values(examples).map(code => code.split('\n').length))

// The tab underline slides to the chosen tab.
function moveTab(tab = document.querySelector('.code-tabs [aria-pressed="true"]')) {
  if (!tab) return
  tab.parentElement.style.setProperty('--tab-x', tab.offsetLeft + 'px')
  tab.parentElement.style.setProperty('--tab-w', tab.offsetWidth + 'px')
}

// The program as highlighted code. Its two names and its numbers are choices, lit under the pointer (a name also
// while its list is open); the value being adjusted stays marked.
function highlightProgram(code, options, hoverAt = -1, open = '') {
  const at = names(code), marked = options?.fields[options.active], choices = []
  for (const kind of ['source', 'save']) if (at[kind]) choices.push({ kind, ...at[kind] })
  for (const number of code.slice(...at.body).matchAll(/[+-]?(?:\b\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?![\w$])/g))
    choices.push({ kind: 'param', from: at.body[0] + number.index, to: at.body[0] + number.index + number[0].length })
  let html = '', offset = 0
  for (const choice of choices.sort((a, b) => a.from - b.from)) {
    const lit = choice.from === hoverAt || choice.kind === open, tag = marked?.from === choice.from ? 'mark' : 'span'
    html += highlight(code.slice(offset, choice.from)) + `<${tag} class="choice${lit ? ' lit' : ''}" data-choice="${choice.kind}" data-from="${choice.from}">${highlight(code.slice(choice.from, choice.to))}</${tag}>`
    offset = choice.to
  }
  return html + highlight(code.slice(offset))
}

function highlight(source) {
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const tokens = /(\/\/[^\n]*|#[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|\b(import|from|const|await|new)\b|([+-]?(?:\b\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?![\w$])|\b([\w$]+)(?=\()/g
  let html = '', offset = 0
  for (const match of source.matchAll(tokens)) {
    const kind = ['comment', 'string', 'keyword', 'number', 'call'][match.slice(1).findIndex(value => value != null)]
    html += escape(source.slice(offset, match.index)) + `<span class="syntax-${kind}">${escape(match[0])}</span>`
    offset = match.index + match[0].length
  }
  return html + escape(source.slice(offset))
}

// The level reading is the sample peak in dBFS (decibels re digital full scale, the unit DAW peak meters
// show), from the library itself: stat('db') of the same samples. A new reading replaces the last one when
// it arrives, never a blank in between.
const signed = value => (value < 0 ? '−' : value > 0 ? '+' : '') + Math.abs(value).toFixed(1)
const dbfs = db => `${Number.isFinite(db) ? signed(db) : '−∞'} dBFS`
// Each track's samples as a plain clip, measured whole for the track and by range for a selection.
const measure = { original: null, edited: null }
function measured(name, pcm, sampleRate) {
  measure[name]?.dispose()
  return measure[name] = audio.from(pcm, { sampleRate })
}

let state, original, edited, originalPCM, editedPCM, originalPeaks, editedPeaks
let ctx, player, startTime = 0, frame, menuFrame, copyTimer, editTimer, playback = 0, history = [], selection = null, drag = null
// quiet: the draft on which Escape dismissed method suggestions; they stay closed until the text changes.
let composing = false, pendingGroup = 0, lastGroup = 0, parameterGroup = 0, assistRange = null, quiet = null
const position = { original: 0, edited: 0 }
const buffers = { original: null, edited: null }
const waves = { original: document.querySelector('#original-wave'), edited: document.querySelector('#edited-wave') }
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
// Tenths, floored once rounded to the millisecond: 441,600 frames at 48 kHz read 9.2 s, not floating point's 9.1999….
const duration = seconds => { const tenths = Math.floor(Math.round(seconds * 1000) / 100); return `${clock(tenths / 10)}.${tenths % 10}` }

function context() { return ctx ||= new AudioContext() }
const length = name => (name === 'original' ? original : edited)?.duration || 0
const available = name => !state.editPending && !(state.busy && !state.saving) && (name === 'original' ? state.originalReady : state.ready)

function range(name) {
  return selection?.name === name
    ? [Math.min(selection.a, selection.b) * length(name), Math.max(selection.a, selection.b) * length(name)]
    : [0, length(name)]
}

function peaks(channels) {
  const result = new Float32Array(512), length = channels[0].length
  for (let bin = 0; bin < result.length; bin++) {
    const from = Math.floor(bin * length / result.length), to = Math.floor((bin + 1) * length / result.length)
    for (const channel of channels)
      for (let i = from; i < to; i++) {
        if (!Number.isFinite(channel[i])) throw Error('Nonfinite audio sample')
        result[bin] = Math.max(result[bin], Math.abs(channel[i]))
      }
  }
  return result
}

// Bars are linear amplitude on one scale for both lanes (full height is 0 dBFS), so level edits show as height.
function draw(track, values) {
  if (!values) return
  const count = Math.floor(track.clientWidth / 5), length = values.length
  let glyphs = ''
  for (let bin = 0; bin < count; bin++) {
    let peak = 0
    const from = Math.floor(bin * length / count), to = Math.floor((bin + 1) * length / count)
    for (let i = from; i < to; i++) peak = Math.max(peak, values[i])
    glyphs += String.fromCharCode(0x100 + Math.max(1, Math.min(100, Math.round(peak * 100))))
  }
  for (const layer of track.querySelectorAll('.wave-glyphs')) layer.textContent = glyphs
}

function drawWaves() {
  draw(waves.original, originalPeaks)
  draw(waves.edited, editedPeaks)
}

function paint() {
  for (const [name, track] of Object.entries(waves)) {
    const total = length(name)
    const elapsed = Math.min(total, state.playing && state.preview === name ? ctx.currentTime - startTime : position[name])
    const progress = total ? elapsed / total : 0
    track.style.setProperty('--progress', progress * 100 + '%')
    track.style.setProperty('--cursor-opacity', total > 0 ? 1 : 0)
    const input = track.querySelector('input')
    input.value = progress * 1000
    input.setAttribute('aria-valuetext', `${clock(elapsed)} of ${duration(total)}`)
    if (name === state.preview) state.timecode = duration(elapsed)
  }
}

function stop(clear = false) {
  playback++
  if (state.playing) position[state.preview] = ctx.currentTime - startTime
  if (player) { player.onended = null; player.stop(); player.disconnect(); player = null }
  cancelAnimationFrame(frame)
  if (clear) position.original = position.edited = 0
  state.playing = state.pending = false
  paint()
}

async function refresh() {
  editedPCM = await edited.read()
  editedPeaks = peaks(editedPCM)
  state.editCount = edited.edits.length
  state.editedDuration = duration(edited.duration)
  state.ready = editedPCM[0].length > 0
  state.editMessage = state.ready ? '' : 'The edits removed all samples. Undo an edit or open another file.'
  const clip = measured('edited', editedPCM, edited.sampleRate)
  state.editedMeters = state.ready ? dbfs(await clip.stat('db')) : '–'
  draw(waves.edited, editedPeaks)
  paint()
}

// The name a download takes until one is typed: the sample's own, or the opened file's with -edited.
const saveDefault = () => (state.sample || state.filename.replace(/\.[^.]*$/, '') + '-edited') + '.' + state.format

// A new source: a sample by name keeps the edits; an opened file starts from the defaults. A typed save name stays.
async function load(pcm, sampleRate, name, sample = '', steps = null) {
  const typed = state.saveName !== saveDefault()
  stop(true)
  edited?.dispose()
  original?.dispose()
  original = audio.from(pcm, { sampleRate })
  originalPCM = pcm
  buffers.original = null
  state.originalReady = pcm[0].length > 0
  state.originalDuration = duration(original.duration)
  state.originalMeters = dbfs(await measured('original', pcm, sampleRate).stat('db'))
  originalPeaks = peaks(pcm)
  draw(waves.original, originalPeaks)
  state.sample = sample
  state.filename = name
  if (!typed) state.saveName = saveDefault()
  if (!steps) return reset()
  state.steps = steps
  return render()
}
const useSample = (name, steps = state.steps) => load(samples[name].make(), RATE, name, name, steps)

async function render(sync = true) {
  if (sync) cancelEdit()
  const focused = document.activeElement
  cancelSelection()
  stop(true)
  clearSelection()
  state.message = state.editMessage = state.chainError = ''
  state.applied = program(state.steps)
  // Text the page writes opens no list when the caret is restored in it; typing or a click does.
  if (sync) quiet = state.draft = state.applied
  state.busy = true
  state.ready = false
  buffers.edited = null
  state.undoCount = history.length
  state.examples = examples(state.steps, state.format)
  try {
    edited?.dispose()
    edited = original.clone()
    for (const { type, args } of state.steps) {
      edited[type](...args)
      if (!Number.isFinite(edited.duration) || edited.duration > 120) {
        state.editMessage = 'Keep the edited audio within two minutes.'
        state.editedMeters = '–'
        return
      }
    }
    await refresh()
  } catch {
    state.editMessage = 'The edits could not be applied. Undo or change the chain.'
    state.editedMeters = '–'
  }
  finally {
    finishWork()
    if (document.activeElement === document.body && focused?.isConnected) focused.focus({ preventScroll: true })
  }
}

function reset() {
  state.steps = defaults()
  history = [0, 1, 2].map(count => defaults().slice(0, count))
  return render()
}

function undo() {
  if (state.busy) return
  if (state.editPending || state.chainError) { cancelEdit(); state.draft = state.applied; state.chainError = ''; closeAssist(); return }
  if (!history.length) return
  state.steps = history.pop()
  return render()
}

function change(steps, live = false, group = 0) {
  if (state.busy) return
  if (!group || group !== lastGroup)
    history.push(state.steps.map(({ type, args }) => ({ type, args: args.map(value => typeof value === 'object' ? { ...value } : value) })))
  lastGroup = group
  state.steps = steps
  return render(!live)
}

function cancelEdit() {
  clearTimeout(editTimer)
  editTimer = null
  state.editPending = false
  pendingGroup = 0
}

function finishWork() {
  state.busy = false
  if (state.editPending && !composing) {
    clearTimeout(editTimer)
    editTimer = setTimeout(applyDraft, 0)
  }
}

function queueEdit(group = 0, delay = 180) {
  pendingGroup = group
  state.editPending = true
  state.chainError = ''
  if (group && editTimer) return
  clearTimeout(editTimer)
  if (!composing) editTimer = setTimeout(applyDraft, delay)
}

function applyDraft() {
  clearTimeout(editTimer)
  editTimer = null
  if (state.busy || composing) return
  state.editPending = false
  let parsed
  try { parsed = parseProgram(state.draft) }
  catch (error) { state.chainError = error.message + ' Preview unchanged.'; return }
  state.chainError = ''
  // The names apply as typed: .save('…') is the next download; audio(name) switches to that sample, keeping the
  // edits, while a quoted name labels the opened file.
  if (parsed.format !== state.format) { state.format = parsed.format; state.examples = examples(state.steps, state.format) }
  state.saveName = parsed.save
  if (parsed.sample !== state.sample) return useSample(parsed.sample, parsed.steps)
  if (!parsed.sample) state.filename = parsed.source
  if (program(parsed.steps) === program(state.steps) && state.ready) { state.applied = program(state.steps); return }
  return change(parsed.steps, true, pendingGroup)
}

function inputCode(event) {
  state.draft = event.target.value
  queueEdit()
  inspectCaret()
}

function composition(event) {
  composing = event.type === 'compositionstart'
  if (composing) { clearTimeout(editTimer); closeAssist() }
  else { state.draft = event.target.value; queueEdit(); inspectCaret() }
}

function editKey(event) {
  if (event.isComposing) return
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
    event.preventDefault(); undo(); return
  }
  // A format downloads, so only Enter chooses one: Tab moves on.
  if (event.key === 'Tab' && state.assist === 'format' && state.suggestions.length) { closeAssist(); return }
  if (state.suggestions.length && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(event.key)) {
    event.preventDefault()
    if (event.key === 'Enter' || event.key === 'Tab') accept(state.suggestions[state.suggestionIndex])
    else state.suggestionIndex = (state.suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + state.suggestions.length) % state.suggestions.length
    return
  }
  if (event.key === 'Escape') {
    if (state.suggestions.length || state.options) { if (state.suggestions.length) quiet = state.draft; closeAssist(); return }
    cancelEdit(); state.draft = state.applied; state.chainError = ''
  }
}

function closeAssist() {
  state.suggestions = []
  state.options = null
  document.querySelector('#method-menu').hidePopover()
  document.querySelector('#parameter-menu').hidePopover()
}

// One list opens under the caret: methods after a dot, the samples in audio(…), the formats in .save('…').
const icons = {
  sample: 'M2 13h2l2-6 3 12 3-15 3 12 2-3h5',
  file: 'm6 14 1.5-2.9A2 2 0 0 1 9.2 10H20a2 2 0 0 1 1.9 2.5l-1.5 6a2 2 0 0 1-1.9 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.7.9l.8 1.2a2 2 0 0 0 1.7.9H18a2 2 0 0 1 2 2v2',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14'
}
const lists = {
  method: prefix => Object.keys(methods).filter(name => name.startsWith(prefix)).map(name => ({ id: 'method-' + name, value: name, code: name + '()', text: methods[name].description, icon: methods[name].icon })),
  sample: () => [...Object.entries(samples).map(([name, { description }]) => ({ id: 'sample-' + name, value: name, code: name, text: description, icon: icons.sample })), { id: 'sample-file', value: '', code: 'Open a file…', text: 'WAV, MP3, FLAC and more', icon: icons.file }],
  // Each format is the download itself, named as it will arrive.
  format: () => Object.entries(formats).map(([ext, { description }]) => ({ id: 'format-' + ext, value: ext, code: savedAs(withFormat(state.draft, ext)), text: description, icon: icons.download }))
}
function offer(kind, items, index = 0) {
  state.options = null
  document.querySelector('#parameter-menu').hidePopover()
  if (!items.length || quiet === state.draft) return closeAssist()
  // The same list keeps its highlight; a download's name follows the text typed into .save('…').
  // A new list and its highlight land together: the highlight never points past a list.
  if (state.assist !== kind || state.suggestions.map(item => item.id + item.code).join() !== items.map(item => item.id + item.code).join())
    batch(() => { state.assist = kind; state.suggestions = items; state.suggestionIndex = index })
  const menu = document.querySelector('#method-menu')
  if (!menu.matches(':popover-open')) menu.showPopover()
  placeMenu()
}
function accept(item) {
  if (state.assist === 'method') return completeMethod(item.value)
  if (state.assist === 'format' && !saveable(item.value)) return
  closeAssist()
  if (state.assist === 'format') return chooseFormat(item.value)
  if (!item.value) return document.querySelector('#audio-file').click()
  if (item.value !== state.sample && !state.busy) return useSample(item.value)
}
// The file .save('…') names, and the program with another extension there: the text stays the one truth of the format.
const savedAs = code => { const at = names(code).save; return at ? unquote(code.slice(at.from, at.to)) : '' }
function withFormat(code, ext) {
  const at = names(code).save
  return at ? code.slice(0, at.from) + code.slice(at.from, at.to).replace(/(\.\w+)?(?=['"]$)/, '.' + ext) + code.slice(at.to) : code
}
// A format downloads when the program, written with it, has output to save: an error it would fix still allows it.
function saveable(ext) {
  if (state.busy || !state.ready) return false
  try { return !!parseProgram(withFormat(state.draft, ext)) } catch { return false }
}
// Choosing a format writes its extension and downloads. Saving disables the editor, which drops its focus: the focus
// comes back, caret where it was, unless something else has taken it since.
async function chooseFormat(ext) {
  const input = document.querySelector('.program-editor')
  quiet = state.draft = withFormat(state.draft, ext)
  queueEdit(0, 0)
  await download()
  requestAnimationFrame(() => { if (document.activeElement === document.body && !input.disabled) input.focus({ preventScroll: true }) })
}
// The name holding the caret: inside the quotes of a file name, anywhere on a sample name.
function nameAt(cursor) {
  const at = names(state.draft)
  for (const kind of ['source', 'save']) {
    const { from, to } = at[kind] || {}, quoted = /^['"]/.test(state.draft[from])
    if (at[kind] && (quoted ? cursor > from && cursor < to : cursor >= from && cursor <= to)) return kind
  }
  return ''
}

// A click asks for what is under the caret, even where Escape closed it.
function clickCode() { quiet = null; inspectCaret() }

function inspectCaret() {
  const input = document.querySelector('.program-editor')
  if (document.activeElement !== input || composing || state.draft.length > 8192) return
  const cursor = input.selectionStart, name = nameAt(cursor)
  if (name === 'source') return offer('sample', lists.sample(), Math.max(0, Object.keys(samples).indexOf(state.sample)))
  if (name === 'save') return offer('format', lists.format(), Math.max(0, Object.keys(formats).indexOf(state.format)))
  const before = state.draft.slice(0, cursor), after = state.draft.slice(cursor)
  const match = /\.([a-z]*)$/i.exec(before)
  // A name followed by its arguments is an existing call: it offers options, not other names.
  const called = match && Object.hasOwn(methods, match[1] + /^\w*/.exec(after)[0]) && /^\w*\s*\(/.test(after)
  if (match && !called && before.lastIndexOf('(') <= before.lastIndexOf(')')) {
    assistRange = [cursor - match[0].length, cursor]
    return offer('method', lists.method(match[1]))
  }
  const options = optionsAt(cursor, input.selectionEnd)
  if (!options) return closeAssist()
  state.suggestions = []
  document.querySelector('#method-menu').hidePopover()
  // The same call keeps its fields, updated in place: new rows would replace the sliders under the pointer.
  const current = state.options
  if (current?.start === options.start && current.fields.length === options.fields.length) {
    options.fields.forEach((field, index) => Object.assign(current.fields[index], field))
    // The value being adjusted stays marked unless the caret lands on another number.
    if (options.active >= 0) current.active = options.active
  } else state.options = options
  const menu = document.querySelector('#parameter-menu')
  if (!menu.matches(':popover-open')) menu.showPopover()
  placeMenu()
}

// The numbers of the call around the caret, each with its slider; the one under the caret is marked.
function optionsAt(cursor, end = cursor) {
  const [bodyFrom, bodyTo] = names(state.draft).body
  for (const call of state.draft.matchAll(/\.\s*(\w+)\s*\(([^()]*)\)/g)) {
    const start = call.index
    if (start < bodyFrom || start >= bodyTo || cursor <= start || cursor >= start + call[0].length || !Object.hasOwn(methods, call[1])) continue
    const method = methods[call[1]], offset = start + call[0].indexOf('(') + 1, fields = []
    let index = 0
    for (const number of call[2].matchAll(/[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi)) {
      const head = call[2].slice(0, number.index), scoped = head.lastIndexOf('{') > head.lastIndexOf('}')
      const key = scoped ? /(?:at|duration)(?=\s*:\s*$)/.exec(head)?.[0] : index++
      const spec = scoped ? span[key] : method.params[key], value = +number[0]
      if (!spec || !Number.isFinite(value)) continue
      let min = spec.min ?? 0, max = spec.max ?? Math.max(original.duration, length('edited')), step = spec.step ?? .001
      if (call[1] === 'speed' && value < 0) [min, max] = [-max, -min]
      const from = offset + number.index
      fields.push({ ...spec, value, from, to: from + number[0].length, min: Math.min(min, value), max: Math.max(max, value), step })
    }
    if (!fields.length) return null
    return { start, fields, active: fields.findIndex(field => cursor >= field.from && end <= field.to) }
  }
  return null
}

function completeMethod(name) {
  const input = document.querySelector('.program-editor'), [from, to] = assistRange
  const rest = state.draft.slice(to), tail = /^\w*(?:\s*\([^()]*\))?/.exec(rest)[0].length
  const code = '.' + notation(step(name, ...methods[name].args)).js
  state.draft = state.draft.slice(0, from) + code + rest.slice(tail)
  closeAssist()
  queueEdit()
  requestAnimationFrame(() => {
    input.focus({ preventScroll: true })
    const number = /-?\d+(?:\.\d+)?/.exec(code)
    const at = from + (number ? number.index : code.length)
    input.setSelectionRange(at, at + (number?.[0].length || 0))
    inspectCaret()
  })
}

function adjustParameter(event, index) {
  const { fields } = state.options, field = fields[index], value = +event.target.value, text = String(value)
  const shift = text.length - (field.to - field.from)
  state.draft = state.draft.slice(0, field.from) + text + state.draft.slice(field.to)
  // Fields change in place: a replaced row would take the slider from under the pointer.
  field.value = value
  field.to += shift
  for (const later of fields.slice(index + 1)) { later.from += shift; later.to += shift }
  state.options.active = index
  queueEdit(parameterGroup, 50)
}

// A new slider gesture is its own Undo step and marks its number.
function startParameter(index) {
  parameterGroup++
  state.options.active = index
}

function editorBlur() {
  requestAnimationFrame(() => {
    if (!document.activeElement.closest('.program-code, #parameter-menu, #method-menu')) closeAssist()
  })
}

// The pointer lights the choice under it, a name or a number, like a selection.
function hoverCode(event) {
  const token = document.elementsFromPoint(event.clientX, event.clientY).find(el => el.dataset?.choice)
  state.hoverAt = token ? +token.dataset.from : -1
}
function leaveCode() { state.hoverAt = -1 }

// The add menu appends a method with its default arguments. A selected range scopes it: crop and remove take the
// range as theirs, the rest take it as their last argument. The range is on that track's timeline, so the method goes
// where that timeline is: the original's crop first, the edit's methods last.
function addMethod(name) {
  if (state.busy || !state.originalReady) return
  closeAssist()
  document.querySelector('#add-menu').hidePopover()
  const args = methods[name].args.map(value => typeof value === 'object' ? { ...value } : value)
  if (selection && ranged(name)) return editSelection(name)
  if (selection?.name === 'edited' && !methods[name].whole) return change([...state.steps, step(name, ...args, selectedRange())])
  return change([...state.steps, step(name, ...args)])
}

// Where a character offset of the program sits on screen, measured on the highlighted copy.
const caretRect = () => textRect(document.querySelector('.program-editor').selectionStart)
function textRect(offset) {
  const code = document.querySelector('.program-highlight code')
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    if (offset > walker.currentNode.length) { offset -= walker.currentNode.length; continue }
    const range = document.createRange()
    range.setStart(walker.currentNode, offset)
    range.collapse(true)
    const rect = range.getBoundingClientRect()
    if (rect.height) return rect
    break
  }
  return document.querySelector('.program-code').getBoundingClientRect()
}

function placeMenu() {
  cancelAnimationFrame(menuFrame)
  menuFrame = requestAnimationFrame(() => {
    for (const menu of document.querySelectorAll('[popover]:popover-open')) {
      const trigger = document.querySelector(`[popovertarget="${menu.id}"]`)
      // Layout size, not the bounding box: the opening animation briefly scales the menu.
      const anchor = trigger ? trigger.getBoundingClientRect() : caretRect(), width = menu.offsetWidth, height = menu.offsetHeight
      // A menu starts at its trigger's left edge, or ends at its right edge when it would overflow.
      const left = !trigger || anchor.left + width <= innerWidth - 16 ? anchor.left : anchor.right - width
      menu.style.left = Math.max(16, Math.min(left, innerWidth - width - 16)) + 'px'
      const below = anchor.bottom + 8, above = anchor.top - height - 8, down = below + height <= innerHeight - 16 || above < 16
      menu.style.top = Math.max(16, Math.min(down ? below : above, innerHeight - height - 16)) + 'px'
      menu.dataset.side = down ? 'below' : 'above'
    }
  })
}

function openMenu(event) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  const menu = event.currentTarget.popoverTargetElement
  if (!menu.matches(':popover-open')) event.currentTarget.click()
  const buttons = menu.querySelectorAll('button:not(:disabled)')
  ;(event.key === 'ArrowUp' ? buttons[buttons.length - 1] : menu.querySelector('[aria-current="true"]') || buttons[0])?.focus()
}

function menuKey(event) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]
  const index = buttons.indexOf(document.activeElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}

function showSelection(next) {
  selection = next && next.a !== next.b ? next : null
  state.selected = selection?.name || ''
  state.selectionLabel = selection ? range(selection.name).map(duration).join('–') : ''
  if (selection) measureSelection()
  for (const [name, track] of Object.entries(waves)) {
    const active = selection?.name === name
    track.style.setProperty('--selection-start', active ? Math.min(selection.a, selection.b) * 100 + '%' : '0%')
    track.style.setProperty('--selection-end', active ? Math.max(selection.a, selection.b) * 100 + '%' : '0%')
  }
}

// The selected range's peak, measured by the library on that track's samples like the track's own reading; the
// newest request wins, and the last reading stays until it lands.
let measuring = 0
async function measureSelection() {
  const request = ++measuring, [at, end] = range(selection.name), clip = measure[selection.name]
  try {
    const db = await clip.stat('db', { at, duration: end - at })
    if (request === measuring) state.selectionMeters = dbfs(db)
  } catch { if (request === measuring) state.selectionMeters = '–' }
}

function clearSelection() {
  const resume = selection && (state.playing || state.pending) && state.preview === selection.name
  if (resume) stop()
  showSelection(null)
  if (resume) play(state.preview)
}

// The selection as { at, duration }, at the precision it was made with: a thousandth of the track, so the code stays readable.
function selectedRange() {
  const name = selection.name, rate = original.sampleRate, total = Math.round(length(name) * rate)
  const digits = Math.max(0, Math.ceil(-Math.log10(length(name) / 1000)))
  const round = seconds => +seconds.toFixed(digits)
  let [at, end] = range(name).map(round)
  // The library rounds seconds to samples: at least one sample stays.
  if (Math.round(at * rate) > total - 1) at = (total - 1) / rate
  let duration = round(end - at)
  if (Math.round(duration * rate) < 1) duration = 1 / rate
  return { at, duration }
}

// Crop keeps the selected range and Remove cuts it out; only the edit's selection removes.
function editSelection(type) {
  if (!selection || state.busy || (type === 'remove' && selection.name !== 'edited')) return
  const { at, duration } = selectedRange(), steps = state.steps, first = steps[0], last = steps.at(-1)
  if (type === 'remove') return change([...steps, step('remove', { at, duration })])
  // Cropping again updates the crop already at that end of the chain: the original's first, the edit's last.
  if (selection.name === 'original') return change([step('crop', { at, duration }), ...(first?.type === 'crop' ? steps.slice(1) : steps)])
  if (last?.type === 'crop') return change([...steps.slice(0, -1), step('crop', { at: +(last.args[0].at + at).toPrecision(12), duration })])
  return change([...steps, step('crop', { at, duration })])
}

function beginSelection(name, event) {
  if (!available(name) || event.button !== 0 || drag) return
  event.preventDefault()
  const track = waves[name], rect = track.getBoundingClientRect()
  const playing = (state.playing || state.pending) ? state.preview : null, a = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  stop()
  drag = { name, id: event.pointerId, x: event.clientX, rect, a, before: selection, position: position[name], preview: state.preview, playing, moved: false }
  // The press makes its track the active one and puts the caret under the pointer at once; dragging selects from there.
  showSelection(null)
  state.preview = name
  position[name] = a * length(name)
  paint()
  track.querySelector('input').focus({ preventScroll: true, focusVisible: false })
  track.setPointerCapture(event.pointerId)
}

function moveSelection(event) {
  if (!drag || drag.id !== event.pointerId) return
  if (!drag.moved && Math.abs(event.clientX - drag.x) < 4) return
  drag.moved = true
  const b = Math.max(0, Math.min(1, (event.clientX - drag.rect.left) / drag.rect.width))
  showSelection({ name: drag.name, a: drag.a, b })
  position[drag.name] = Math.min(drag.a, b) * length(drag.name)
  paint()
}

function finishSelection(event) {
  if (!drag || drag.id !== event.pointerId) return
  moveSelection(event)
  const current = drag
  drag = null
  waves[current.name].releasePointerCapture(current.id)
  if (!current.moved && current.playing === current.name) play(current.name)
}

function cancelSelection(event) {
  if (!drag || (event?.pointerId != null && event.pointerId !== drag.id)) return
  const current = drag
  drag = null
  if (waves[current.name].hasPointerCapture(current.id)) waves[current.name].releasePointerCapture(current.id)
  showSelection(current.before)
  position[current.name] = current.position
  state.preview = current.preview
  paint()
  if (current.playing) play(current.playing)
}

function selectionKey(name, event) {
  if (!available(name)) return
  if (event.key === 'Escape') { if (drag) cancelSelection(); else clearSelection(); return }
  const all = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'
  if (!all && !(event.shiftKey && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))) return
  event.preventDefault()
  stop()
  state.preview = name
  const a = selection?.name === name ? selection.a : position[name] / length(name)
  const head = selection?.name === name ? selection.b : a
  const b = all || event.key === 'End' ? 1 : event.key === 'Home' ? 0 : Math.max(0, Math.min(1, head + (event.key === 'ArrowRight' ? .001 : -.001)))
  showSelection({ name, a: all ? 0 : a, b })
  position[name] = Math.min(all ? 0 : a, b) * length(name)
  paint()
}

function seek(name, fraction) {
  const resume = (state.playing || state.pending) && state.preview === name
  stop()
  clearSelection()
  state.preview = name
  position[name] = fraction * length(name)
  paint()
  if (resume && fraction < 1) play(name)
}

async function play(name) {
  if (!available(name)) return
  const pause = (state.playing || state.pending) && state.preview === name
  stop()
  if (pause) return
  state.preview = name
  const request = ++playback
  state.message = ''
  state.pending = true
  try {
    const audioContext = context()
    await audioContext.resume()
    if (request !== playback) return
    let buffer = buffers[name]
    if (!buffer) {
      const pcm = name === 'edited' ? editedPCM : originalPCM
      buffer = audioContext.createBuffer(pcm.length, pcm[0].length, original.sampleRate)
      pcm.forEach((channel, i) => buffer.copyToChannel(channel, i))
      buffers[name] = buffer
    }
    const [from, to] = range(name)
    if (position[name] < from || position[name] >= to) position[name] = from
    player = audioContext.createBufferSource()
    player.buffer = buffer
    player.connect(audioContext.destination)
    startTime = audioContext.currentTime - position[name]
    player.onended = () => { player?.disconnect(); player = null; stop(); position[name] = to; paint() }
    player.start(0, position[name], to - position[name])
    state.pending = false
    state.playing = true
    function tick() {
      paint()
      frame = requestAnimationFrame(tick)
    }
    tick()
  } catch {
    if (request !== playback) return
    stop()
    state.message = 'Audio playback is unavailable. Try downloading the WAV instead.'
  }
}

async function openFile(event) {
  const file = event.target.files[0]
  event.target.value = ''
  if (!file) return
  state.message = ''
  if (file.size > 20 * 1024 * 1024) { state.message = 'This demo accepts files up to 20 MB. Choose a smaller recording.'; return }
  stop()
  state.busy = true
  try {
    const buffer = await context().decodeAudioData(await file.arrayBuffer())
    if (!buffer.length) throw new Error('Empty recording')
    if (buffer.duration > 120) { state.message = 'This demo accepts recordings up to two minutes. Choose a shorter clip.'; return }
    await load(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice()), buffer.sampleRate, file.name)
  } catch { state.message = 'This file could not be opened. Try a WAV or MP3 recording.' }
  finally { finishWork() }
}

async function download() {
  if (state.editPending) await applyDraft()
  if (state.busy || state.chainError || !state.ready) return
  closeAssist()
  const format = state.format
  state.busy = state.saving = true
  state.message = ''
  try {
    const bytes = await edited.encode(format, { meta: false })
    const url = URL.createObjectURL(new Blob([bytes], { type: formats[format].mime }))
    const link = document.createElement('a')
    link.href = url
    link.download = state.saveName
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  } catch { state.message = 'Export failed. Try again.' }
  finally { state.saving = false; finishWork() }
}

async function copy(text, target) {
  try {
    await navigator.clipboard.writeText(text)
    clearTimeout(copyTimer)
    state.copied = target
    state.copyMessage = target === 'install' ? 'Install command copied.' : 'Code copied.'
    copyTimer = setTimeout(() => { state.copied = ''; state.copyMessage = '' }, 1800)
  } catch { state.copyMessage = 'Clipboard unavailable. Select and copy the code directly.' }
}

state = sprae(document.querySelector('#site'), {
  version: audio.version, originalMeters: '…', editedMeters: '…',
  examples: examples(defaults(), 'wav'), steps: defaults(), draft: '', applied: '', chainError: '', editPending: false, assist: 'method', suggestions: [], suggestionIndex: 0, options: null, methods, formats, format: 'wav', undoCount: 0, selected: '', selectionLabel: '',
  tab: 'node', copied: '', copyMessage: '',
  sample: 'chime', filename: 'chime', saveName: 'chime.wav', hoverAt: -1, selectionMeters: '', originalDuration: '0:08.0', editedDuration: '…',
  editCount: 3, preview: 'edited', playing: false, pending: false, timecode: '0:00.0',
  busy: true, saving: false, ready: false, originalReady: false, message: '', editMessage: '',
  // The readout shows one thing: a chain error while typing, else the selected range, else a message, else the position.
  get error() { return this.chainError && !this.suggestions.length ? this.chainError : '' },
  get notice() { return this.error || (this.selected ? '' : this.message || this.editMessage) },
  // The name whose list is open stays lit.
  get listing() { return this.suggestions.length ? { sample: 'source', format: 'save' }[this.assist] || '' : '' },
  play, seek, inputCode, composition, editKey, inspectCaret, editorBlur, closeParameter: closeAssist, completeMethod, adjustParameter, startParameter, addMethod, clickCode, placeMenu, openMenu, menuKey, highlight, highlightProgram, hoverCode, leaveCode, accept, saveable, codeLines, moveTab, beginSelection, moveSelection, finishSelection, cancelSelection, selectionKey, clearSelection, editSelection,
  undo, openFile, copy
})
await load(samples.chime.make(), RATE, 'chime', 'chime')
new ResizeObserver(drawWaves).observe(waves.original)
window.addEventListener('resize', () => { placeMenu(); moveTab() })
document.fonts.ready.then(() => moveTab())
window.addEventListener('scroll', placeMenu, { passive: true })
document.addEventListener('pointerdown', event => { if (!event.target.closest('.program-code, #method-menu, #parameter-menu')) closeAssist() })
window.addEventListener('pagehide', () => { cancelEdit(); stop(); ctx?.close(); ctx = null })
