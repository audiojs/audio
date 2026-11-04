// The browser suites a change can reach: node test/scope.js [base [head]] prints them as JSON, each with its command, for CI's
// matrix (.github/workflows/browser.yml). Without a base, the working tree against HEAD; a base git doesn't know
// (a new branch's all-zero one) or a change to this file or the workflow runs them all.
import { execFileSync } from 'node:child_process'

// the library as the pages load it: its modules, the bundle they become, what that bundle pulls in
const LIB = ['audio.js', 'core.js', 'plan.js', 'cache.js', 'store.js', 'checkpoint.js', 'stats.js', 'batch.js', 'worker.js', 'deck.js', 'fn/', '.esbuild.js', 'package-lock.json']
// the website as served: its pages, their scripts and the bundles .site-build.js makes
const SITE = ['index.html', 'logo/', 'assets/', '.site-build.js', 'package-lock.json']

// The playground's suites, a test file each (test/playground/), and the modules it is about: a change to one of those
// runs the suites it is of alone; to any other file of the playground (the boot, its context, the view's model, code.js,
// the engine, and what the tests' helpers drive: the menus, the commands, the keys, the looks, the script editor, the
// edits' panel), every one
const FEATURES = {
  engine: ['playground/meters.js', 'playground/scrub.js', 'playground/scrub-methods.js', 'playground/sources.js', 'playground/heard.js', 'playground/jobs.js', 'playground/voices.js'],
  code: ['playground/help.js', 'playground/icons.js', 'playground/time.js', 'playground/doing.js', 'playground/markdown.js', 'playground/recipes.js', 'bin/'],
  run: ['playground/editor/run.js', 'playground/view/data.js', 'playground/sw.js'],
  look: ['playground/theme.js', 'playground/tint.js', 'playground/themes/', 'playground/themes.html', 'playground/skin.css', 'playground/scale.js'],
  menus: ['playground/hint.js', 'desktop/app.js'],
  edits: ['playground/editor/edits.js', 'playground/recipes.js'],
  writers: ['playground/editor/writers.js', 'playground/view/gestures.js'],
  pitch: ['playground/view/notes.js', 'playground/editor/writers.js'],
  markers: ['playground/view/strips.js', 'playground/editor/writers.js'],
  select: ['playground/view/select.js', 'playground/view/pointer.js', 'playground/view/gestures.js', 'playground/view/overlay.js'],
  ruler: ['playground/view/ruler.js'],
  zoom: ['playground/view/scales.js'],
  render: ['playground/view/render.js', 'playground/view/overlay.js'],
  readouts: ['playground/editor/readouts.js', 'playground/meters.js', 'playground/heard.js'],
  play: ['playground/editor/play.js', 'playground/player.js', 'playground/scrub.js', 'playground/scrub-methods.js'],
  recording: ['playground/editor/recording.js', 'playground/sources.js', 'playground/keep.js'],
  tracks: ['playground/editor/tracks.js', 'playground/view/geometry.js'],
  files: ['playground/editor/files.js', 'playground/keep.js', 'playground/kept.js', 'playground/samples.js', 'playground/jobs.js'],
  tabs: ['playground/editor/tabs.js', 'playground/editor/persist.js'],
  clipboard: ['playground/editor/clipboard.js'],
  agent: ['playground/editor/tools.js', 'playground/editor/chat.js', 'playground/agent.js', 'playground/doing.js', 'playground/markdown.js', 'bin/'],
  layout: ['playground/editor.css'],
  embed: ['playground/embed.js']
}
// what every playground suite loads: the site, the playground, the library's worker and deck, the tests' page and fixtures
const PLAYGROUND = [...SITE, 'playground/', 'worker.js', 'deck.js', 'fn/curves.js', 'test/playground/page.js', 'test/gen.js', 'test/fixture.wav']
const OWNED = [...new Set(Object.values(FEATURES).flat())]

// advice: on a shared runner the audio thread misses deadlines now and then, so these report and don't fail the run
// `off`: files under `on` that don't reach it
const SUITES = [
  // the library's own suite on a page, against dist/audio.js
  { name: 'library', run: 'TEST_PAGES=library node test/browser.js', on: [...LIB, 'test/index.js', 'test/test.html', 'test/browser.js'] },
  // its resources released and its heap bounded, on a bare page and on the demo
  { name: 'memory', run: 'npm run test:memory', on: [...LIB, ...SITE, 'test/memory.test.js', 'test/memory-core.test.js'] },
  // the editor, a feature a suite: its engine against the library in Node, its code against the CLI
  ...Object.entries(FEATURES).map(([name, own]) => ({ name: `playground ${name}`, run: `node --test test/playground/${name}.test.js`, on: [...PLAYGROUND, ...own, `test/playground/${name}.test.js`], off: OWNED.filter(p => !own.includes(p)) })),
  // what a visitor sees first, as test/live.js checks the deployed site after each deploy: here, before one
  { name: 'live', run: 'node test/live.js --local', on: [...SITE, 'playground/', '.site-serve.js', 'test/live.js'] },
  { name: 'recording', run: 'CI= node --test --test-name-pattern="recording with the spectrogram shown" test/playground/recording.test.js', advice: true, on: ['playground/', 'test/playground/page.js', 'test/playground/recording.test.js'] },
  // real-time playback, clicks and gaps measured as heard
  { name: 'playback', run: 'TEST_PAGES=playback node test/browser.js', advice: true, on: [...LIB, 'test/play.html', 'test/play.js', 'test/browser.js'] },
]
const ALL = ['test/scope.js', '.github/workflows/browser.yml']

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean)
const known = sha => { try { return git('cat-file', '-e', `${sha}^{commit}`), true } catch { return false } }

const [base, head = 'HEAD'] = process.argv.slice(2)
const changed = base === undefined ? [...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')]
  : known(base) ? git('diff', '--name-only', base, head) : null
const under = (file, paths) => paths.some(p => p.endsWith('/') ? file.startsWith(p) : file === p)
const hit = (on, off = []) => changed.some(file => under(file, on) && !under(file, off))
const picked = !changed || hit(ALL) ? SUITES : SUITES.filter(s => hit(s.on, s.off))

console.log(JSON.stringify(picked.map(({ name, run, advice = false }) => ({ name, run, advice }))))
