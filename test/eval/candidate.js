// A candidate package in place of the installed one, for the eval's run (node test/eval.js name=path …): a resolve hook
// (module.register) that sends `name` and `name/…` to the candidate's folder from any importer, as if it stood where
// the installed copy stands. The candidate's own imports resolve from its folder first (a checkout keeps its
// dependencies, a folder of a scratch install keeps that install's), then from the subject's: a bare folder (an
// unpacked tarball) takes the installed tree's. Nothing is copied or written.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

let map = {}, root = null

export function initialize(data) { map = data.map; root = data.root }

// '@scope/name/sub' → '@scope/name', 'name/sub' → 'name'; null for a relative, absolute, node: or URL specifier
const nameOf = s => /^[./]|^[a-z]+:/i.test(s) ? null : s.split('/').slice(0, s.startsWith('@') ? 2 : 1).join('/')
const inside = (url, dir) => url?.startsWith(pathToFileURL(dir).href + '/')

export async function resolve(spec, ctx, next) {
  let name = nameOf(spec)
  if (name && map[name]) {
    let dir = map[name], sub = spec.slice(name.length)
    // a self-reference from inside the candidate resolves its exports as Node does; a package without exports, by path
    let r = await next(spec, { ...ctx, parentURL: pathToFileURL(path.join(dir, 'package.json')).href }).catch(() => null)
    if (r && inside(r.url, dir)) return r
    // no self-reference (no exports, or another name): the path; never the installed copy in its place
    let file = sub ? path.join(dir, sub) : path.join(dir, JSON.parse(readFileSync(path.join(dir, 'package.json'))).main ?? 'index.js')
    if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true }
    throw new Error(`eval: ${spec} is not in the candidate ${dir}`)
  }
  try { return await next(spec, ctx) }
  catch (e) {
    // a candidate's dependency its own folder does not hold: the subject's tree's
    if (name && root && Object.values(map).some(d => inside(ctx.parentURL, d))) return next(spec, { ...ctx, parentURL: pathToFileURL(path.join(root, 'package.json')).href })
    throw e
  }
}

/** The version of `name` an importer at `from` (a folder) gets: node_modules walked up from it, then from the subject's
 *  root, as resolve() falls back; null where none holds it */
export function versionAt(name, from, base) {
  for (let start of [from, base]) {
    for (let d = start; ; d = path.dirname(d)) {
      let f = path.join(d, 'node_modules', name, 'package.json')
      if (existsSync(f)) return { version: JSON.parse(readFileSync(f)).version, dir: path.dirname(f) }
      if (path.dirname(d) === d) break
    }
  }
  return null
}

/** Whether `v` satisfies a range of the forms npm ranges of this family take: x.y.z, ^x.y.z, ~x.y.z, >=x.y.z, a || b,
 *  * or ''. Another form: null (not checked, and said so) */
export function satisfies(v, range) {
  let p = s => s.split('-')[0].split('.').map(Number), [a, b, c] = p(v)
  let one = r => {
    r = r.trim()
    if (r === '*' || r === '' || r === 'latest') return true
    let m = r.match(/^(\^|~|>=|=)?v?(\d+)\.(\d+)\.(\d+)(?:-[\w.]+)?$/)
    if (!m) return null
    let [, op = '=', X, Y, Z] = m, [x, y, z] = [X, Y, Z].map(Number), ge = a > x || a === x && (b > y || b === y && c >= z)
    if (op === '=') return a === x && b === y && c === z
    if (op === '>=') return ge
    if (op === '~') return ge && a === x && b === y
    // ^: the leftmost non-zero part held
    return ge && (x ? a === x : y ? a === 0 && b === y : a === 0 && b === 0 && c === z)
  }
  let parts = range.split('||').map(one)
  return parts.includes(true) ? true : parts.includes(null) ? null : false
}

export const fromUrl = u => fileURLToPath(u)
