import { append, chain, number, between, tracks as tracksOf, focus, written, addTrack } from '../code.js'
import { docOf, anew, relane, mastering, audible, openFiles } from '../editor.js'
import { writtenDepth } from './config.js'
import { state, eng, v, ed, rk, output } from './context.js'
import { write, applied, spreading } from './edits.js'
import { splice, seam } from './writers.js'

// Copy and paste: the editor's clipboard, shared by its tabs and windows, and the system's

// The clipboard every tab of the editor pastes from, in this window or another: the sound a range was copied from, written
// out (code.js written), and the range, { sound, at, d, stamp }, stored in the browser as the last copy made anywhere.
// The tab it was copied in (its `copied` stamp) pastes its own copy step (paste()); any other puts in that sound cropped
// to the range (insert()), the same audio, made there from the same files and steps.
// The system's clipboard gets the copy too (system)
const CLIP = 'audio-repl-clip'
const clipped = () => { try { const c = JSON.parse(localStorage.getItem(CLIP)); return typeof c?.sound === 'string' ? c : null } catch { return null } }
const cropped = c => `${c.sound}.crop({ at: ${c.at}, d: ${c.d} })`
export function clip(range) {
  if (spreading || !Array.isArray(range) || Array.isArray(range[0])) return
  const cut = rk.ahead(), sound = written(cut ? applied(ed.code, cut) : ed.code), doc = docOf(state.tab)
  if (!sound || !doc) return
  const s = t => number(t, v.unit), c = { sound, at: s(range[0]), d: s(range[1] - range[0]), stamp: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }
  try { localStorage.setItem(CLIP, JSON.stringify(c)); doc.copied = c.stamp } catch {}
  system(cropped(c), range)
}
// The system's clipboard: the sound copied as code, the text pasted where text goes; and where the browser writes web
// formats (Chrome), the range as a WAV, as Export writes it, for a page this one's storage does not reach (another
// browser profile, an editor's webview, another site) to paste (pasting), up to WAV_MOST bytes (a quarter of an hour of
// CD stereo; past it, the text alone). Encoded in the worker, handed to the clipboard as it comes: the key does not
// wait for it
const WAV = 'web audio/wav', WAV_MOST = 160e6
const webWav = () => typeof ClipboardItem === 'function' && !!ClipboardItem.supports?.(WAV)
function system(text, [a, b]) {
  if (typeof ClipboardItem !== 'function') return void navigator.clipboard?.writeText(text).catch(() => {})
  const s = state.sound, depth = writtenDepth('wav', state.encoding.bitDepth, s?.bits)
  const wav = output && s && webWav() && (b - a) * s.hz * s.count * depth / 8 <= WAV_MOST
    && eng.wav(output.id, a, b - a, depth).then(bytes => { if (!bytes) throw new Error('No output to copy.'); return new Blob([bytes], { type: 'audio/wav' }) })
  navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), ...wav && { [WAV]: wav } })]).catch(() => navigator.clipboard.writeText(text)).catch(() => {})
}
// the clip this tab pastes by its sound: another tab's, or its own once its copy step is gone (undone); null where its
// own copy step pastes it, or there is none
const copies = () => !!chain(ed.code)?.calls.some(k => k.name === 'copy' || k.name === 'cut')
const foreign = () => { const c = clipped(); return c && (c.stamp !== docOf(state.tab)?.copied || !copies()) ? c : null }
export const pastable = () => !!chain(ed.code) && (!!foreign() || copies())
// What is pasted at the carets `at`, the last first: the clip (another tab's sound cropped, or this tab's copy step)
export function paste(at) {
  const c = foreign()
  return !!write(at.map(t => c ? `insert(${cropped(c)}, { at: ${number(t, v.unit)}${splice()} })` : `paste(${number(t, v.unit)}${seam()})`).join('.'))
}
// A sound put under the lanes, pasted at the room's caret or a file dropped there: a new track, under the last, the
// sound written into it there (write(), as audio carried there is), named for its file (`file`), the one edited then.
// One step
export const pasteNew = t => { const c = clipped(); return !!c && intoNew(cropped(c), t) }
export function intoNew(sound, t, file = 'track') {
  const under = tracksOf(ed.code).at(-1)?.name, made = !mastering() && chain(ed.code) && addTrack(ed.code, 'audio.from(0)', file, { last: true })
  if (!made) return false
  const was = state.track
  let put
  try { focus(made.name); put = append(made.code, `write(${sound}, { at: ${number(t, v.unit)} })`) } finally { focus(was) }
  if (!put) return false
  v.ghost = false
  ed.change(between(ed.code, applied(made.code, put)))
  anew(made.name, under)
  state.track = made.name
  focus(made.name)
  relane()
  return true
}
// ⌘V, the system's clipboard with it (`data`): audio files copied elsewhere (a Finder's) go in at the carets, as dropped
// there; else the clip, where its text is what is there; else a WAV another page copied (system), read as the browser
// lets it, the first time asking the person; the clip where there is none
export async function pasting(at, data) {
  const files = [...data.files].filter(audible)
  if (files.length) return openFiles(files, 'insert', at)
  const c = clipped(), ours = text => !!c && text === cropped(c)
  if (ours(data.getData('text/plain')) || !webWav()) return paste(at)
  const item = await navigator.clipboard.read().then(items => items.find(i => i.types.includes(WAV)), () => null)
  const wav = item && !ours(await item.getType('text/plain').then(b => b.text(), () => '')) && await item.getType(WAV).catch(() => null)
  return wav ? openFiles([new File([wav], 'pasted.wav', { type: 'audio/wav' })], 'insert', at) : paste(at)
}

export function wire() {
  addEventListener('storage', e => { if (e.key === CLIP && ed) state.canPaste = pastable() })
}
