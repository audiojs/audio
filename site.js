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
const formats = {
  wav: { mime: 'audio/wav', description: 'Uncompressed PCM' },
  mp3: { mime: 'audio/mpeg', description: 'Compressed audio' },
  flac: { mime: 'audio/flac', description: 'Lossless compression' },
  aiff: { mime: 'audio/aiff', description: 'Uncompressed PCM' },
  ogg: { mime: 'audio/ogg', description: 'Vorbis compression' }
}
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
// A step as its pill reads it: the call's name, then its values, each unit joined to its number, a range as
// start–end seconds.
function figure(value, unit = '') {
  const sign = value < 0 ? '−' : value > 0 && (unit === 'dB' || unit === 'st') ? '+' : ''
  return sign + decimal(+Math.abs(value).toPrecision(6)) + unit
}
const summary = ({ type, args }) => args.map((value, i) => typeof value === 'object'
  ? `${figure(value.at)}–${figure(value.at + value.duration, 's')}`
  : figure(value, methods[type].params[i]?.unit)).join(', ')

// A step as a person would ask an agent for it; a range on the timeline follows as from–to seconds.
const inSeconds = value => figure(value, 's')
const phrases = {
  trim: db => 'trim the silence' + (db == null ? '' : ` below ${figure(db, 'dB')}`),
  crop: ({ at, duration }) => `keep ${inSeconds(at)} to ${inSeconds(at + duration)}`,
  remove: ({ at, duration }) => `cut ${inSeconds(at)} to ${inSeconds(at + duration)}`,
  pad: (before, after = before) => `pad ${inSeconds(before)} of silence before and ${inSeconds(after)} after`,
  shrink: (gap = .3) => `shorten pauses to ${inSeconds(gap)}`,
  repeat: times => `repeat it ${figure(times)} times`,
  reverse: () => 'reverse it',
  gain: db => `change the volume by ${figure(db, 'dB')}`,
  normalize: db => db == null ? 'normalize the peak' : `normalize the peak to ${figure(db, 'dB')}`,
  fade: (fadeIn, fadeOut = 0) => 'fade ' + ([fadeIn && `in ${inSeconds(fadeIn)}`, fadeOut && `out ${inSeconds(fadeOut)}`].filter(Boolean).join(' and ') || `in ${inSeconds(0)}`),
  speed: rate => `play it at ${figure(rate, '×')} speed`,
  stretch: factor => `stretch it to ${figure(factor, '×')} the length, keeping the pitch`,
  pitch: semitones => `shift the pitch ${figure(semitones, 'st')}`,
  lowpass: hz => `cut above ${figure(hz, 'Hz')}`,
  highpass: hz => `cut below ${figure(hz, 'Hz')}`,
  eq: (hz, db, q) => `${db < 0 ? 'cut' : 'boost'} ${figure(Math.abs(db))}dB around ${figure(hz, 'Hz')}${q ? ` with a Q of ${figure(q)}` : ''}`
}
function prompt(steps, format) {
  const clauses = steps.map(({ type, args }) => {
    const scope = args.find(value => typeof value === 'object'), numbers = args.filter(value => typeof value === 'number')
    if (ranged(type)) return phrases[type](scope)
    return phrases[type](...numbers) + (scope ? ` from ${inSeconds(scope.at)} to ${inSeconds(scope.at + scope.duration)}` : '')
  })
  return clauses.length ? `In recording.wav, ${clauses.join(', ')}, then save it as edited.${format}.` : `Save recording.wav as edited.${format}.`
}
// Words wrapped to lines of at most `width` characters.
const wrap = (text, width = 60) => text.split(' ').reduce((lines, word) =>
  (lines.at(-1) + ' ' + word).length > width ? [...lines, word] : [...lines.slice(0, -1), (lines.at(-1) + ' ' + word).trim()], ['']).join('\n')

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
    // The agent is asked in words, and calls the audio tool with the CLI's arguments.
    mcp: `# Once, in Claude Code
claude mcp add audio -- npx -y audio --mcp

# Or Claude Desktop, Cursor, VS Code
{ "mcpServers": { "audio": {
  "command": "npx", "args": ["-y", "audio", "--mcp"]
} } }

# Ask your agent
${wrap(prompt(steps, format))}

# It calls the audio tool
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

function highlight(source) {
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const tokens = /(\/\/[^\n]*|#[^\n]*)|('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|\b(import|from|const|await|new)\b|([+-]?(?:\b\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?![\w$]|\.\w)|\b([\w$]+)(?=\()/g
  let html = '', offset = 0
  for (const match of source.matchAll(tokens)) {
    const kind = ['comment', 'string', 'keyword', 'number', 'call'][match.slice(1).findIndex(value => value != null)]
    html += escape(source.slice(offset, match.index)) + `<span class="syntax-${kind}">${escape(match[0])}</span>`
    offset = match.index + match[0].length
  }
  return html + escape(source.slice(offset))
}

// Selection summaries use the library's sample peak in dBFS.
const signed = value => (value < 0 ? '−' : value > 0 ? '+' : '') + Math.abs(value).toFixed(1)
const dbfs = db => `${Number.isFinite(db) ? signed(db) : '−∞'} dBFS`
// Each track's samples as a plain clip for measuring a selection.
const measure = { original: null, edited: null }
function measured(name, pcm, sampleRate) {
  measure[name]?.dispose()
  return measure[name] = audio.from(pcm, { sampleRate })
}

let state, original, edited, originalPCM, editedPCM, originalPeaks, editedPeaks
let ctx, player, startTime = 0, frame, menuFrame, copyTimer, editTimer, playback = 0, history = [], selection = null, drag = null
let lastGroup = 0, parameterGroup = 0, recording
const position = { original: 0, edited: 0 }
const buffers = { original: null }
const waves = { original: document.querySelector('#original-wave'), edited: document.querySelector('#edited-wave') }
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
// Tenths, floored once rounded to the millisecond: 441,600 frames at 48 kHz read 9.2 s, not floating point's 9.1999….
const duration = seconds => { const tenths = Math.floor(Math.round(seconds * 1000) / 100); return `${clock(tenths / 10)}.${tenths % 10}` }

function context() { return ctx ||= new AudioContext() }
const length = name => (name === 'original' ? original : edited)?.duration || 0
const available = name => !state.transportBusy && (name === 'original' ? state.originalReady : state.ready)

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
  if (state.recording) drawRecording()
  else draw(waves.original, originalPeaks)
  draw(waves.edited, editedPeaks)
}

const playhead = name => state.playing && state.preview === name ? player?.position?.() ?? ctx.currentTime - startTime : position[name]
// A 10 ms window at the cursor gives a stable local peak without scanning the track each frame.
function cursorLevel(name, elapsed) {
  const pcm = name === 'original' ? originalPCM : editedPCM, clip = name === 'original' ? original : edited
  if (!pcm?.[0].length || (name === 'edited' && !state.ready)) return '–'
  const from = Math.min(pcm[0].length - 1, Math.floor(elapsed * clip.sampleRate))
  const to = Math.min(pcm[0].length, from + Math.ceil(clip.sampleRate * .01))
  let peak = 0
  for (const channel of pcm) for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(channel[i]))
  return dbfs(20 * Math.log10(peak))
}
function paint() {
  for (const [name, track] of Object.entries(waves)) {
    const total = length(name)
    const elapsed = Math.max(0, Math.min(total, playhead(name)))
    const progress = total ? elapsed / total : 0
    track.style.setProperty('--progress', progress * 100 + '%')
    track.style.setProperty('--cursor-opacity', total > 0 ? 1 : 0)
    const input = track.querySelector('input')
    input.value = progress * 1000
    input.setAttribute('aria-valuetext', `${clock(elapsed)} of ${duration(total)}`)
    if (name === state.preview) { state.timecode = duration(elapsed); state.cursorMeters = cursorLevel(name, elapsed) }
  }
}

function stop(clear = false) {
  playback++
  if (state.playing) position[state.preview] = playhead(state.preview)
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
  measured('edited', editedPCM, edited.sampleRate)
  draw(waves.edited, editedPeaks)
  if (state.ready && selection?.name === 'edited') showSelection(selection)
  paint()
}

// Keep the name stable across formats and parameter changes; only the save menu adds an extension.
const downloadName = (format = state.format) => state.saveName + '.' + format

// A new source: a sample by name keeps the edits; an opened file starts from the defaults.
async function load(pcm, sampleRate, name, sample = '', steps = null) {
  stop(true)
  edited?.dispose()
  original?.dispose()
  original = audio.from(pcm, { sampleRate })
  originalPCM = pcm
  buffers.original = null
  state.originalReady = pcm[0].length > 0
  state.originalDuration = duration(original.duration)
  measured('original', pcm, sampleRate)
  originalPeaks = peaks(pcm)
  draw(waves.original, originalPeaks)
  state.sample = sample
  state.filename = name
  state.saveName = (sample || name.replace(/\.[^.]+$/, '') || name) + '-edited'
  if (!steps) return reset()
  state.steps = steps
  return render()
}
const useSample = (name, steps = state.steps) => load(samples[name].make(), RATE, name, name, steps)

async function render(sync = true) {
  cancelReorder()
  if (sync) cancelEdit()
  const focused = document.activeElement
  cancelSelection()
  // A live render keeps the open step's sliders; any other closes its menu.
  if (sync) { stop(true); clearSelection(); closePill() }
  state.message = state.editMessage = ''
  state.busy = true
  if (sync) state.ready = false
  state.undoCount = history.length
  state.examples = examples(state.steps, state.format)
  let next
  try {
    next = original.clone()
    for (const { type, args } of state.steps) {
      next[type](...args)
      if (!Number.isFinite(next.duration) || next.duration > 120) {
        state.ready = false
        state.editMessage = 'Keep the edited audio within two minutes.'
        return
      }
    }
    if (!sync && edited) {
      // A playing selection keeps its time boundaries when an edit changes the track length.
      if (selection?.name === 'edited' && next.duration > 0) {
        const scale = edited.duration / next.duration
        selection = { ...selection, a: Math.min(1, selection.a * scale), b: Math.min(1, selection.b * scale) }
      }
      // Keep the streaming instance: its next block patches the plan and ramps changed values.
      edited.undo(edited.edits.length)
      edited.run(...next.edits)
    } else {
      edited?.dispose()
      edited = next
      next = null
    }
    await refresh()
  } catch {
    state.ready = false
    state.editMessage = 'The edits could not be applied. Undo or change the chain.'
  }
  finally {
    next?.dispose()
    if (!state.ready) {
      if (state.preview === 'edited') stop()
      if (selection?.name === 'edited') showSelection(null)
    }
    finishWork()
    if (document.activeElement === document.body && focused?.isConnected) focused.focus({ preventScroll: true })
  }
}

// A file starts from the default edits, with nothing to undo.
function reset() {
  state.steps = defaults()
  history = []
  return render()
}

function undo() {
  if (state.busy || !history.length) return
  cancelEdit()
  state.steps = history.pop()
  return render()
}

const copySteps = steps => steps.map(({ type, args }) => ({ type, args: args.map(value => typeof value === 'object' ? { ...value } : value) }))
// One Undo step per edit, and one per slider gesture however many values it passes through.
function remember(group = 0) {
  if (!group || group !== lastGroup) history.push(copySteps(state.steps))
  lastGroup = group
}

function change(steps) {
  if (state.busy) return
  remember()
  state.steps = steps
  return render()
}

// Reordering previews only the layout. A completed drop changes the audio once, as one Undo step.
let reorder = null
const links = () => [...document.querySelectorAll('.chain .link')]
const bounds = elements => elements.map(el => el.getBoundingClientRect())
const motion = () => {
  const style = getComputedStyle(document.documentElement)
  return { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : parseFloat(style.getPropertyValue('--dur-short')), easing: style.getPropertyValue('--ease-out').trim() }
}
function slide(el, from) {
  el.getAnimations().forEach(animation => animation.cancel())
  const to = el.getBoundingClientRect(), timing = motion()
  if (!timing.duration || (Math.abs(from.left - to.left) < .5 && Math.abs(from.top - to.top) < .5)) return
  el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], timing)
}
const moved = (order, from, to) => { const next = [...order]; next.splice(to, 0, ...next.splice(from, 1)); return next }
async function commitOrder(order, to, before) {
  const name = state.steps[order[to]].type
  await change(order.map(index => state.steps[index]))
  links().forEach((el, index) => slide(el, before[order[index]]))
  pill(to)?.focus({ preventScroll: true })
  state.reorderMessage = `${name} moved to position ${to + 1} of ${order.length}.`
}
function moveStep(from, to) {
  if (state.busy || reorder || to < 0 || to >= state.steps.length || from === to) return
  const order = moved(state.steps.map((_, index) => index), from, to)
  return commitOrder(order, to, bounds(links()))
}
function beginReorder(event) {
  const button = event.target.closest('.pill')
  if (!button || button.disabled || state.busy || state.editPending || reorder || event.button !== 0 || !event.isPrimary) return
  const elements = links(), from = +button.dataset.key
  reorder = { id: event.pointerId, x: event.clientX, y: event.clientY, from, to: from, button, elements, chain: event.currentTarget, order: elements.map((_, i) => i) }
  window.addEventListener('pointermove', previewReorder)
  window.addEventListener('pointerup', finishReorder)
  window.addEventListener('pointercancel', cancelReorder)
  window.addEventListener('keydown', reorderKey, true)
  window.addEventListener('blur', cancelReorder)
  window.addEventListener('resize', cancelReorder)
  reorder.chain.addEventListener('lostpointercapture', lostReorder)
}
function previewReorder(event) {
  const d = reorder
  if (!d || event.pointerId !== d.id) return
  if (!d.clone) {
    if (Math.hypot(event.clientX - d.x, event.clientY - d.y) < 5) return
    const rect = d.button.getBoundingClientRect()
    closePill()
    document.querySelector('#add-menu').hidePopover()
    d.dx = d.x - rect.left
    d.dy = d.y - rect.top
    d.clone = d.button.cloneNode(true)
    d.clone.className = 'pill dragged'
    d.clone.removeAttribute('data-key')
    d.clone.removeAttribute('aria-expanded')
    d.clone.setAttribute('aria-hidden', 'true')
    d.clone.tabIndex = -1
    d.clone.style.width = rect.width + 'px'
    document.body.append(d.clone)
    d.chain.classList.add('reordering')
    state.draggingStep = true
    d.elements.at(-1).classList.add('last')
    d.elements[d.from].classList.add('drag-source')
    d.chain.setPointerCapture(d.id)
  }
  event.preventDefault()
  d.clone.style.transform = `translate(${event.clientX - d.dx}px, ${event.clientY - d.dy}px)`
  const trash = document.querySelector('.tool.add'), over = trashHit(event)
  trash.classList.toggle('drop-target', over)
  d.clone.style.visibility = over ? 'hidden' : ''
  if (over) return
  // Read settled slots, not their in-flight animation positions, so crossing a neighbor cannot oscillate.
  const chainBox = d.chain.getBoundingClientRect()
  const slots = d.order.map(index => {
    const el = d.elements[index]
    return { left: chainBox.left + el.offsetLeft - d.chain.offsetLeft, top: chainBox.top + el.offsetTop - d.chain.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
  })
  const x = event.clientX - d.dx + d.clone.offsetWidth / 2, y = event.clientY - d.dy + d.clone.offsetHeight / 2
  let to = d.to, distance = Infinity
  slots.forEach((slot, i) => {
    const delta = (x - slot.left - slot.width / 2) ** 2 + 4 * (y - slot.top - slot.height / 2) ** 2
    if (delta < distance) { distance = delta; to = i }
  })
  if (to === d.to) return
  const before = bounds(d.elements)
  d.elements.forEach(el => el.getAnimations().forEach(animation => animation.cancel()))
  d.order = moved(d.order, d.to, to)
  d.to = to
  d.order.forEach((index, order) => { d.elements[index].style.order = order; d.elements[index].classList.toggle('last', order === d.order.length - 1) })
  d.elements.forEach((el, index) => { if (index !== d.from) slide(el, before[index]) })
}
function trashHit(event) {
  const box = document.querySelector('.tool.add').getBoundingClientRect()
  return event?.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
}
async function finishReorder(event, cancel = false) {
  const d = reorder
  if (!d || (event?.pointerId != null && event.pointerId !== d.id)) return
  reorder = null
  window.removeEventListener('pointermove', previewReorder)
  window.removeEventListener('pointerup', finishReorder)
  window.removeEventListener('pointercancel', cancelReorder)
  window.removeEventListener('keydown', reorderKey, true)
  window.removeEventListener('blur', cancelReorder)
  window.removeEventListener('resize', cancelReorder)
  d.chain.removeEventListener('lostpointercapture', lostReorder)
  if (!d.clone) return
  if (d.chain.hasPointerCapture(d.id)) d.chain.releasePointerCapture(d.id)
  // Capture the pointer-generated click before it can open a menu after a drop.
  const suppress = event => { event.preventDefault(); event.stopImmediatePropagation() }
  d.chain.addEventListener('click', suppress, { capture: true, once: true })
  setTimeout(() => d.chain.removeEventListener('click', suppress, true), 0)
  const box = d.chain.getBoundingClientRect(), remove = !cancel && trashHit(event)
  if (!remove && event?.clientX != null && (event.clientX < box.left - 32 || event.clientX > box.right + 32 || event.clientY < box.top - 32 || event.clientY > box.bottom + 32)) cancel = true
  const before = bounds(d.elements)
  const floating = d.clone.getBoundingClientRect()
  before[d.from] = { left: floating.left, top: floating.top }
  d.elements.forEach(el => { el.getAnimations().forEach(animation => animation.cancel()); el.style.order = ''; el.classList.remove('last', 'drag-source') })
  d.chain.classList.remove('reordering')
  state.draggingStep = false
  document.querySelector('.tool.add').classList.remove('drop-target')
  d.clone.remove()
  if (remove) return removeStep(d.from)
  if (!cancel && d.from !== d.to) return commitOrder(d.order, d.to, before)
  d.elements.forEach((el, index) => slide(el, before[index]))
  d.button.focus({ preventScroll: true })
}
function cancelReorder(event) { finishReorder(event, true) }
function lostReorder(event) { if (event.target === reorder?.chain) cancelReorder(event) }
function reorderKey(event) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  cancelReorder()
}

function cancelEdit() {
  clearTimeout(editTimer)
  editTimer = null
  state.editPending = false
}

// A render in flight takes no new one: a slider's latest value renders as soon as it lands.
function finishWork() {
  state.busy = false
  if (state.editPending) { clearTimeout(editTimer); editTimer = setTimeout(applyPending, 0) }
}

function applyPending() {
  clearTimeout(editTimer)
  editTimer = null
  if (state.busy) return
  state.editPending = false
  return render(false)
}

// Each pill opens one menu under it: files, recording and samples under the source, downloads under save, a
// step's numbers under the step, one slider each.
const icons = {
  sample: 'M4 10v4m4-8v12m4-14v16m4-12v8m4-6v4',
  file: 'M9 17V5l10-2v12M9 17a3 3 0 1 1-3-3h3m10 1a3 3 0 1 1-3-3h3',
  download: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
  record: 'M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14Z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 10v7m4-7v7'
}
function menuItems(open) {
  if (open === 'source') return [
    { id: '', code: 'Open a file…', text: 'WAV, MP3, FLAC and more', icon: icons.file },
    { id: 'record', code: 'Record', text: '', icon: icons.record, solid: true },
    ...Object.entries(samples).map(([name, { description }], index) => ({ id: name, code: name, text: description, icon: icons.sample, separator: index === 0, current: name === state.sample }))
  ]
  if (open === 'save') return Object.entries(formats).map(([ext, { description }]) =>
    ({ id: ext, code: downloadName(ext), text: description, format: ext.toUpperCase(), current: ext === state.format, disabled: state.busy || !state.ready }))
  return []
}

// The step's numbers, one slider each, in the method's own ranges; times reach the longer track.
function fieldsOf({ type, args }) {
  const longest = Math.max(original.duration, length('edited'))
  const field = (spec, value, arg, key) => {
    let min = spec.min ?? 0, max = spec.max ?? longest
    if (type === 'speed' && value < 0) [min, max] = [-max, -min]
    return { label: spec.label, unit: spec.unit, value, arg, key, step: spec.step ?? .001, min: Math.min(min, value), max: Math.max(max, value) }
  }
  const values = [...args]
  if (type === 'trim' && typeof values[0] !== 'number') values.unshift(null)
  return values.flatMap((value, arg) => value === null
    ? [{ ...field(methods[type].params[arg], -40, arg), auto: true, optional: true }]
    : typeof value === 'object'
    ? ['at', 'duration'].map(key => field(span[key], value[key], arg - (values[0] === null ? 1 : 0), key))
    : methods[type].params[arg] ? [{ ...field(methods[type].params[arg], value, arg), optional: type === 'trim' }] : [])
}

const pill = key => document.querySelector(`.pill[data-key="${key}"]`)
function openPill(key) {
  if (state.open === key) return closePill()
  const fields = typeof key === 'number' ? fieldsOf(state.steps[key]) : []
  if (typeof key === 'number' && !fields.length) return closePill()
  batch(() => { state.fields = fields; state.open = key })
  const menu = document.querySelector('#pill-menu')
  if (!menu.matches(':popover-open')) menu.showPopover()
  placeMenu(true)
}
function closePill(focus = false) {
  if (state.open == null) return
  if (focus) pill(state.open)?.focus({ preventScroll: true })
  batch(() => { state.open = null; state.fields = [] })
  document.querySelector('#pill-menu').hidePopover()
}
// Arrow keys on a pill open its menu and step into it.
function pillKey(event, key) {
  if (typeof key === 'number' && ['Delete', 'Backspace'].includes(event.key) && !event.altKey && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    return removeStep(key)
  }
  if (typeof key === 'number' && event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault()
    return moveStep(key, key + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1))
  }
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault()
  if (state.open !== key) openPill(key)
  requestAnimationFrame(() => {
    const menu = document.querySelector('#pill-menu'), items = menu.querySelectorAll('button:not(:disabled), input')
    ;(menu.querySelector('[aria-current="true"]:not(:disabled)') || items[event.key === 'ArrowUp' ? items.length - 1 : 0])?.focus()
  })
}
function pillMenuKey(event) { if (!event.target.matches('input')) menuKey(event) }
function choose(item) {
  const open = state.open
  if (item.disabled) return
  closePill(true)
  if (open === 'save') return download(item.id)
  if (item.id === 'record') return record()
  if (!item.id) return document.querySelector('#audio-file').click()
  if (item.id !== state.sample && !state.busy) return useSample(item.id)
}
// A trash drop or Delete takes that step out; an empty chain leaves focus on +.
async function removeStep(at) {
  if (state.busy || state.saving || state.recording || state.micPending || !Number.isInteger(at) || !state.steps[at]) return
  const name = state.steps[at].type
  closePill()
  await change(state.steps.filter((_, i) => i !== at))
  ;(pill(Math.max(0, at - 1)) || document.querySelector('.tool.add'))?.focus({ preventScroll: true })
  state.reorderMessage = `${name} removed.`
}
// A slider moves one number of the open step. Its field changes in place, so the slider stays under the pointer; the
// render follows the latest value.
function adjust(event, index) {
  const at = state.open, field = state.fields[index], value = +event.target.value
  if (typeof at !== 'number' || !field) return
  remember(parameterGroup)
  field.value = value
  // In place, so the pill stays the same element through the drag.
  const args = state.steps[at].args
  if (field.optional && typeof args[0] !== 'number') {
    args.unshift(value)
    state.fields.filter(field => field.key).forEach(field => field.arg++)
  }
  field.auto = false
  args[field.arg] = field.key ? { ...args[field.arg], [field.key]: value } : value
  state.editPending = true
  clearTimeout(editTimer)
  if (!state.busy) editTimer = setTimeout(applyPending, 50)
  // A wider value widens the pill, and may wrap it: the menu follows.
  placeMenu()
}
// A new slider gesture is its own Undo step.
function startParameter() { parameterGroup++ }
function autoThreshold(index) {
  const field = state.fields[index], edit = state.steps[state.open]
  if (!field?.optional || field.auto) return
  remember(++parameterGroup)
  edit.args.shift()
  state.fields.filter(field => field.key).forEach(field => field.arg--)
  field.auto = true
  state.editPending = true
  applyPending()
}
// Command or Control+Z undoes anywhere in the demo.
function demoKey(event) {
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'z') { event.preventDefault(); undo() }
}

// The add menu appends a method with its default arguments. A selected range scopes it: crop and remove take the
// range as theirs, the rest take it as their last argument. The range is on that track's timeline, so the method goes
// where that timeline is: crop/remove on the original first, methods on the edit last.
function addMethod(name) {
  if (state.busy || !state.originalReady) return
  closePill()
  document.querySelector('#add-menu').hidePopover()
  const args = methods[name].args.map(value => typeof value === 'object' ? { ...value } : value)
  if (selection && ranged(name)) return editSelection(name)
  if (selection?.name === 'edited' && !methods[name].whole) return change([...state.steps, step(name, ...args, selectedRange())])
  return change([...state.steps, step(name, ...args)])
}

// Each menu's tab sits over its trigger and joins its panel.
// Measure the full menu before scrolling to make room, then constrain only its contents.
function placeMenu(opening = false) {
  cancelAnimationFrame(menuFrame)
  menuFrame = requestAnimationFrame(() => {
    for (const menu of document.querySelectorAll('[popover]:popover-open')) {
      const isPill = menu.id === 'pill-menu', panel = menu.querySelector('.pill-body, .add-body')
      const trigger = isPill ? pill(state.open) : document.querySelector(`[popovertarget="${menu.id}"]`)
      if (!trigger) continue
      panel.style.maxHeight = 'none'
      let anchor = trigger.getBoundingClientRect()
      if (isPill) {
        menu.dataset.kind = state.open
        menu.style.width = state.open === 'source' || state.open === 'save' ? 'max-content' : '240px'
        menu.style.minWidth = Math.min(innerWidth - 32, Math.max(240, Math.ceil(anchor.width))) + 'px'
        menu.style.maxWidth = innerWidth - 32 + 'px'
      }
      // Menus fade in place; measure their full height before limiting the scrolling body.
      const width = menu.offsetWidth, height = menu.getBoundingClientRect().height
      if (opening === true) {
        // Keep the trigger visible when the full menu is taller than the available screen.
        const shift = Math.min(Math.max(0, Math.ceil(anchor.top + height - (innerHeight - 16))), Math.floor(anchor.top - 16))
        if (shift) { scrollBy({ top: shift, behavior: 'instant' }); anchor = trigger.getBoundingClientRect() }
      }
      // A menu starts at its trigger's left edge, or ends at its right edge when it would overflow.
      const left = Math.max(16, Math.min(isPill && anchor.left + width <= innerWidth - 16 ? anchor.left : anchor.right - width, innerWidth - width - 16))
      menu.style.left = left + 'px'
      menu.style.top = anchor.top + 'px'
      panel.style.maxHeight = Math.max(120, innerHeight - 16 - anchor.top - panel.offsetTop) + 'px'
      menu.style.setProperty('--tab-x', anchor.left - left + 'px')
      menu.style.setProperty('--tab-width', anchor.width + 'px')
      menu.dataset.join = anchor.left - left < 1 ? 'left' : left + width - anchor.right < 1 ? 'right' : ''
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

// A selection on the original applies before the chain; one on the edit applies after it.
async function editSelection(type) {
  if (!selection || state.busy) return
  const { at, duration } = selectedRange(), steps = state.steps, first = steps[0], last = steps.at(-1)
  const focused = document.activeElement
  let next
  if (type === 'remove') {
    const edit = step('remove', { at, duration })
    next = selection.name === 'original' ? [edit, ...steps] : [...steps, edit]
  }
  // Cropping again updates the crop already at that end of the chain: the original's first, the edit's last.
  else if (selection.name === 'original') next = [step('crop', { at, duration }), ...(first?.type === 'crop' ? steps.slice(1) : steps)]
  else if (last?.type === 'crop') next = [...steps.slice(0, -1), step('crop', { at: +(last.args[0].at + at).toPrecision(12), duration })]
  else next = [...steps, step('crop', { at, duration })]
  await change(next)
  if (focused.closest('.action-buttons') && (document.activeElement === focused || document.activeElement === document.body)) document.querySelector('.undo').focus({ preventScroll: true })
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
    const [from, to] = range(name)
    const rate = (name === 'original' ? original : edited).sampleRate
    if (position[name] < from || Math.round(position[name] * rate) >= Math.round(to * rate)) position[name] = from
    position[name] = Math.floor(position[name] * rate) / rate
    if (name === 'edited') return await streamPlayback(edited, position[name], selection?.name === name ? to : null, request)
    let buffer = buffers[name]
    if (!buffer) {
      const pcm = originalPCM
      buffer = audioContext.createBuffer(pcm.length, pcm[0].length, original.sampleRate)
      pcm.forEach((channel, i) => buffer.copyToChannel(channel, i))
      buffers[name] = buffer
    }
    player = audioContext.createBufferSource()
    player.buffer = buffer
    player.connect(audioContext.destination)
    startTime = audioContext.currentTime - position[name]
    player.loop = state.loop
    player.loopStart = from
    player.loopEnd = to
    if (state.loop) player.position = () => from + (ctx.currentTime - startTime - from) % (to - from)
    player.onended = () => { player?.disconnect(); player = null; stop(); position[name] = to; paint() }
    if (state.loop) player.start(0, position[name])
    else player.start(0, position[name], to - position[name])
    state.pending = false
    state.playing = true
    tick()
  } catch {
    if (request !== playback) return
    stop()
    state.message = 'Audio playback is unavailable. Try downloading the WAV instead.'
  }
}

function toggleLoop() {
  state.loop = !state.loop
  if (state.playing || state.pending) {
    const name = state.preview
    stop()
    play(name)
  }
}

function tick() {
  paint()
  frame = requestAnimationFrame(tick)
}

// Consume the engine's live stream a few blocks ahead, scheduled on one audio clock.
// Backpressure keeps new parameter values audible promptly; pausing cancels every queued block.
async function streamPlayback(clip, from, to, request) {
  const nodes = new Set(), audioContext = ctx
  const laps = []
  let time = audioContext.currentTime + .02, end = from, timer, wake, closed = false, done = false
  const finish = () => {
    if (!done || nodes.size || closed || request !== playback) return
    player = null
    stop()
    position.edited = Math.min(end, length('edited'))
    paint()
  }
  player = {
    position() {
      while (laps.length > 1 && laps[1].time <= audioContext.currentTime) laps.shift()
      const lap = laps[0], elapsed = Math.max(0, audioContext.currentTime - (lap?.time ?? startTime))
      return lap ? lap.from + (lap.period ? elapsed % lap.period : elapsed) : from
    },
    stop() {
      closed = true
      clearTimeout(timer)
      wake?.()
      for (const node of nodes) { node.onended = null; node.stop() }
    },
    disconnect() { for (const node of nodes) node.disconnect(); nodes.clear() }
  }
  startTime = time - from
  do {
    const lap = { time, from }
    laps.push(lap)
    const stream = clip.stream({ at: from, ...(to == null ? {} : { duration: to - from }) })
    let frames = 0
    for await (let channels of stream) {
      while (!closed && time > audioContext.currentTime + .1) {
        await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, 15) })
      }
      if (closed || request !== playback) return
      let count = channels[0]?.length || 0
      if (!count) continue
      frames += count
      // Tiny loops share a scheduled block, avoiding thousands of audio nodes per second.
      const [loopFrom, loopTo] = range('edited')
      if (state.loop && from === loopFrom && count < 1024 && count === Math.round((loopTo - loopFrom) * clip.sampleRate)) {
        const repeats = Math.ceil(1024 / count)
        lap.period = count / clip.sampleRate
        channels = channels.map(channel => {
          const repeated = new Float32Array(count * repeats)
          for (let i = 0; i < repeats; i++) repeated.set(channel, i * count)
          return repeated
        })
        count *= repeats
      }
      const buffer = audioContext.createBuffer(channels.length, count, clip.sampleRate)
      channels.forEach((channel, i) => buffer.copyToChannel(channel, i))
      const node = audioContext.createBufferSource()
      node.buffer = buffer
      node.connect(audioContext.destination)
      nodes.add(node)
      node.onended = () => { nodes.delete(node); node.disconnect(); finish() }
      // An exhausted scheduling buffer advances the clock anchor, never the content cursor.
      const late = Math.max(0, audioContext.currentTime - time)
      startTime += late
      lap.time += late
      time += late
      node.start(time)
      time += buffer.duration
      end += buffer.duration
      if (!state.playing) { state.pending = false; state.playing = true; tick() }
    }
    if (closed || request !== playback || !state.loop || !frames) break
    ;[from, to] = range('edited')
    if (selection?.name !== 'edited') to = null
    end = from
  } while (true)
  done = true
  finish()
}

// Display 50 ms peak bins while capturing; the recorder retains the actual audio for decoding.
function drawRecording() {
  const capture = recording
  if (!capture?.analyser) return
  const elapsed = Math.min(120, (performance.now() - capture.started) / 1000)
  capture.analyser.getFloatTimeDomainData(capture.samples)
  const bin = Math.min(capture.peaks.length - 1, Math.floor(elapsed * 20))
  for (const value of capture.samples) capture.peaks[bin] = Math.max(capture.peaks[bin], Math.abs(value))
  while (elapsed > capture.span) capture.span = Math.min(120, capture.span * 2)
  draw(waves.original, capture.peaks.subarray(0, capture.span * 20))
  waves.original.style.setProperty('--progress', elapsed / capture.span * 100 + '%')
  waves.original.style.setProperty('--cursor-opacity', 1)
  waves.original.querySelector('input').setAttribute('aria-valuetext', `Recording ${duration(elapsed)}`)
  state.recordingTime = duration(elapsed)
}

// Capture locally with the browser's recorder, then load its decoded samples like an opened file.
async function record() {
  if (state.busy || recording) return
  stop()
  clearSelection()
  state.message = ''
  state.busy = state.micPending = true
  const capture = recording = { chunks: [] }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (recording !== capture) { stream.getTracks().forEach(track => track.stop()); return }
    capture.stream = stream
    const audioContext = context()
    await audioContext.resume()
    if (recording !== capture) return
    capture.source = audioContext.createMediaStreamSource(stream)
    capture.analyser = audioContext.createAnalyser()
    capture.analyser.fftSize = 2048
    // Keep the analysis graph running without routing microphone sound to the speakers.
    capture.mute = audioContext.createGain()
    capture.mute.gain.value = 0
    capture.source.connect(capture.analyser).connect(capture.mute).connect(audioContext.destination)
    capture.samples = new Float32Array(capture.analyser.fftSize)
    capture.peaks = new Float32Array(120 * 20)
    capture.span = 5
    const recorder = capture.recorder = new MediaRecorder(stream)
    recorder.ondataavailable = event => { if (event.data.size) capture.chunks.push(event.data) }
    recorder.onerror = () => {
      if (recording !== capture) return
      stopRecording(true)
      state.message = 'Recording failed. Try again.'
    }
    recorder.onstop = async () => {
      if (recording !== capture) return
      releaseRecording(false)
      try {
        const bytes = await new Blob(capture.chunks, { type: recorder.mimeType }).arrayBuffer()
        if (!bytes.byteLength) throw Error('Empty recording')
        const buffer = await context().decodeAudioData(bytes)
        if (recording !== capture) return
        if (!buffer.length) throw Error('Empty recording')
        await load(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice(0, buffer.sampleRate * 120)), buffer.sampleRate, 'recording')
      } catch { if (recording === capture) state.message = 'No audio was recorded. Try again.' }
      finally { if (recording === capture) { releaseRecording(); finishWork() } }
    }
    recorder.start()
    state.preview = 'original'
    state.micPending = false
    state.recording = true
    capture.started = performance.now()
    state.recordingTime = '0:00.0'
    drawRecording()
    capture.clock = setInterval(drawRecording, 50)
    capture.limit = setTimeout(() => { if (recording === capture) stopRecording() }, 120000)
  } catch (error) {
    if (recording !== capture) return
    stopRecording(true)
    state.message = error.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in your browser to record.' : 'Microphone unavailable. Check your input and try again.'
  }
}
function releaseRecording(clear = true) {
  const capture = recording
  if (clear) recording = null
  clearInterval(capture?.clock)
  clearTimeout(capture?.limit)
  capture?.source?.disconnect()
  capture?.analyser?.disconnect()
  capture?.mute?.disconnect()
  capture?.stream?.getTracks().forEach(track => track.stop())
  state.recording = state.micPending = false
  drawWaves()
  paint()
}
function stopRecording(discard = false) {
  if (!recording) return
  const recorder = recording.recorder
  if (discard || !recorder) {
    releaseRecording()
    if (recorder) recorder.onstop = null
    if (recorder?.state !== 'inactive') recorder?.stop()
    finishWork()
  } else if (recorder.state !== 'inactive') recorder.stop()
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

async function download(format = state.format) {
  if (state.editPending) await applyPending()
  if (state.busy || !state.ready) return
  closePill()
  if (format !== state.format) batch(() => { state.format = format; state.examples = examples(state.steps, format) })
  state.busy = state.saving = true
  state.message = ''
  try {
    const bytes = await edited.encode(format, { meta: false })
    const url = URL.createObjectURL(new Blob([bytes], { type: formats[format].mime }))
    const link = document.createElement('a')
    link.href = url
    link.download = downloadName()
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

// The demo opens on the first sample.
const first = Object.keys(samples)[0]
state = sprae(document.querySelector('#site'), {
  version: audio.version, icons,
  examples: examples(defaults(), 'wav'), steps: defaults(), editPending: false, open: null, fields: [], methods, formats, format: 'wav', undoCount: 0, selected: '', selectionLabel: '',
  tab: 'node', copied: '', copyMessage: '', reorderMessage: '', draggingStep: false,
  sample: first, filename: first, saveName: first + '-edited', selectionMeters: '', originalDuration: '…', editedDuration: '…', cursorMeters: '–',
  editCount: 3, preview: 'edited', playing: false, pending: false, timecode: '0:00.0', loop: false, recording: false, micPending: false, recordingTime: '0:00.0',
  busy: true, saving: false, ready: false, originalReady: false, message: '', editMessage: '',
  get transportBusy() { return !this.playing && !this.pending && (this.editPending || (this.busy && !this.saving)) },
  // The readout shows one thing: the selected range, else a message, else the position.
  get notice() { return this.selected || this.recording || this.micPending ? '' : this.message || this.editMessage },
  get items() { return menuItems(this.open) },
  get menuLabel() { return typeof this.open === 'number' ? this.steps[this.open]?.type + '()' : { source: 'Original', save: 'Download' }[this.open] || '' },
  get stepOpen() { return typeof this.open === 'number' },
  get pillTab() {
    const step = typeof this.open === 'number' && this.steps[this.open]
    return step ? { name: step.type, value: summary(step) } : { name: { source: this.sample || this.filename, save: this.saveName }[this.open] || '', value: '' }
  },
  play, seek, openPill, closePill, pillKey, pillMenuKey, choose, adjust, startParameter, removeStep, summary, figure, notation, addMethod, placeMenu, openMenu, menuKey, highlight, codeLines, moveTab, beginSelection, moveSelection, finishSelection, cancelSelection, selectionKey, clearSelection, editSelection,
  undo, demoKey, openFile, copy, beginReorder, moveStep, toggleLoop, record, stopRecording, autoThreshold
})
await load(samples[first].make(), RATE, first, first)
new ResizeObserver(drawWaves).observe(waves.original)
// Snap each device's origin without changing its layout height. The footer follows content height.
const alignGrid = () => {
  const dot = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dot'))
  for (const el of document.querySelectorAll('.demo, .code-example')) {
    const top = el.getBoundingClientRect().top + scrollY - (parseFloat(el.style.getPropertyValue('--grid-offset')) || 0)
    el.style.setProperty('--grid-offset', ((dot - top % dot) % dot) + 'px')
  }
  const bottom = document.querySelector('main').getBoundingClientRect().bottom + scrollY
  document.querySelector('.footer').style.marginTop = ((dot - bottom % dot) % dot) + 'px'
}
const gridObserver = new ResizeObserver(alignGrid)
for (const el of document.querySelectorAll('main, .hero, .code-section')) gridObserver.observe(el)
window.addEventListener('resize', () => { placeMenu(true); moveTab() })
document.fonts.ready.then(() => moveTab())
window.addEventListener('scroll', placeMenu, { passive: true })
// A press outside the open pill and its menu closes the menu; a press on a pill opens or closes it itself.
document.addEventListener('pointerdown', event => { if (!event.target.closest('#pill-menu, .pill')) closePill() })
// Escape closes the open pill's menu wherever the focus is, and hands the focus to its pill.
document.addEventListener('keydown', event => { if (event.key === 'Escape' && state.open != null) { event.preventDefault(); closePill(true) } })
window.addEventListener('pagehide', () => { cancelReorder(); cancelSelection(); cancelEdit(); stopRecording(true); stop(); ctx?.close(); ctx = null })
