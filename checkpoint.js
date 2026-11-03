/**
 * Checkpoints — what an instance's edits make, kept by what makes it: the sound it plays and its edits up to a step
 * (keysOf). One starting as one kept renders only what follows it (recall): an edit added at the end, a step turned off
 * or on renders from the output before it, not from the source. Kept in a store the host gives, as audio.memo is
 * (audio.store: in memory, or the browser's files); what to keep and when is the host's.
 *
 *   let kept = audio.store()
 *   for (let k = 1; k <= a.edits.length; k++) await keep(a, kept, { step: k })   // each step from the one before it
 *   let b = await recall(a.clone().undo(), kept)    // a sound of the output before the last step: nothing renders
 */

import audio from './core.js'

/** The sound an instance plays: the one it was copied from (clone, audio.from(a)) at its rate and channels, or itself */
export const rootOf = a => a._.root ?? a

// Each sound's name in this process: a count of its own after a mark of the process, so no other process's name is the
// same (a store kept past the process)
const ids = new WeakMap(), PROCESS = Math.random().toString(36).slice(2, 8)
let last = 0
export const idOf = root => ids.get(root) ?? (ids.set(root, `${PROCESS}.${++last}`), ids.get(root))

// its marks as they are: those of the file it opens, or any put on it
const marksOf = a => (a.meta, JSON.stringify([a._.markers ?? [], a._.regions ?? [], a._.marks ?? []]))

/** The keys of an instance's start and of its output after each of its edits: [the sound it plays, its marks; + its first
 *  edit; …], as far as they can be said. `id` names the sound it plays (idOf, by default: this process's name for it);
 *  one it gives none, nothing. A step holding a function, samples, or a sound that can't be said has none, nor has any
 *  after it. An op is known by its name and its settings: one registered again under its name is taken for the same.
 *  `marked`: marks of its own, not those of the sound it plays: a mark put after a step is lost on what the steps before
 *  it made, so only its whole output is a start */
export function keysOf(a, id = idOf, seen = new Set()) {
  let root = rootOf(a), own = seen.has(a) ? null : id(root)
  if (own == null) return Object.assign([], { marked: true })
  // a sound pushed into can be recorded into again: its length is part of what it is
  let marks = marksOf(a), keys = Object.assign([`${own}${root._.push ? `@${root._.len}` : ''}|${marks}|`], { marked: marks !== marksOf(root) })
  seen.add(a)
  for (let e of a.edits) { let s = said(e, id, seen); if (s == null) break; keys.push(`${keys.at(-1)}${s};`) }
  seen.delete(a)
  return keys
}

/** An edit, or a value in it, as text to compare: the same for the same settings, its keys in order; a sound by its key;
 *  null for what can't be said (a function, samples, an object of a class, a sound that can't) */
function said(v, id, seen) {
  if (typeof v === 'number') return Object.is(v, -0) ? '0' : String(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (v == null || typeof v === 'boolean') return String(v)
  if (typeof v !== 'object' || ArrayBuffer.isView(v)) return null
  if (v.pages) { let k = keysOf(v, id, seen); return k.length === v.edits.length + 1 ? `<${k.at(-1)}>` : null }
  if (Array.isArray(v)) { let p = v.map(x => said(x, id, seen)); return p.includes(null) ? null : `[${p}]` }
  let proto = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return null
  let p = Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => { let x = said(v[k], id, seen); return x == null ? null : `${JSON.stringify(k)}:${x}` })
  return p.includes(null) ? null : `{${p}}`
}

/** `a` as it renders from the longest of its starts kept in `store`: the output kept there, its marks on it, with the
 *  edits after it, a sound of its own (`edits.length`: how many still render); null where none is kept, or where a step
 *  after it needs one before it (a paste, its copy) */
export async function recall(a, store, id) {
  let keys = keysOf(a, id), n = a.edits.length
  for (let k = Math.min(keys.length - 1, n); k >= 0 && !(keys.marked && k < n); k--) {
    let got = await store.open(keys[k])
    if (!got) continue
    try { return onto(got, a.edits.slice(k)) } catch {}
  }
  return null
}

/** Keep `a`'s output after its first `step` edits (all, by default) in `store`, with its marks and `meta` (the host's):
 *  `sound`, or rendered (from the longest of its starts kept: only the edits after it render). Null where it can't be:
 *  a step up to it can't be said (keysOf), or a sound it reads is still arriving; else the sound kept */
export async function keep(a, store, { sound, meta = {}, step = a.edits.length, id } = {}) {
  let keys = keysOf(a, id)
  if (step >= keys.length || keys.marked && step < a.edits.length || !arrived(a)) return null
  let p = step < a.edits.length ? prefix(a, step) : a
  try {
    if (!sound) {
      let b = await recall(p, store, id) ?? p
      try { sound = audio.from(await b.read(), { sampleRate: b.sampleRate }) }
      finally { if (b !== p) b.dispose() }
    }
    let marks = { markers: p.markers.map(({ time, label }) => ({ time, label })), regions: p.regions.map(({ at, duration, label }) => ({ at, duration, label })) }
    await store.set(keys[step], sound, { ...marks, ...meta })
    return sound
  } finally { if (p !== a) p.dispose() }
}

/** A kept output ({ sound, meta }, its marks in meta, as keep puts them) with `edits` after it: a sound of its own */
export function onto({ sound, meta }, edits) {
  let b = sound.clone()
  try {
    if (meta?.markers?.length) b.markers = meta.markers
    if (meta?.regions?.length) b.regions = meta.regions
    return edits.length ? b.run(...edits.map(([type, opts]) => [type, opts ? { ...opts } : {}])) : b
  } catch (e) { b.dispose(); throw e }
}

/** The instance with its first `k` edits, its marks with it, as its source arrives */
export function prefix(a, k) {
  let b = a.clone()
  b.undo(b.edits.length - k)
  return b
}

// Whether every sound `v` reads has all arrived: the one it plays, and those its edits put in
function arrived(v, seen = new Set()) {
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v) || seen.has(v)) return true
  seen.add(v)
  if (v.pages) return rootOf(v).decoded !== false && arrived(v.edits, seen)
  return Object.values(v).every(x => arrived(x, seen))
}
