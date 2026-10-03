// What an agent's tool call does, said as the page's user would say it, for the chat: { now } while it runs, { then }
// once it has, { show } where on the sound it acted (a range, a time, an edit), to go to. The page's own tools
// (bin/mcp.js --editor) by what they were given, measuring loudness, applying normalize('podcast'), checking against Apple
// Podcasts; the agent's own (Claude Code's, Codex's) by what they touch. Only what the call says: a stat it names, a
// range, a command; never a guess at more. noted() says what it came to, from what the page answered.
const STATS = {
  db: 'peak', peak: 'peak', rms: 'RMS', ms: 'power', crest: 'crest factor', loudness: 'loudness', momentary: 'momentary loudness',
  shortterm: 'short-term loudness', dialog: 'dialogue loudness', truepeak: 'true peak', lra: 'loudness range', dr: 'dynamic range',
  replaygain: 'ReplayGain', noisefloor: 'noise floor', dc: 'DC offset', clipping: 'clipping', correlation: 'stereo correlation',
  spectrum: 'spectrum', ltas: 'long-term spectrum', cepstrum: 'cepstrum', centroid: 'brightness', rolloff: 'roll-off', slope: 'spectral slope',
  flatness: 'flatness', silence: 'pauses', onsets: 'onsets', beats: 'beats', bpm: 'tempo', detect: 'tempo', key: 'key', chords: 'chords',
  notes: 'notes', melody: 'melody'
}
// each verb as it runs and once it has
const VERBS = {
  read: ['Reading', 'Read'], measure: ['Measuring', 'Measured'], look: ['Looking at', 'Looked at'], apply: ['Applying', 'Applied'],
  mark: ['Marking', 'Marked'], rewrite: ['Rewriting', 'Rewrote'], check: ['Checking against', 'Checked against'], play: ['Playing', 'Played'],
  stop: ['Stopping', 'Stopped'], select: ['Selecting', 'Selected'], caret: ['Putting the caret at', 'Put the caret at'],
  clear: ['Clearing', 'Cleared'], undo: ['Undoing', 'Undid'], redo: ['Redoing', 'Redid'], run: ['Running', 'Ran'], write: ['Writing', 'Wrote'],
  change: ['Changing', 'Changed'], search: ['Searching for', 'Searched for'], web: ['Searching the web for', 'Searched the web for'],
  plan: ['Planning', 'Planned'], delegate: ['Delegating', 'Delegated'], scrub: ['Scrubbing', 'Scrubbed'], open: ['Opening', 'Opened'],
  remove: ['Removing', 'Removed'], move: ['Moving', 'Moved'], off: ['Turning off', 'Turned off'], on: ['Turning on', 'Turned on']
}
// the units a stat reads in, as the page writes them; peak and rms are sample values, db their dBFS
const UNITS = {
  db: 'dBFS', noisefloor: 'dBFS', loudness: 'LUFS', momentary: 'LUFS', shortterm: 'LUFS', dialog: 'LUFS',
  truepeak: 'dBTP', lra: 'LU', dr: 'dB', crest: 'dB', replaygain: 'dB', bpm: 'BPM', centroid: 'Hz', rolloff: 'Hz'
}
const list = new Intl.ListFormat('en', { type: 'conjunction' })
const line = s => String(s ?? '').trim().split('\n')[0]
const base = path => line(path).split(/[\\/]/).pop()

// the stats a measuring script names, in order
function named(code = '') {
  const names = [...code.matchAll(/\.stat\(\s*(\[[^\]]*\]|(['"`])\w+\2)/g)].flatMap(m => [...m[1].matchAll(/['"`](\w+)['"`]/g)].map(n => n[1]))
  for (const m of code.matchAll(/\.(silence|detect|spectrum|cepstrum)\(/g)) names.push(m[1])
  return names
}
// what a measuring script reads: the stats it names, of the output or of the file as it opened, over time or once
function measuring(code = '') {
  const words = [...new Set(named(code).map(n => STATS[n] ?? n))]
  return words.length ? `${list.format(words)}${/\bsrc\b/.test(code) && !/\bout\b/.test(code) ? ' of the original' : ''}${/\bbins\s*:/.test(code) ? ' over time' : ''}` : ''
}

const hz = f => f >= 1000 ? `${+(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`

// [verb, what, show], the verb a key of VERBS, or [text] said as it is both ways
function said(tool, o, { time, spec }) {
  const d = o.d ?? o.duration, span = o.at == null ? '' : d == null ? `from ${time(+o.at)}` : `${time(+o.at)}–${time(+o.at + +d)}`
  const range = o.at != null && d != null ? { range: [+o.at, +o.at + +d] } : o.at != null ? { caret: +o.at } : null
  const band = o.low != null && o.high != null ? `, ${hz(+o.low)}–${hz(+o.high)}` : ''
  // mark(time, label) or mark({ at, d }, label): [, time, at, d, quote, label]
  const mark = typeof o.call === 'string' && o.call.match(/^\.?mark\(\s*(?:([\d.]+)|\{\s*at:\s*([\d.]+),\s*d(?:uration)?:\s*([\d.]+)\s*\})\s*(?:,\s*(['"`])(.*)\4)?/)
  switch (tool) {
    case 'state': return ['read', 'the sound']
    case 'measure': return ['measure', measuring(o.code)]
    case 'look': return ['look', span || 'the picture', range]
    case 'edit': return mark ? ['mark', `${mark[5] ? `“${mark[5]}” ` : ''}${mark[1] ? `at ${time(+mark[1])}` : `${time(+mark[2])}–${time(+mark[2] + +mark[3])}`}`, mark[1] ? { caret: +mark[1] } : { range: [+mark[2], +mark[2] + +mark[3]] }] : ['apply', line(o.call).replace(/^\./, ''), { edit: line(o.call).replace(/^\./, '') }]
    case 'script': return ['rewrite', 'the script']
    case 'check': return ['check', spec(o.spec)]
    case 'play': return ['play', `${o.original ? 'the original' : 'the output'}${span && ` ${span}`}`, range]
    case 'stop': return ['stop', 'playback']
    case 'select': return o.cursor != null ? ['caret', time(+o.cursor), { caret: +o.cursor }] : span ? ['select', span + band, range && { ...range, band: band ? [+o.low, +o.high] : null }] : ['clear', 'the selection']
    case 'scrub': return ['scrub', o.to != null ? `${time(+o.at)}–${time(+o.to)}` : time(+o.at), { caret: +(o.to ?? o.at) }]
    case 'step': return [o.remove ? 'remove' : o.to != null ? 'move' : o.on === false ? 'off' : 'on', `edit ${+o.index + 1}${o.to != null && !o.remove ? ` to ${+o.to + 1}` : ''}`]
    case 'open': return ['open', base(o.path)]
    case 'undo': return ['undo', '']
    case 'redo': return ['redo', '']
    case 'audio': return ['run', `audio ${line(o.args)}`]
    case 'Bash': case 'command_execution': return o.description ? [line(o.description)] : ['run', line(o.command)]
    case 'Read': return ['read', base(o.file_path)]
    case 'Write': case 'Edit': case 'MultiEdit': return ['write', base(o.file_path)]
    case 'file_change': return ['change', 'files']
    case 'Grep': case 'Glob': return ['search', line(o.pattern)]
    case 'WebSearch': case 'web_search': return ['web', line(o.query)]
    case 'WebFetch': try { return ['read', new URL(o.url).host] } catch { return ['read', 'a page'] }
    case 'TodoWrite': case 'todo_list': return ['plan', '']
    case 'Task': case 'Agent': return ['delegate', line(o.description)]
    default: return [tool]
  }
}

export default function doing(tool, input, { time = t => `${t} s`, spec = s => s } = {}) {
  const [verb, what = '', show = null] = said(tool, input && typeof input === 'object' ? input : {}, { time, spec })
  const [now, then] = VERBS[verb]?.map(v => what ? `${v} ${what}` : v) ?? [verb, verb]
  return { now, then, show }
}

// A number as the page writes a level: two places at most, a true minus, silence as −∞
const num = v => v === '-Infinity' || v === -Infinity ? '−∞' : v === 'Infinity' ? '∞' : typeof v === 'number' ? String(+v.toFixed(2)).replace(/^-/, '−') : null
const json = v => { const s = JSON.stringify(v); return s == null ? '' : s.length > 60 ? s.slice(0, 59) + '…' : s }
// a series' span, its silence (−∞) and its empty bins (NaN) left out
const span = (v, unit = '') => {
  const finite = v.filter(Number.isFinite)
  return `${v.length} values${finite.length ? `, ${num(Math.min(...finite))} to ${num(Math.max(...finite))}${unit}` : ''}`
}
// stats whose value is a list of times, of events; of bands or coefficients, a vector
const TIMES = new Set(['onsets', 'beats', 'hits', 'clipping'])
const VECTORS = { spectrum: 'bands', ltas: 'bands', cepstrum: 'coefficients' }
// A stat's value as the page writes it: a level in its units, a frequency in Hz or kHz, a series its span, events how
// many, a key its name, pauses how many and the longest
function reading(name, v) {
  const list = ArrayBuffer.isView(v) ? Array.from(v) : v, unit = UNITS[name] ? ` ${UNITS[name]}` : ''
  if (num(list) != null) return name === 'centroid' || name === 'rolloff' ? hz(list) : num(list) + unit
  if (VECTORS[name] && Array.isArray(list)) return `${list.length} ${VECTORS[name]}`
  if (TIMES.has(name) && Array.isArray(list)) return list.length ? String(list.length) : 'none'
  if (name === 'silence' && Array.isArray(list)) return list.length ? `${list.length}, the longest ${num(Math.max(...list.map(p => +p.duration || 0)))} s` : 'none'
  if (name === 'notes' && Array.isArray(list)) {
    const by = list.filter(n => n.midi != null).sort((a, b) => a.midi - b.midi)
    return by.length ? `${by.length}, ${by[0].note} to ${by.at(-1).note}` : 'none'
  }
  if (name === 'chords' && Array.isArray(list)) return String(list.filter(c => c.label !== 'N').length || 'none')
  if (name === 'melody' && list?.f0) {
    const f = Array.from(list.f0).filter((x, i) => x > 0 && (list.voiced?.[i] ?? true))
    return f.length ? `${hz(Math.min(...f))} to ${hz(Math.max(...f))}` : 'unvoiced'
  }
  if (name === 'key' && list?.label) return list.label
  if (name === 'replaygain' && list?.gain != null) return `${num(list.gain)} dB`
  if (name === 'detect' && list?.bpm != null) return `${num(list.bpm)} BPM`
  if (Array.isArray(list) && list.every(x => num(x) != null || x === 'NaN')) return list.length > 3 ? span(list.map(x => typeof x === 'number' ? x : x === '-Infinity' ? -Infinity : NaN), unit) : list.map(x => num(x) ?? '–').map(x => x + unit).join(', ')
  return json(v)
}
const channels = c => Array.isArray(c) ? `channels ${c.map(i => +i + 1).join(', ')}` : `channel ${+c + 1}`
// What a measure call measured, stat by stat as the page noted them (worker.js evaluate): each its name, where it was
// taken (over time, a range, a channel, the original), its value
export function measures(told, { time = t => `${t} s` } = {}) {
  return (Array.isArray(told) ? told : []).map(({ of, name, opts = {}, value }) => {
    const d = opts.d ?? opts.duration, word = STATS[name] ?? String(name)
    const where = [
      opts.at != null && (d != null ? `${time(+opts.at)}–${time(+opts.at + +d)}` : `from ${time(+opts.at)}`),
      opts.channel != null && channels(opts.channel), of === 'src' && 'original'
    ].filter(Boolean)
    const over = opts.bins != null && !VECTORS[name] && Array.isArray(value) ? ' over time' : ''
    return { name: word[0].toUpperCase() + word.slice(1) + over + (where.length ? `, ${where.join(', ')}` : ''), after: reading(name, value) }
  })
}
// What a call came to, in a few words, from the page's answer: a measurement its value in its units (several, said by
// measures(), rather), an edit the output's loudness and peak after it, a check whether it passes and on what it fails;
// '' where there is nothing to say. `told`, what the page noted besides its answer: a measure's stats
export function noted(tool, input, result, told) {
  const o = input && typeof input === 'object' ? input : {}, r = result
  if (tool === 'measure') {
    if (told?.length) return told.length === 1 ? measures(told)[0].after : ''
    const names = named(o.code), unit = i => UNITS[names[i]] ? ` ${UNITS[names[i]]}` : ''
    const one = (v, i = 0) => num(v) != null ? num(v) + unit(i) : null
    if (one(r) != null) return one(r)
    if (Array.isArray(r) && r.length && r.length === names.length && r.every(v => num(v) != null)) return r.map(one).join(', ')
    if (Array.isArray(r) && r.length > 3 && r.every(v => num(v) != null)) return span(r.map(v => typeof v === 'number' ? v : v === '-Infinity' ? -Infinity : Infinity), unit(0))
    return json(r)
  }
  if (r && typeof r === 'object' && 'ok' in r) return r.ok === false ? r.problem ?? 'failed' : r.loudness != null ? `now ${num(r.loudness)} LUFS, peak ${num(r.peak)} dBFS` : ''
  if (tool === 'check' && r) return r.pass ? 'passes' : `fails ${list.format(r.rules.filter(x => x.pass === false).map(x => x.name.toLowerCase()))}`
  if (tool === 'state' && r) return `${num(r.duration)} s, ${r.channels} ch, ${+(r.sampleRate / 1000).toFixed(3)} kHz`
  return ''
}
