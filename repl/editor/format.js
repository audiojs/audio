import time from '../time.js'
import { state, output } from './context.js'

// Numbers, times, sizes, keys and names as the page writes them, and a word over the picture (note)

// A number and its unit as the page writes them: the unit right after the value, no space (−1.0dB, 44.1kHz)
export const dbfs = db => Number.isFinite(db) ? `${db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)}` : '−∞'
// a file's size, and a time as a list of past things says it (File › Open recent, the conversations)
export const bytes = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`
export const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }
// Keys as this platform names them
export const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
export const keys = s => mac ? s : s.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+').replace(/⌥/g, 'Alt+')
// A time, or a length of time, in the units chosen, as the view writes them (time.js): 0:05.000, 5.000s, 240000
export const clock = (t, digits = 3) => time(t, state.units, { digits, rate: output?.sampleRate })
export const stamp = t => clock(t)
// A check's numbers as the page prints them: to 0.01 as judged, whole numbers whole, a true minus sign
const minus = s => s.replace(/^-/, '−')
const value = v => Number.isFinite(v) ? minus(Number.isInteger(v) ? String(v) : v.toFixed(2)) : v < 0 ? '−∞' : '∞'
const limit = ({ min, max }) => min != null && max != null ? (min === max ? `= ${value(min)}` : `${value(min)} to ${value(max)}`) : max != null ? `≤ ${value(max)}` : min != null ? `≥ ${value(min)}` : ''
const mark = pass => pass == null ? '·' : pass ? '✓' : '✗'
const verdict = pass => pass == null ? 'info' : pass ? 'pass' : 'fail'
// a check's rule as its table's row: its name, the output's value and mark, its limit (the Export tab's, the chat's)
export const ruled = r => ({ name: r.name, unit: r.unit, limit: limit(r), note: r.note || '', after: value(r.value), afterMark: mark(r.pass), afterClass: verdict(r.pass) })
// a sound by its address, a URL or a path from the site's root (worker.js address), named by its file
export const label = name => /^(https?|blob|data):|^\/(?!\/)/.test(name) ? decodeURIComponent(name.split(/[?#]/)[0].split('/').pop() || name) : name
export const quote = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
// steps by name, two at most, the rest counted: "highpass, compressor and 8 more"
export const several = list => list.length > 2 ? `${list.slice(0, 2).join(', ')} and ${list.length - 2} more` : list.join(' and ')
export const hertz = f => f >= 1000 ? `${+(f / 1000).toFixed(2)}kHz` : `${Math.round(f)}Hz`
export const chordName = label => label.replace(/#/g, '♯')
export const brief = t => t.length > 28 ? t.slice(0, 27) + '…' : t || '()'
// A word over the picture for a few seconds: a hint, or what went wrong (`error`), longer
export function note(text, kind = '') {
  state.notice = text
  state.noticeKind = kind
  clearTimeout(note.timer)
  note.timer = setTimeout(() => state.notice = '', kind === 'error' ? 8000 : 4000)
}
