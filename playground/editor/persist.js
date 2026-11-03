import { own, owner, claim } from '../keep.js'
import { recent, docs, closed, talks } from '../editor.js'
import { EMBED, GIVEN, APART, KEY } from './config.js'
import { state, v, ed, pl } from './context.js'
import { link } from './files.js'
import { note } from './format.js'
import { recorder, stopRecording } from './recording.js'

// What this browser keeps of the page, and one editor writing it at a time

// One editor writes at a time (keep.js own): opened in a second tab, it asks there to be used there, and once the first
// has stored what it has, reads it again; the first, asked, keeps its take, stores, and says where it is now, a click
// bringing it back. Nothing waits for it: the page comes up as it was stored, writing nothing until it is the one.
const elsewhere = document.querySelector('dialog.elsewhere')
// the files being written to the browser's storage (hold), which the page waits for before it steps aside
export const writing = new Set()
// (a dialog's field or button is focused as it opens, not marked autofocus: a frame in another site's page is refused that, aloud)
const away = run => { const go = elsewhere.querySelector('button'); go.onclick = run; if (!elsewhere.open) { elsewhere.showModal(); go.focus() } }
const back = async () => { await claim(); location.reload() }
export let owning
// A tab as it is kept: its script, where it was looked at and what was selected
export const saved = d => {
  const shown = d.id === state.tab
  return { code: shown ? ed.code : d.code, title: d.title ?? null, frame: d.frame ?? (shown ? v?.frame : null), view: d.view ?? (shown ? v?.state : null), track: shown ? state.track : d.track ?? null, muted: shown ? state.muted : d.muted ?? [], locked: shown ? state.locked : d.locked ?? [], heights: d.heights ?? {}, kinds: d.kinds ?? {} }
}
// the storage full, the tabs and the settings are kept without their conversations, and the page says so, once
let full = false
export const store = () => {
  // embedded, what the page keeps is its link to the whole editor, the script as it reads now
  if (EMBED) return ed && link(ed.code).then(code => state.full = `${location.pathname}#code=${code}`)
  if (GIVEN) return
  if (!ed || !owner()) return
  const all = { docs: docs.map(saved), doc: docs.findIndex(d => d.id === state.tab), closed: closed.map(({ doc, ...c }) => doc ? { ...saved(doc), at: c.at, shut: c.shut } : c), display: state.display, scale: state.scale, format: state.format, encoding: state.encoding, spec: state.spec, cuts: { format: state.cutFormat, fps: state.fps }, side: state.side, show: state.show, units: state.units, snap: state.snapping, curve: state.fadeCurve, levels: state.levels, ruler: state.ruler, scroll: state.scroll, grid: state.grid, step: state.levelStep, look: state.look, wave: state.wave, agent: { url: state.bridgeUrl, key: state.bridgeKey }, splice: state.splice, scrub: state.scrub, record: state.recordIn, reads: state.reads, hears: state.hears, grip: state.gripMode, panel: state.panel, folds: state.folds, recent, ...talks() }
  try { localStorage.setItem(KEY, JSON.stringify(all)); full = false }
  catch {
    const { chats, chat, ...bare } = all
    try { localStorage.setItem(KEY, JSON.stringify(bare)) } catch {}
    if (!full) note('The browser’s storage for this page is full: the agent’s conversations are not kept.', 'error')
    full = true
  }
}
// stored a moment after the last of a run of changes (typing, selecting)
export const later = () => { clearTimeout(store.timer); store.timer = setTimeout(store, 500) }

export function wire() {
  elsewhere.addEventListener('cancel', event => event.preventDefault())
  owning = APART ? Promise.resolve() : own({
    ask: () => new Promise(away),
    give: async () => { if (recorder) await stopRecording(); await Promise.all(writing); store() },
    lost: () => { pl.close(); recorder?.cancel(); away(back) }
  }).then(fresh => { if (!fresh) return location.reload(), new Promise(() => {}); if (elsewhere.open) elsewhere.close(); store() })
}
