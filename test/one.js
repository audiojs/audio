// One test file, started once it has registered every test: node test/one.js <name> [--optional]
// tst starts a file by itself when its count of tests has stood for 10 ms. A top-level await after the first test
// (a package imported where its tests begin) outlasts that on a slow import, and every test after it is never run,
// the file still ending "pass" with exit 0. Here the run starts when the file has finished evaluating.
// --optional: a package the file imports is not installed, so the file is skipped, not failed (bare CI)
import test, { run } from 'tst'
import { existsSync } from 'node:fs'

test.manual = true
const [name, flag] = process.argv.slice(2), file = new URL(`./${name}.js`, import.meta.url)
// a file that is not there fails, optional or not: --optional is for a package the file imports
if (!existsSync(file)) throw new Error(`test/one.js: no test file test/${name}.js`)
try { await import(file) }
catch (e) {
  // a package (`Cannot find package`), not a module of the repository's own that a typo or a move left missing
  if (flag !== '--optional' || e.code !== 'ERR_MODULE_NOT_FOUND' || !e.message.startsWith('Cannot find package')) throw e
  console.warn(`skip ${name}: ${e.message.split("'")[1] || ''} missing`)
  process.exit(0)
}
process.exit((await run()).failed.length ? 1 : 0)
