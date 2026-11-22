// The recordings the sound menus list by category beside the synthesized samples (samples.js): a catalogue, JSON, at
// /samples/index.json on the playground's own origin (the site serves it beside /audio/), or where the page points it
// (?ui= samples; false, none). Asked for once, the first time a list of the samples opens, never as the editor loads; a
// catalogue that cannot be had, or holds nothing, is none, the synthesized alone listed, and nothing fails.
//   [{ file, name, category, group?, kind, about, by, license, page }]
// `file` from the catalogue's own address (speech/one-small-step.mp3); `kind`, the word the playground says it is, as
// the page says its own sound's (readouts.js); `about`, its line, what it is, then who made it and under what licence;
// `group`, music's (classical, modern, 8-bit). The categories and their groups in the order the catalogue first names
// them

const text = x => typeof x === 'string' ? x.trim() : ''

/**
 * read(list, from, origin) → the catalogue's recordings that say what they are and where (a file, a name, a category),
 * each with its `address`: its file from the catalogue's address `from`, a path from the site's root where it is the
 * site's own (`origin`), so a script that opens it opens it wherever the site is served; and its `label`, the name a
 * script's sound takes from it (editor/format.js label), the first of a label kept
 */
export function read(list, from, origin) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  return list.flatMap(e => {
    const file = text(e?.file), name = text(e?.name), category = text(e?.category).toLowerCase()
    if (!file || !name || !category) return []
    let url
    try { url = new URL(file, from) } catch { return [] }
    if (!/^https?:$/.test(url.protocol)) return []
    const address = url.origin === origin ? url.pathname : url.href, label = decodeURIComponent(url.pathname.split('/').pop())
    if (!label || seen.has(label)) return []
    seen.add(label)
    return [{ file, name, category, group: text(e.group).toLowerCase(), kind: text(e.kind).slice(0, 40), about: text(e.about), by: text(e.by), license: text(e.license), page: text(e.page), address, label }]
  })
}

/** shelves(recordings) → [{ category, groups: [{ group, recordings }] }]: the categories and, within each, its groups ('' none), each in the order first named */
export function shelves(recordings) {
  const out = []
  for (const r of recordings) {
    let shelf = out.find(s => s.category === r.category)
    if (!shelf) out.push(shelf = { category: r.category, groups: [] })
    let group = shelf.groups.find(g => g.group === r.group)
    if (!group) shelf.groups.push(group = { group: r.group, recordings: [] })
    group.recordings.push(r)
  }
  return out
}

/** A category or group as a menu names it: its word, its first letter a capital (speech, Speech; 8-bit as it is) */
export const titled = word => word.charAt(0).toUpperCase() + word.slice(1)

/** credit(recording) → the line a recording brings into the script over the statement that opens it, as a found sound's (sources.js credit) */
export const credit = r => `// "${r.name.replace(/\n/g, ' ')}"${r.by ? ` by ${r.by}` : ''}${r.license ? `, ${r.license}` : ''}${r.page ? `, ${r.page.replace(/^https?:\/\//, '')}` : ''}`

let asked = null, held = null, byLabel = new Map()
/** library(url) → the recordings, asked for at `url` the first time (null: none asked for), the same promise after; [] where none could be had */
export function library(url) {
  if (!url) return Promise.resolve([])
  return asked ??= fetch(url).then(r => r.ok ? r.json() : []).catch(() => []).then(list => {
    held = read(list, new URL(url, location.href).href, location.origin)
    byLabel = new Map(held.map(r => [r.label, r]))
    return held
  })
}
/** the recordings once the catalogue has come, else null */
export const recordings = () => held
/** recorded(name) → the recording a sound by that name is (its label), once the catalogue has come */
export const recorded = name => byLabel.get(name)
