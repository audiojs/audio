import { prepare, source, chain, number, setArg, declared, rename, tracks as tracksOf, focus, addTrack } from '../code.js'
import { builtins, sample, search, credit, unique } from '../sources.js'
import { unkeep, kept, tapes } from '../keep.js'
import { closeMenus } from '../editor.js'
import { intoNew } from './clipboard.js'
import { root, APART, keep, ENCODING, mime } from './config.js'
import { state, eng, v, ed } from './context.js'
import { write, applied } from './edits.js'
import { bytes, ago, label, quote, note } from './format.js'
import { writing, owning, store } from './persist.js'
import { schedule } from './run.js'
import { docs, closed, newTab, reopenTab } from './tabs.js'
import { retrack } from './tracks.js'
import { splice } from './writers.js'

// Sounds in and out: files opened, dropped and kept, samples and generators, recipes, the sound search, export, a
// link to the script

// the files' lengths, s
export const lengths = new Map(), lengthOf = name => lengths.get(name)
// the files kept in this browser, name → File (hold)
export let shelf = new Map()
export let restoring
// Sources. A new sound opens in a tab of its own, or in the tab shown if it is empty; several at once, a track each in
// one tab, played together, unless dropped on the tabs: a tab each. A file dropped on the waveform goes in where it is
// dropped; one dropped on the script is written where it lands. A file the script opens that is not here
// (`missing`) takes the one opened for it (Open it…), or one by its name, and the script runs again.
// `track`: those picked open as tracks of their own, under the one edited
let relink = '', asTrack = false
export const audible = f => /^(audio|video)\//.test(f.type) || /\.(wav|mp3|flac|ogg|oga|opus|m4a|aac|aiff?|caf|webm|mp4|mov|wma|amr|mka)$/i.test(f.name)
export function pickFiles(missing = '', track = false) { closeMenus(); relink = typeof missing === 'string' ? missing : ''; asTrack = track === true; root.querySelector('.file-input').click() }
export async function openFiles(list, how = 'new', at = null) {
  root.querySelector('.file-input').value = ''
  if (asTrack) { asTrack = false; how = 'track' }
  const files = list.filter(audible)
  const into = relink || files.find(f => f.name === state.missing) && state.missing
  relink = ''
  if (!files.length) return note(list.length ? 'Those are not audio files.' : '')
  if (into) { await hold(into, files.find(f => f.name === into) ?? files[0]); state.problem = state.missing = ''; return schedule(0) }
  await restoring
  const names = []
  for (const file of files) {
    const name = unique(file.name, taken())
    await hold(name, file)
    names.push(name)
  }
  place(names, how, at)
}
// A file the scripts open by name, kept for the next visit (keep.js); one the browser can't keep is said to be so, and
// what that means: a file opened, to be opened again; a recording, the only copy there is, to be exported
function hold(name, data, lost = 'open it again on the next visit') {
  saving(keep(name, data).then(file => { if (file) shelf.set(name, file); else note(`${name} could not be kept in this browser: ${lost}.`, 'error'); return file }))
  return eng.file(name, data)
}
export function saving(write) { writing.add(write); write.finally(() => writing.delete(write)); return write }
// The files kept (keep.js), name → File: each goes to the engine when a script first opens it (evaluate). None is let
// go but when asked (File › Open recent › Delete kept sounds): a tab closed, a step undone, keeps its files for coming back to.
// the names a new file can't take: a file open, kept, or a sample's
export const taken = () => new Set([...eng.names, ...shelf.keys(), ...Object.keys(builtins)])
// The kept files no open tab opens, the newest first, as the File menu lists them
export function shelved() {
  const open = new Set(docs.flatMap(d => prepare(d.id === state.tab ? ed.code : d.code).names))
  return [...shelf].filter(([name]) => !open.has(name)).sort(([, a], [, b]) => b.lastModified - a.lastModified)
}
// What File › Open recent offers, the newest first: the tabs closed, each with its edits, as it was left; the files kept
// that no tab opens (a tab closed that opens one stands for it)
export function reopenable() {
  const tabs = closed.map((c, i) => {
    const names = prepare(c.code).names, edits = chain(c.code)?.calls.length ?? 0
    return { key: `tab ${i}`, kind: 'tab', names, name: names.length ? names.map(label).join(' + ') : c.code.trim().split('\n')[0].slice(0, 40) || 'untitled', when: c.shut ?? 0,
      meta: [edits ? `${edits} edit${edits > 1 ? 's' : ''}` : '', c.shut ? `closed ${ago(c.shut).replace(/^now$/, 'just now')}` : 'closed'].filter(Boolean).join(', '), run: () => reopenTab(i) }
  })
  const opened = new Set(tabs.flatMap(t => t.names))
  const files = shelved().filter(([name]) => !opened.has(name)).map(([name, f]) => ({ key: `file ${name}`, kind: 'file', name, when: f.lastModified, meta: `${bytes(f.size)}, ${ago(f.lastModified)}`, run: () => place([name], 'new') }))
  return [...tabs.reverse(), ...files].sort((a, b) => b.when - a.when)
}
// They go, once the person has said so
export async function unshelve() {
  const list = shelved(), them = list.length > 1 ? 'them' : 'it'
  if (!list.length || !confirm(`Delete ${list.length > 1 ? `the ${list.length} sounds` : list[0][0]} kept in this browser (${bytes(list.reduce((n, [, f]) => n + f.size, 0))})? No tab opens ${them} now; deleted, ${them} can't be brought back.`)) return
  for (const [name] of list) { await unkeep(name); shelf.delete(name) }
}
// Takes the page closed on as they recorded (keep.js tapes), kept as files, each under the name it was to have; one no
// tab opens, in a tab of its own
export async function recover() {
  await owning
  await restoring
  let found = 0
  for (const t of await tapes()) {
    const name = t.name && !taken().has(t.name) ? t.name : unique(t.name ?? 'recording.wav', taken())
    const file = await saving(keep(name, t.wav))
    if (!file) { note('A recording the page closed on could not be kept in this browser: it waits there for the next visit.', 'error'); continue }
    shelf.set(name, file)
    t.drop()
    found++
    if (!docs.some(d => prepare(d.id === state.tab ? ed.code : d.code).names.includes(name))) place([name], 'new')
    note(`${name}, recorded as the page closed, is kept.`)
  }
  if (found) schedule(0)
}
export function place(names, how, at = null) {
  // what went wrong with the last sound no longer holds
  state.problem = ''
  const code = ed.code, list = names.map(quote)
  const expr = list.length > 1 ? `[${list.join(', ')}]` : list[0]
  if (how === 'at' && at != null) return ed.change({ from: at, insert: `audio(${expr})` })
  // in at a time on the picture (at each of several, the last first), the seams crossfaded as an edit's are
  // under the lanes, a track of its own there
  if (how === 'room' && at != null) return intoNew(`audio(${expr})`, at, names[0])
  if (how === 'insert' && at != null && chain(code)) return write([at].flat().map(t => `insert(audio(${expr}), { at: ${number(t, v.unit)}${splice()} })`).join('.'))
  // each a track of its own, under the one edited, the last of them edited after
  if (how === 'track' && chain(code)) {
    const made = tracked(code, names)
    return made ? retrack(made) : note('This sound is made from another by its name: add a track to it in the code.')
  }
  if (how === 'tabs') { for (const name of names) opening(`audio(${quote(name)})`); return }
  if (names.length < 2) return opening(`audio(${expr})`)
  // a track each, the first edited
  const made = tracked(`audio(${list[0]})`, names.slice(1))
  if (ed.code.trim()) newTab()
  state.track = tracksOf(made.code)[0].name
  ed.change({ from: 0, to: ed.code.length, insert: made.code })
}
// `names` each a track of its own under the one `code` edits, in turn: { code, name } of the last, or null where that
// sound is none of its own
function tracked(code, names) {
  let made = { code }
  for (const name of names) {
    made = addTrack(made.code, `audio(${quote(name)})`, name)
    if (!made) return null
    focus(made.name)
  }
  return made
}
// A new sound, in a tab of its own unless the one shown is empty; `before` on a line above the statement that opens it
function opening(insert, before = '') {
  if (ed.code.trim()) newTab()
  ed.change({ from: 0, to: ed.code.length, insert: (before ? before + '\n' : '') + insert })
}
export async function useSample(name, how = 'new') {
  closeMenus()
  if (!eng.has(name)) await eng.file(name, sample(name))
  place([name], how)
}
// Embedded (?controls= sound), the sound's ways in from its name over the picture, each in its place: a file, a take
// (as Record makes one), a sample
export const NOTE = 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0m12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0', SOUND = 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2'
export function useCode(code) {
  closeMenus()
  state.problem = ''
  opening(code)
}
// A recipe onto the sound as it is, nothing of it rewritten (its edits, the takes recorded into it). A chain of calls
// goes after the chain's own, one step, under the recipe's name, one card of the edits; each call over the selection
// when there is one (every op takes a trailing range), over each range from the last back when there are several. A
// script of statements (a measure, then a level set from it) takes the script's sound as it stands for its source, all
// of it; one that makes a sound opens a tab of its own. With nothing open, the chime.
export function useRecipe(recipe) {
  closeMenus()
  if (!recipe.code.includes('$src')) return opening(recipe.code)
  // a recipe made for a spec checks against it
  if (recipe.spec && recipe.spec !== state.spec) { state.spec = recipe.spec; store() }
  const now = chain(ed.code)
  if (!now) return ed.change({ from: 0, to: ed.code.length, insert: recipe.code.replaceAll('$src', `audio('chime.wav')`) })
  const calls = callsOf(recipe.code)
  if (calls) {
    const sel = v.selection && (v.selection[0] > v.unit / 2 || v.selection[1] < v.duration - v.unit / 2) ? v.selection : null
    const spans = v.ranges.length > 1 ? [...v.ranges].sort((p, q) => q[0] - p[0]) : sel ? [sel] : [null]
    // several calls are one step of the edits, under the recipe's name (code.js groups)
    return write(...spans.flatMap(span => { const list = calls.map(k => span ? over(k, span) : k); return list.length > 1 ? [{ name: recipe.name, calls: list }] : list }))
  }
  // the script's statements before its last stay; its last's sound is the recipe's source, the recipe's names that are
  // taken there given a number (a2, lufs2)
  if (state.track) return note('This recipe takes the sound whole: use it on a track in a tab of its own.')
  const before = ed.code.slice(0, now.statement.from), sound = ed.code.slice(now.expr.from, now.expr.to), taken = declared(before), names = {}
  for (const name of declared(recipe.code)) if (taken.has(name)) { let n = 2; while (taken.has(name + n)) n++; names[name] = name + n }
  ed.change({ from: now.statement.from, to: ed.code.length, insert: rename(recipe.code, names).replaceAll('$src', sound) })
}
// A recipe's calls, each as it is written, when it is one chain on its source; else null
function callsOf(code) {
  const text = code.replace('$src', 'x'), c = chain(text)
  if (!c || c.statement.from !== 0 || text.slice(c.root.from, c.root.to) !== 'x') return null
  return c.calls.map(k => text.slice(k.dot + 1, k.to))
}
// A call over a range: its options' at and d set (setArg)
function over(call, [a, b]) {
  let text = `x.${call}`
  for (const [key, value] of [['at', +number(a, v.unit)], ['duration', +number(b - a, v.unit)]]) text = applied(text, setArg(chain(text).calls[0], key, value))
  return text.slice(2)
}
// Sound search
export function openSearch() { closeMenus(); const d = root.querySelector('dialog.search'); d.showModal(); d.querySelector('input[type=search]').focus() }
export function closeSearch() { previewAudio?.pause(); state.previewing = -1; root.querySelector('dialog.search').close() }
// Searching as the words are typed, half a second after the last key; Enter searches at once. A newer search
// supersedes an older one still under way.
let searches = 0, searched = '', searchAbort = null
// the result heard (preview)
let previewAudio = null
export function typeSearch(event) {
  state.query = event.target.value
  clearTimeout(typeSearch.timer)
  typeSearch.timer = setTimeout(runSearch, 500)
}
export async function runSearch() {
  clearTimeout(typeSearch.timer)
  const q = state.query.trim()
  if (q === searched) return
  searched = q
  searchAbort?.abort()
  const seq = ++searches
  if (!q) { state.results = []; state.searchState = ''; state.searching = false; return }
  const abort = searchAbort = new AbortController()
  state.searching = true
  state.searchState = 'Searching…'
  try {
    const { results, total } = await search(q, { signal: abort.signal })
    if (seq !== searches) return
    state.results = results
    state.searchState = results.length ? `${total.toLocaleString()} sounds` : 'Nothing found. Try other words.'
  } catch (e) { if (seq === searches && e.name !== 'AbortError') { state.searchState = e.message; searched = '' } }
  finally { if (seq === searches) state.searching = false }
}
export function preview(i) {
  previewAudio?.pause()
  if (state.previewing === i) { state.previewing = -1; return }
  previewAudio = new Audio(state.results[i].url)
  previewAudio.onended = () => state.previewing = -1
  previewAudio.play().catch(() => { state.previewing = -1; state.searchState = 'This sound cannot play here.' })
  state.previewing = i
}
// A found sound, its credit on the line above the statement that opens it
export function useResult(r) {
  closeSearch()
  state.problem = ''
  opening(`audio(${quote(r.url)})`, credit(r))
}
// Export: each save() the script makes, or the output as one file.
export async function exportFiles(parts = false, track = null) {
  if (!state.hasOutput || state.exporting) return
  state.exporting = true
  try {
    const base = state.exportName.trim().replace(/\.\w+$/, '') || state.exportBase, options = encodingOf(state.format)
    // a track alone, by its index among the tracks; every track, a file each (`track` true)
    const names = tracksOf(ed.code).map(t => t.name), each = track === true ? names.map((_, i) => ({ track: i })) : names.includes(track) ? [{ track: names.indexOf(track) }] : [{}]
    for (const one of each) {
      const { files = [], error: failed } = await eng.export({ format: state.format, name: base, parts: parts === true, options, ...one })
      if (failed) throw new Error(failed.message)
      for (const file of files) download(file)
    }
  } catch (e) { note(`Export failed: ${e.message}`) }
  finally { state.exporting = false }
}
// What a format is encoded with: its setting, the markers in the file or none (WAV's cue chunk, MP3's and M4A's chapters)
export function encodingOf(format) {
  const e = ENCODING[format], value = e && state.encoding[e[0]]
  return { ...e?.[2].includes(value) && { [e[0]]: value }, ...!state.encoding.markers && { markers: [], regions: [] } }
}
// The cuts as an edit list, a text file, for the video it came from (a cut podcast's picture cut alike)
export async function exportCuts() {
  if (!state.hasOutput || state.exporting) return
  state.exporting = true
  store()
  try {
    // the rate chosen, else the video's own; the file the cuts are of named, as it was opened (a file dropped has no path)
    const file = source(ed.code)?.strings[0]?.name
    const { files = [], error: failed } = await eng.export({ format: state.cutFormat, name: state.exportName.trim().replace(/\.\w+$/, '') || state.exportBase, options: { ...state.fps && { fps: state.fps }, ...file && { url: file } } })
    if (failed) throw new Error(failed.message)
    for (const file of files) download(file)
  } catch (e) { note(`Export failed: ${e.message}`) }
  finally { state.exporting = false }
}
function download(file) {
  const url = URL.createObjectURL(new Blob([file.bytes], { type: mime[file.type] || 'application/octet-stream' }))
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
// Share: the script travels in the link, compressed. Opened files stay on this device; samples and URLs travel.
export async function link(script) {
  const bytes = await new Response(new Blob([script]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export async function share() {
  const code = await link(ed.code)
  history.replaceState(null, '', '#code=' + code)
  try { await navigator.clipboard.writeText(location.href); state.shared = true; setTimeout(() => state.shared = false, 1800) }
  catch { note('Copy the link from the address bar.') }
  // Samples and web addresses travel in the link; files opened here do not.
  const local = prepare(ed.code).names.filter(name => (eng.has(name) || shelf.has(name)) && !builtins[name])
  if (local.length) note(`Link copied. ${local.join(', ')} ${local.length > 1 ? 'stay' : 'stays'} on this device: whoever opens the link opens ${local.length > 1 ? 'them' : 'it'} too.`)
}
// Files dropped anywhere. Capturing, so the editor never reads audio as text.
// Held over the picture with a sound in it, a file goes in where the caret it shows is; over the tabs, into a tab of its
// own, each; over the script, where the text caret is; elsewhere, it opens, several a track each. What it would do shows as it is held (`dropping`).
const dropping = event => event.target.closest?.('.files') ? 'tab' : event.target.closest?.('.plot') && state.hasOutput ? 'insert' : 'open'

export function wire() {
  // the kept files are listed as the page comes up, not before it: the first run waits for them (evaluate)
  restoring = APART ? Promise.resolve() : kept().then(files => { shelf = files })
  root.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    state.dropping = dropping(event)
    v.dropAt(state.dropping === 'insert' ? event : null)
  }, true)
  root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget)) { state.dropping = false; v.dropAt(null) } })
  root.addEventListener('drop', event => {
    if (!event.dataTransfer?.files.length) return
    event.preventDefault()
    event.stopPropagation()
    const t = dropping(event) === 'insert' ? v.dropAt(event) : null, how = t != null && v.dropsNew ? 'room' : dropping(event)
    state.dropping = false
    v.dropAt(null)
    const inEditor = event.target.closest('.script-editor'), at = inEditor ? ed.view?.posAtCoords({ x: event.clientX, y: event.clientY }) ?? null : null
    openFiles([...event.dataTransfer.files], inEditor && at != null ? 'at' : (how === 'insert' || how === 'room') && t != null ? how : how === 'tab' ? 'tabs' : 'new', inEditor ? at : t)
  }, true)
}
