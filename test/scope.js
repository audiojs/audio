// The browser suites a change can reach: node test/scope.js [base [head]] prints them as JSON, each with its command, for CI's
// matrix (.github/workflows/browser.yml). Without a base, the working tree against HEAD; a base git doesn't know
// (a new branch's all-zero one) or a change to this file or the workflow runs them all.
import { execFileSync } from 'node:child_process'

// the library as the pages load it: its modules, the bundle they become, what that bundle pulls in
const LIB = ['audio.js', 'core.js', 'plan.js', 'cache.js', 'stats.js', 'batch.js', 'worker.js', 'deck.js', 'fn/', '.esbuild.js', 'package-lock.json']
// the website as served: its pages, their scripts and the bundles .site-build.js makes
const SITE = ['index.html', 'site/', 'logo/', 'assets/', '.site-build.js', 'package-lock.json']

// advice: on a shared runner the audio thread misses deadlines now and then, so these report and don't fail the run
const SUITES = [
  // the library's own suite on a page, against dist/audio.js
  { name: 'library', run: 'TEST_PAGES=library node test/browser.js', on: [...LIB, 'test/index.js', 'test/test.html', 'test/browser.js'] },
  // its resources released and its heap bounded, on a bare page and on the demo
  { name: 'memory', run: 'npm run test:memory', on: [...LIB, ...SITE, 'test/memory.test.js', 'test/memory-core.test.js'] },
  // the editor whole: its engine against the library in Node, its code against the CLI
  { name: 'playground', run: 'npm run test:playground', on: [...SITE, 'playground.html', 'editor.html', 'playground/', 'worker.js', 'deck.js', 'bin/', 'test/playground.test.js', 'test/gen.js', 'test/fixture.wav'] },
  { name: 'recording', run: 'CI= node --test --test-name-pattern="recording with the spectrogram shown" test/playground.test.js', advice: true, on: ['playground/', 'test/playground.test.js'] },
  // real-time playback, clicks and gaps measured as heard
  { name: 'playback', run: 'TEST_PAGES=playback node test/browser.js', advice: true, on: [...LIB, 'test/play.html', 'test/play.js', 'test/browser.js'] },
]
const ALL = ['test/scope.js', '.github/workflows/browser.yml']

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)
const known = sha => { try { return git('cat-file', '-e', `${sha}^{commit}`), true } catch { return false } }

const [base, head = 'HEAD'] = process.argv.slice(2)
const changed = base === undefined ? [...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')]
  : known(base) ? git('diff', '--name-only', base, head) : null
const hit = paths => changed.some(file => paths.some(p => p.endsWith('/') ? file.startsWith(p) : file === p))
const picked = !changed || hit(ALL) ? SUITES : SUITES.filter(s => hit(s.on))

console.log(JSON.stringify(picked.map(({ name, run, advice = false }) => ({ name, run, advice }))))
