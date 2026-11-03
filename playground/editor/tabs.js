import { SLOP } from '../view.js'
import { source, chain, tracks as tracksOf, focus } from '../code.js'
import { root, EMBED, displays, stored, docsOf } from './config.js'
import { state, eng, v, ed, rk, pl, timer, steps, depthWas, assign } from './context.js'
import { label } from './format.js'
import { saved, store } from './persist.js'
import { playerOf, ticker, chase } from './play.js'
import { places } from './recording.js'
import { asking, retell, alike, begin, standIn, settle, status } from './run.js'
import { fieldFocus, attach } from './tracks.js'

// Tabs: the documents open, a tab each, as the page was left; one shown, named, made, dragged, closed and opened
// again, its run taken up where it had come to

// the open documents, a tab each: [{ id, code, steps, depthWas }], the code of the one shown in the editor (switchTab);
// each with its last output, and the one on its way (`coming`), made on with the tab left, `ready` till it is seen
export let docs = [], docIds = 0
export const docOf = id => docs.find(d => d.id === id)
// the tabs closed, the last last, each as it is kept and where it was ({ ...saved, at }); one closed since the page
// opened is still the tab itself (doc), its history with it
const CLOSED = 20
export let closed = docsOf(stored.closed).slice(-CLOSED)
// The documents as the page was left, each a tab, and the one shown; a link's script is shown, in a tab of its own
// unless one holds it already. A first visit opens on an empty tab, an empty track ready for a take or a drop,
// not a sound nobody chose
export async function initialDocs() {
  const list = EMBED ? [] : docsOf(stored.docs).length ? docsOf(stored.docs) : typeof stored.code === 'string' ? [{ code: stored.code }] : []
  let at = Math.max(0, Math.min(stored.doc ?? 0, list.length - 1))
  const hash = location.hash.match(/^#code=([\w-]+)/)?.[1]
  if (hash) try {
    const bytes = Uint8Array.from(atob(hash.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
    const code = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
    at = list.findIndex(d => d.code === code)
    if (at < 0) at = list.push({ code }) - 1
  } catch {}
  if (!list.length) at = list.push({ code: '' }) - 1
  // taken once: the tab it went into is kept, its script changed as it may be, and a reload is no second visit; embedded,
  // the link is all there is, so a reload runs it again
  if (hash && !EMBED) history.replaceState(null, '', location.pathname + location.search)
  const names = list => Array.isArray(list) ? list.filter(n => typeof n === 'string') : []
  docs = list.map(({ code, title, frame, view, track, muted, locked, heights, kinds }) => ({ id: ++docIds, code, title: typeof title === 'string' && title ? title : null, frame, view, track: typeof track === 'string' ? track : null, muted: names(muted), locked: names(locked),
    heights: heights && typeof heights === 'object' ? Object.fromEntries(Object.entries(heights).filter(([, h]) => Number.isFinite(h))) : {},
    kinds: kinds && typeof kinds === 'object' ? Object.fromEntries(Object.entries(kinds).filter(([, k]) => displays.some(d => d.name === k))) : {} }))
  return docs[at]
}
// Tabs over the picture, as an audio editor's open files: a script each, with its own history (the editor keeps it), its
// own steps (remember) and its last output, shown at once when it is (settle). A sound opened goes into a tab of its own,
// unless the tab shown is empty.
// each tab named by the sound its script opens (nameOf), the one shown as its script now reads; the others kept
export function retitle() { state.tabs = docs.map(d => ({ id: d.id, name: d.title ?? (d.id === state.tab ? nameOf(ed.code) : d.name ??= nameOf(d.code)) })) }
// A tab pressed: another, shown; the one shown, its name in hand to write anew, as a track's (a click is enough):
// Enter or a press elsewhere keeps it, its title over its sound's name (emptied, the sound's again), Esc leaves it
export function tabPress(id) {
  if (id !== state.tab) return switchTab(id)
  if (tabMoved) return
  state.renamingTab = id
  fieldFocus('.file-field')
}
export function tabRenamed(event, t) {
  const to = event.currentTarget.value.trim()
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== 'Escape') return
  event.stopPropagation()
  if (state.renamingTab !== t.id) return
  state.renamingTab = null
  const d = docs.find(d => d.id === t.id)
  if (!d || event.key === 'Escape') return
  d.title = to && to !== nameOf(d.id === state.tab ? ed.code : d.code) ? to : null
  retitle()
  store()
}
function nameOf(code) { return soundName(code, source(code)?.strings.map(x => x.name), !!chain(code)) }
// A sound's name: with tracks, theirs, as their layers have them (not every file their takes open, a dozen, none of them
// the track); else the files it opens; else 'generated' (`made`) or 'untitled'
export function soundName(code, files, made) {
  const tracks = tracksOf(code).map(t => t.name)
  return tracks.length ? tracks.join(' + ') : files?.length ? files.map(label).join(' + ') : made ? 'generated' : 'untitled'
}
export function switchTab(id) {
  if (id === state.tab || !docs.some(d => d.id === id)) return
  const was = docs.find(d => d.id === state.tab), next = docs.find(d => d.id === id)
  if (was) Object.assign(was, { code: ed.code, name: nameOf(ed.code), steps, depthWas, frame: was.frame ?? v.frame, view: was.view ?? v.state, track: state.track, muted: state.muted, locked: state.locked })
  assign({ steps: next.steps ?? [], depthWas: next.depthWas ?? 0 })
  state.tab = eng.tab = id
  // the edits the tab left waited to make go with it
  assign({ queued: [] })
  // the tab left plays on, if it plays, its player its own; the one shown plays as it was left, its playhead running
  cancelAnimationFrame(ticker)
  v.playhead = null
  assign({ pl: playerOf(next) })
  state.playing = pl.playing
  state.speed = pl.rate
  // its track edited, as it was left (its script, opened, keeps it valid: focusOn)
  state.track = next.track ?? null
  state.muted = next.muted ?? []
  state.locked = next.locked ?? []
  v.heights = next.heights ?? {}
  v.kinds = state.kinds = next.kinds ?? {}
  v.notes = {}
  assign({ notesFor: '' })
  focus(state.track)
  assign({ viewing: { delta: null, back: null } })
  v.select(0, 0)
  v.setCursor(0)
  // its sound at once, as it was last shown (none for a new one); while that is what its script makes as it reads now,
  // with what its run said, nothing runs again, else its script runs. One still on its way, as its script reads now,
  // is taken up where it has come to (takeUp)
  assign({ incoming: null })
  settle(next.output ?? null)
  if (!next.output) standIn(next)
  if (pl.playing) chase()
  ed.open(id, next.code)
  // its takes' places, as its script has them: a run, which would place them, may not come
  places()
  const out = next.output, a = next.coming
  if (a?.said && a.code === a.editor && a.editor === ed.code) { clearTimeout(timer); assign({ timer: 0 }); state.viewing = ''; retell(a.said); takeUp(a) }
  else if (out?.said && out.code === out.editor && out.editor === ed.code) { clearTimeout(timer); assign({ timer: 0 }); state.viewing = ''; retell(out.said) }
  next.ready = false
  status()
  rk?.refresh()
  retitle()
  inSight()
  store()
}
// A tab's run on its way, the tab shown again: the picture it comes into as far as it has come, over the sound shown
// where it is as long as that (alike), else in its place; the file it decodes not drawn from part of the way in, and
// heard from its next piece
function takeUp(a) {
  assign({ incoming: a })
  a.early = null
  a.preview = false
  a.hearing = null
  if (!a.parts.length || a.lanes) a.on = false
  else if (!a.on && alike(a) && a.parts.every(p => p.channels)) for (const p of a.parts) v.patch(p.at, p.channels)
  else begin(a)
  state.loading = !state.hasOutput
  status()
}
// Each tab's mark, in its close button's place till that is pointed at: its sound on its way, playing (the tab shown),
// or made while the tab was not shown, till it is
// Its speaker, before its name, while it plays or is muted, as a browser's tab's: 'playing' or 'muted' (sounding)
export function badges() {
  const marks = {}, sounding = {}
  for (const d of docs) {
    const shown = d.id === state.tab
    const m = (shown ? state.working : asking.get(d.id) || d.coming) ? 'working' : d.ready ? 'ready' : null
    if (m) marks[d.id] = m
    if (d.player?.muted) sounding[d.id] = 'muted'
    else if (shown ? state.playing : d.player?.playing) sounding[d.id] = 'playing'
  }
  if (JSON.stringify(marks) !== JSON.stringify(state.marks)) state.marks = marks
  if (JSON.stringify(sounding) !== JSON.stringify(state.sounding)) state.sounding = sounding
}
// More tabs than fit scroll, as a code editor's: the wheel, up and down as across, moves them along; the tab shown is
// brought into sight, the strip scrolled alone (scrollIntoView scrolls a page the editor is framed in, too)
export function scrollTabs(event) {
  const strip = event.currentTarget
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || strip.scrollWidth <= strip.clientWidth) return
  event.preventDefault()
  strip.scrollLeft += event.deltaY
}
export function inSight() {
  requestAnimationFrame(() => {
    const tab = root.querySelector('.file.current'), strip = tab?.parentElement
    if (!tab) return
    const t = tab.getBoundingClientRect(), s = strip.getBoundingClientRect()
    strip.scrollLeft += t.left < s.left ? t.left - s.left : t.right > s.right ? t.right - s.right : 0
  })
}
// Which sides of the tabs have more past them, faded out to it (editor.css): as they scroll, as the strip or the tabs
// change size, as tabs come and go
const tabStrip = root.querySelector('.files-list')
function tabEdges() {
  const a = tabStrip.scrollLeft > 1, b = tabStrip.scrollLeft + tabStrip.clientWidth < tabStrip.scrollWidth - 1, more = a && b ? 'both' : a ? 'start' : b ? 'end' : ''
  if ((tabStrip.dataset.more ?? '') !== more) more ? tabStrip.dataset.more = more : delete tabStrip.dataset.more
}
export function newTab(code = '') {
  const doc = { id: ++docIds, code }
  docs.push(doc)
  switchTab(doc.id)
  return doc
}
// A tab dragged along the others is held under the pointer, the others stepping aside as it passes their middles, and
// goes where it is let go, as a browser's tabs do; a press that stays put is a click
// a tab dragged, not clicked: the click its letting go makes names nothing (tabPress)
let tabMoved = false
export function dragTab(event, id) {
  tabMoved = false
  if (event.button) return
  const el = event.currentTarget.closest('.file'), tabs = [...el.parentElement.querySelectorAll('.file')], from = tabs.indexOf(el)
  const boxes = tabs.map(t => t.getBoundingClientRect()), step = boxes[from].width + 2, x0 = event.clientX, center = b => b.left + b.width / 2
  let moved = false, to = from
  const plotBox = root.querySelector('.plot').getBoundingClientRect(), y0 = event.clientY
  // down onto the picture, another tab's sound goes in as a track (attach)
  const onto = e => id !== state.tab && state.hasOutput && e.clientX >= plotBox.left && e.clientX <= plotBox.right && e.clientY >= plotBox.top && e.clientY <= plotBox.bottom
  const move = e => {
    const dx = e.clientX - x0, dy = e.clientY - y0
    if (!moved && Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
    moved = true
    el.classList.add('dragging')
    state.dropping = onto(e) ? 'track' : false
    if (state.dropping) { el.style.transform = `translate(${dx}px, ${dy}px)`; tabs.forEach(t => { if (t !== el) t.style.transform = '' }); to = from; return }
    el.style.transform = `translateX(${dx}px)`
    // a neighbour gives way once the tab dragged covers half of it: its leading edge past the neighbour's middle
    const left = boxes[from].left + dx, right = boxes[from].right + dx
    to = from
    boxes.forEach((b, i) => { if (i > from && right > center(b)) to = Math.max(to, i); if (i < from && left < center(b)) to = Math.min(to, i) })
    tabs.forEach((t, i) => { if (i !== from) t.style.transform = i >= Math.min(from, to) && i <= Math.max(from, to) ? `translateX(${to > from ? -step : step}px)` : '' })
  }
  const up = e => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up)
    if (!moved) return
    tabMoved = true
    const track = e.type === 'pointerup' && onto(e)
    state.dropping = false
    // laid out in the new order at once, nothing sliding back to where it was
    for (const t of tabs) { t.style.transition = 'none'; t.style.transform = ''; t.classList.remove('dragging') }
    if (to !== from) { docs.splice(to, 0, docs.splice(from, 1)[0]); retitle(); store() }
    requestAnimationFrame(() => requestAnimationFrame(() => { for (const t of tabs) t.style.transition = '' }))
    if (track) attach(id)
  }
  addEventListener('pointermove', move)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', up)
}
// Closing the last tab leaves an empty one; closing the one shown shows its neighbour. A tab closed with anything in it
// opens again where it was (⇧⌘T, as a browser's), as it was left: in this visit, the tab itself, its history with it;
// after a reload, as it was kept. Its sound is drawn again, not held while it is closed.
export function closeTab(id = state.tab) {
  const i = docs.findIndex(d => d.id === id)
  if (i < 0) return
  const doc = docs[i], kept = saved(doc)
  if (docs.length > 1 && id === state.tab) switchTab(docs[i + 1]?.id ?? docs[i - 1].id)
  else if (docs.length === 1) newTab()
  docs.splice(i, 1)
  eng.close(id)
  // what it plays stops with it
  doc.player?.dispose()
  doc.player = null
  doc.coming = null
  doc.ready = false
  if (kept.code.trim()) {
    doc.output = null
    closed.push({ ...kept, at: i, shut: Date.now(), doc })
    for (const c of closed.splice(0, closed.length - CLOSED)) if (c.doc) ed.close(c.doc.id)
  } else ed.close(id)
  retitle()
  store()
}
// the last closed, or the one at `i` (File › Open recent), in place of an empty tab
export function reopenTab(i = closed.length - 1) {
  const [c] = closed.splice(i, 1)
  if (!c) return
  const doc = c.doc ?? { id: ++docIds, code: c.code, frame: c.frame, view: c.view, track: c.track ?? null, muted: c.muted ?? [] }
  const blank = !ed.code.trim() ? state.tab : null
  docs.splice(Math.min(c.at ?? docs.length, docs.length), 0, doc)
  switchTab(doc.id)
  if (blank != null) closeTab(blank)
}

export function wire() {
  tabStrip.addEventListener('scroll', tabEdges, { passive: true })
  new ResizeObserver(tabEdges).observe(tabStrip)
  new MutationObserver(tabEdges).observe(tabStrip, { childList: true, subtree: true })
}
