/**
 * package.json — every runtime import of a shipped file must be a dependency.
 * Guards the class of bug where a package works in the dev tree (devDeps/symlinks
 * resolve) but breaks on registry install: @audio/decode was in devDependencies
 * while core.js imports it at module scope (2.6.0).
 */
import test, { is } from 'tst'
import { readFileSync, readdirSync } from 'fs'

test('fix package.json — shipped runtime imports are declared dependencies', () => {
  let pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  let shipped = pkg.files.filter(f => f.endsWith('.js'))
  for (let f of pkg.files) if (f === 'fn') shipped.push(...readdirSync(new URL('../fn', import.meta.url)).map(x => 'fn/' + x))

  let deps = new Set(Object.keys(pkg.dependencies))
  let builtin = /^(node:|fs$|fs\/|url$|path$|os$)/
  let missing = []
  for (let f of shipped) {
    let src
    try { src = readFileSync(new URL('../' + f, import.meta.url), 'utf8') } catch { continue }
    for (let m of src.matchAll(/(?:from\s+|import\()\s*['"]([^'".][^'"]*)['"]/g)) {
      let spec = m[1]
      if (builtin.test(spec)) continue
      let name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (name === pkg.name) continue // self-reference (worker self-host)
      if (!deps.has(name)) missing.push(`${name} (imported by ${f})`)
    }
  }
  is(missing, [], 'undeclared runtime deps')
})
