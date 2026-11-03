import { hold as holdInput } from '../sources.js'
import scales from '../scale.js'
import { load, parse, skin, fonts, wear, webview, webviewFonts } from '../theme.js'
import { temperature, rgb, MAPS } from '../tint.js'
import { docs, docOf } from '../editor.js'
import { root, DESKTOP, GIVEN, APART, rulers, scrolls, grids, LOOK, looks, specMethods, mapNames, WAVE, waveLooks, levelList, scaleNames, displays, scrubs } from './config.js'
import { state, v, pl } from './context.js'
import { stamp, note } from './format.js'
import { store } from './persist.js'
import { marks, notesShown, meter, describe } from './readouts.js'

// How the page looks: the theme worn, the waveform's and spectrogram's looks and their swatches, the settings and the
// options that set them, the display of each band

// A look's preview, a gradient across a key: a colormap's stops, whole as the spectrogram takes them, or as the waveform
// does (`upper`, view.js tones: the half that reads against the screen, temperature's from 100 Hz to 10 kHz at one
// lightness; before the view is made, the half a dark screen takes); grey's, the screen to its ink. A colour's: RGB's
// primaries mixed, low to high; three bands' as they lie over each other, across the axis; the centroid's the
// colormap's; the dominant's greyed to its foot
const swatch = stops => `linear-gradient(90deg, ${stops.join(', ')})`
const css = c => `rgb(${c.slice(0, 3).map(v => Math.round(v * 255)).join(' ')})`
const GREY = ['var(--color-screen)', 'var(--color-screen-ink)'], UPPER = ['var(--color-screen-muted)', 'color-mix(in oklab, var(--color-screen-muted), var(--color-screen-ink))', GREY[1]]
const WARMTH = Array.from({ length: 9 }, (_, k) => css(temperature(k / 8)))
const stopsOf = (map, upper = false) => upper ? v?.tones(map) ?? (map === 'temperature' ? WARMTH : MAPS[map]?.slice(4) ?? UPPER) : MAPS[map] ?? GREY
const mapSwatch = (map, upper = false) => swatch(stopsOf(map, upper))
const RGB = swatch([[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]].map(b => css(rgb(b))))
function colourSwatch(colour, map) {
  const t = stopsOf(map, true), [lo, mid, hi] = [t[0], t[t.length >> 1], t.at(-1)]
  if (colour === 'bands') return RGB
  if (colour === 'layers') return `linear-gradient(${lo} 0 15%, ${mid} 15% 35%, ${hi} 35% 65%, ${mid} 65% 85%, ${lo} 85%)`
  if (colour === 'centroid') return swatch(t)
  if (colour === 'dominant') return `linear-gradient(transparent, var(--color-screen-muted)), ${swatch(t)}`
  return swatch(['var(--color-screen-wave)', 'var(--color-screen-wave)'])
}
// the look as gl-spectrogram takes it: 17 stops of a colormap, bent by the gamma; grey's none, its levels the skin's
// ink over the screen, which the picture makes (view.js shades)
export function paint({ map, gamma, depth, size, method }) {
  const n = 17, u = k => (k / (n - 1)) ** gamma
  const at = (hex, t) => { const i = Math.min(hex.length - 2, Math.floor(t * (hex.length - 1))), f = t * (hex.length - 1) - i, rgb = h => [1, 3, 5].map(j => parseInt(h.slice(j, j + 2), 16)); return `rgb(${rgb(hex[i]).map((v, j) => Math.round(v + (rgb(hex[i + 1])[j] - v) * f)).join(' ')})` }
  return { color: MAPS[map] ? Array.from({ length: n }, (_, k) => at(MAPS[map], u(k))) : null, gamma, depth, size, method }
}
// The theme worn (theme.js): one of VS Code's, those it ships or one opened from a file, kept whole (`audio-theme`) so
// the page comes up in it and reads it again by the mapping of the day, with VS Code's fonts; none, the screen's own
// skin. In a VS Code webview, the one VS Code wears and the fonts it has set, followed as they change
export let worn = null
const dressed = theme => ({ ...skin(theme), ...fonts() })
export function dress(next) {
  worn = next
  wear(worn && dressed(worn.theme))
  v.restyle()
  if (APART) return
  try { worn ? localStorage.setItem('audio-theme', JSON.stringify(worn)) : localStorage.removeItem('audio-theme') } catch {}
}
export const setTheme = async t => dress(t && { name: t.name, theme: await load(new URL(`../themes/${t.file}`, import.meta.url).href, { kind: t.kind }) })
export function openTheme() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
  input.onchange = async () => {
    const file = input.files[0]
    if (!file) return
    try { const own = parse(await file.text()); dress({ name: own.name ?? file.name.replace(/\.json$/i, ''), theme: await load(null, { theme: own }) }) }
    catch (e) { note(`${file.name} is not a VS Code colour theme: ${e.message}`, 'error') }
  }
  input.click()
}
// The options, group by group: each its choices, what the chosen one does said under them. How each picture draws, in
// its dropdown (its tab pressed again): the waveform's level units, colour, fill and lanes, the spectrogram's frequency scale,
// method, colours, gamma, range and FFT size; the settings', a section of them by kind (settingSections): what shows
// over the sound and how time reads; how an edit steps and joins; how a held caret sounds and a take records. Of the
// state handed in (`s`): the page's, or, drawn as the page is wired, the one being made
function optionGroups(kind, s = state) {
  const group = (label, list, now, set, more = {}) => ({ label, ...more, options: list.map(([value, name, hint, swatch]) => ({ label: name, hint, swatch, on: now === value, run: () => set(value), value })) })
  if (kind === 'wave') return [
    group('Levels in', levelList.map(l => [l.name, l.label, `The level axis in ${l.label.toLowerCase()}: ${l.example}`]), s.levels, setLevels),
    group('Weighting', waveLooks.weighting, s.wave.weighting, w => setWave('weighting', w)),
    group('Colour', waveLooks.colour.map(([v, name, hint]) => [v, name, hint, colourSwatch(v, s.wave.map)]), s.wave.colour, c => setWave('colour', c), { select: true }),
    group('Colormap', waveLooks.map.map(([m, name, hint]) => [m, name, hint, mapSwatch(m, true)]), s.wave.map, m => setWave('map', m), { select: true }),
    group('Fill', waveLooks.fill, s.wave.fill, c => setWave('fill', c)),
    group('Channels', waveLooks.lanes, s.wave.lanes, c => setWave('lanes', c)),
    meterGroup('meters', 'Level', 'The level where it plays, or the caret is, by the lane\'s right end', s)
  ]
  if (kind === 'spec') return [
    group('Frequency scale', Object.entries(scales).map(([name, sc]) => [name, scaleNames[name], sc.text[0].toUpperCase() + sc.text.slice(1)]), s.scale, setScale),
    group('Method', specMethods, s.look.method, m => setLook('method', m)),
    group('Colours', looks.map.map(m => [m, ...mapNames[m], mapSwatch(m)]), s.look.map, m => setLook('map', m), { select: true }),
    // a curve's exponent, one quantity bending one way: a slider through its steps, not keys
    group('Gamma', looks.gamma.map(g => [g, String(g), g < 1 ? 'Quiet parts brighter' : g > 1 ? 'Quiet parts darker' : 'Levels even']), s.look.gamma, g => setLook('gamma', g), { slider: true, preview: g => { v.spectrogram = paint({ ...state.look, gamma: g }) } }),
    group('Range', looks.depth.map(d => [d, `${d}dB`, `From the loudest down ${d} dB to the floor`]), s.look.depth, d => setLook('depth', d)),
    group('FFT size', looks.size.map(n => [n, n ? String(n) : 'Auto', n ? `Frames of ${n} samples` : 'Frames of 40 ms, longer on a zoomed band']), s.look.size, n => setLook('size', n)),
    meterGroup('spectrum', 'Spectrum', 'The spectrum where it plays, or the caret is, by the lane\'s right end, on its scale', s)
  ]
  if (kind === 'notes') return [
    meterGroup('keys', 'Keys', 'A piano\'s keys by the lane\'s right end, the note where it plays, or the caret is, lit', s)
  ]
  if (kind === 'edit') return [
    group('Level steps', s.steps.map(db => [db, `${db}dB`, `A selection's level, dragged by its pill, goes ${db} dB a step`]), s.levelStep, setStep),
    group('Splices', s.splices.map(ms => [ms, ms ? `${ms}ms` : 'Off', ms ? `An edit's seams crossfaded over ${ms} ms, so they make no click` : 'At a seam, either side meets as it is']), s.splice, setSplice)
  ]
  if (kind === 'play') return [
    group('Scrub', scrubs.map(m => [m.name, m.label, m.text]), s.scrub, setScrub),
    group('Record in', [[1, 'Mono', 'One channel, the input\'s first: a voice, one microphone'], [2, 'Stereo', 'Two channels, as the input gives them: a stereo pair, an interface\'s two inputs']], s.recordIn, setRecordIn)
  ]
  return [
    { label: 'Show over the sound', options: [
      ...s.overlayList.map(o => ({ label: o.label, hint: o.title, on: !!s.show[o.name], run: () => toggleShow(o.name) })),
      { label: 'Snap', hint: 'To cues and markers; hold Alt to see them', on: s.snapping, run: () => state.toggleSnap() }
    ] },
    group('Times in', s.unitList.map(u => [u.name, u.short, `${u.label}: ${u.example}`]), s.units, setUnits),
    group('Time row', rulers.map(r => [r.name, r.label, r.name === 'none' ? 'Only the times that matter now' : r.name === 'ticks' ? 'Ticks along the time row, no labels' : 'The times along the row, labelled']), s.ruler, setRuler),
    group('Scroll', scrolls, s.scroll, setScroll),
    group('Grid', grids, s.grid, setGrid)
  ]
}
// A look's meter, by the lanes' right end: one key, pressed while it shows
function meterGroup(name, label, hint, s) { return { label: 'Meter', options: [{ label, hint, on: !!s.show[name], run: () => toggleShow(name) }] } }
// The settings' sections, each its name and in a few words what it holds, open till a press folds it, kept so (`folds`)
export function settingSections(s = state) {
  return [['view', 'View', 'over the sound, and time'], ['edit', 'Editing', 'steps and seams'], ['play', 'Scrub and record', 'a held caret, a take']]
    .map(([kind, label, text]) => ({ kind, label, text, groups: optionGroups(kind, s), open: s.folds[kind] ?? true }))
}
export function fold(kind, open) {
  if ((state.folds[kind] ?? true) === open) return
  state.folds = { ...state.folds, [kind]: open }
  store()
}
// the View menu's submenus, the same groups
export function lookMenu(kind) {
  return { label: kind === 'wave' ? 'Waveform options' : 'Spectrogram options', items: optionGroups(kind).map(g => ({ label: g.label, items: g.options.map(o => ({ label: o.label, hint: o.hint, checked: o.on, run: o.run })) })) }
}
export function resetView() {
  v.fit()
  setDisplay('wave')
  state.show = { hits: true, gain: true, meters: true, spectrum: true, keys: true, guides: true }
  setUnits('clock')
  setLevels('linear')
  setRuler('labels')
  setGrid('marks')
  state.look = { ...LOOK }
  v.spectrogram = paint(state.look)
  state.wave = { ...WAVE }
  v.waveform = state.wave
  marks()
  store()
}
export function toggleShow(name) {
  state.show = { ...state.show, [name]: !state.show[name] }
  store()
  marks()
  meter()
}
// What every band shows (View; a sound's look), each track's own let go
export function setDisplay(name) {
  const d = docOf(state.tab)
  if (name === state.display && !Object.keys(d?.kinds ?? {}).length) return
  state.display = v.display = name
  trackKinds(d, {})
  store()
  notesShown()
}
// What a track's lane shows (its look, its menu), the others the picture's, as Audacity's tracks each show a waveform or
// a spectrogram, here its notes too
export function setKind(name, kind) {
  const d = docOf(state.tab)
  if (!d || !name) return
  const { [name]: _, ...rest } = d.kinds ?? {}
  trackKinds(d, kind === state.display ? rest : { ...rest, [name]: kind })
  store()
  notesShown()
}
// what each track of a tab shows, its own: kept with the tab, the view and the page told where it is the one shown
export function trackKinds(d, kinds) {
  if (d) d.kinds = kinds
  if (!d || d.id === state.tab) v.kinds = state.kinds = kinds
}
// How a band shows, the dropdown its look opens (a track's by its name, a sound's ''): what it shows, then how that
// draws (the notes, their meter alone)
export function laneGroups(name, s = state) {
  const kind = (name && s.kinds[name]) || s.display
  const shows = { label: 'Shows', options: displays.map(d => ({ label: d.label, hint: d.hint, on: d.name === kind, run: () => showAs(d.name, name || null), value: d.name })) }
  return [shows, ...optionGroups(kind, s)]
}
// what a track's lane shows, by its name (a sound's, none: the picture's); the edited one's lane shown as `kind`
export const shows = name => docOf(state.tab)?.kinds?.[name] ?? state.display
export const showAs = (kind, name = state.track) => name ? setKind(name, kind) : setDisplay(kind)
export function setScale(name) { state.scale = v.scale = name; store() }
function setWave(key, value) { state.wave = { ...state.wave, [key]: value }; v.waveform = state.wave; store() }
// How a held caret sounds (scrub.js), one of the lab's ways
export function setScrub(name) { state.scrub = name; for (const d of docs) if (d.player) d.player.scrubMode = name; store() }
function setRecordIn(n) { state.recordIn = n; if (DESKTOP) holdInput(n); store() }
export function setUnits(name) {
  state.units = v.units = name
  state.time = stamp(pl.playing ? pl.time : v.cursor)
  describe()
  store()
}
export function setLevels(name) { state.levels = v.levels = name; store() }
export function setRuler(mode) { state.ruler = v.ruler = mode; store() }
function setScroll(mode) { state.scroll = v.scroll = mode; store() }
export function setGrid(name) { state.grid = v.grid = name; store() }
export function setStep(db) { state.levelStep = v.levelStep = db; store() }
export function setSplice(ms) { state.splice = ms; store() }
export function setLook(key, value) { state.look = { ...state.look, [key]: value }; v.spectrogram = paint(state.look); store() }
// The panel's left edge, dragged: its width, from 280 px to two thirds of the output's, kept in this browser
export function resizePanel(event) {
  const panes = root.querySelector('.panes'), side = root.querySelector('.side-slab'), from = event.clientX, was = side.getBoundingClientRect().width
  event.preventDefault()
  event.target.setPointerCapture(event.pointerId)
  const go = e => { state.panel = Math.round(Math.max(280, Math.min(panes.clientWidth * 2 / 3, was + from - e.clientX))); panes.style.setProperty('--panel', `${state.panel}px`) }
  const stop = () => { event.target.removeEventListener('pointermove', go); store() }
  event.target.addEventListener('pointermove', go)
  event.target.addEventListener('lostpointercapture', stop, { once: true })
}
// Embedded (?controls= view), the picture as the other: the waveform, the spectrogram (its switch the look's icon)
export function flipView() { setDisplay(state.display === 'wave' ? 'spec' : 'wave') }

export function wire() {
  try { worn = APART ? null : JSON.parse(localStorage.getItem('audio-theme')); wear(worn && dressed(worn.theme)) } catch { worn = null }
  // given, the skin the page around it sends, { skin: its tokens (theme.js skin, fonts), or null for skin.css's own }:
  // worn as a theme is, not kept; the page told once this listens (at the end)
  if (GIVEN) addEventListener('message', ({ source, origin, data }) => {
    if (source !== parent || origin !== location.origin || !data || !('skin' in data)) return
    wear(data.skin)
    v?.restyle()
  })
  if (webview()) {
    const follow = () => { worn = { name: 'VS Code', theme: webview() }; wear({ ...skin(worn.theme), ...webviewFonts() }); v?.restyle() }
    follow()
    // VS Code marks the body with the theme's kind and id as it changes; the colours it sets on the root, as the skin's
    // are, so the root is not watched
    new MutationObserver(follow).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-vscode-theme-id'] })
  }
}
