// The browser suites a change can reach: node test/scope.js [base [head]] prints them as JSON, each with its command, for CI's
// matrix (.github/workflows/browser.yml). Without a base, the working tree against HEAD; a base git doesn't know
// (a new branch's all-zero one) or a change to this file or the workflow runs them all.
import { execFileSync } from 'node:child_process'

// the library as the pages load it: its modules, the bundle they become, what that bundle pulls in
const LIB = ['audio.js', 'core.js', 'plan.js', 'cache.js', 'store.js', 'checkpoint.js', 'stats.js', 'batch.js', 'worker.js', 'deck.js', 'fn/', '.esbuild.js', 'package-lock.json']
// the website as served: its pages, their scripts and the bundles .site-build.js makes
const SITE = ['index.html', 'logo/', 'assets/', '.site-build.js', 'package-lock.json']

// The repl's suites, a test file each (test/repl/), and the modules it is about: a change to one of those
// runs the suites it is of alone; to any other file of the repl (the boot, its context, the view's model, code.js,
// the engine, and what the tests' helpers drive: the menus, the commands, the keys, the looks, the script editor, the
// edits' panel), every one
const FEATURES = {
  engine: ['repl/meters.js', 'repl/scrub.js', 'repl/scrub-voice.js', 'repl/sources.js', 'repl/heard.js', 'repl/jobs.js', 'repl/voices.js'],
  code: ['repl/help.js', 'repl/icons.js', 'repl/time.js', 'repl/doing.js', 'repl/markdown.js', 'repl/recipes.js', 'bin/'],
  run: ['repl/editor/run.js', 'repl/view/data.js', 'repl/sw.js'],
  look: ['repl/theme.js', 'repl/tint.js', 'repl/themes/', 'repl/themes.html', 'repl/skin.css', 'repl/scale.js'],
  menus: ['repl/hint.js', 'desktop/app.js'],
  edits: ['repl/editor/edits.js', 'repl/recipes.js', 'repl/settings.js', 'repl/help.js'],
  writers: ['repl/editor/writers.js', 'repl/view/gestures.js'],
  pitch: ['repl/view/notes.js', 'repl/editor/writers.js'],
  markers: ['repl/view/strips.js', 'repl/editor/writers.js'],
  select: ['repl/view/select.js', 'repl/view/pointer.js', 'repl/view/gestures.js', 'repl/view/overlay.js'],
  drag: ['repl/view/pointer.js', 'repl/view/gestures.js', 'repl/view/scales.js', 'repl/view/overlay.js', 'repl/view/strips.js', 'repl/view/render.js', 'repl/editor/edits.js'],
  level: ['repl/view/strips.js', 'repl/view/overlay.js'],
  ruler: ['repl/view/ruler.js'],
  zoom: ['repl/view/scales.js'],
  render: ['repl/view/render.js', 'repl/view/overlay.js'],
  readouts: ['repl/editor/readouts.js', 'repl/meters.js', 'repl/heard.js'],
  play: ['repl/editor/play.js', 'repl/player.js', 'repl/scrub.js', 'repl/scrub-voice.js'],
  recording: ['repl/editor/recording.js', 'repl/sources.js', 'repl/keep.js'],
  tracks: ['repl/editor/tracks.js', 'repl/view/geometry.js'],
  files: ['repl/editor/files.js', 'repl/keep.js', 'repl/kept.js', 'repl/samples.js', 'repl/jobs.js'],
  tabs: ['repl/editor/tabs.js', 'repl/editor/persist.js'],
  clipboard: ['repl/editor/clipboard.js'],
  agent: ['repl/editor/tools.js', 'repl/editor/chat.js', 'repl/agent.js', 'repl/doing.js', 'repl/markdown.js', 'bin/'],
  layout: ['repl/editor.css'],
  embed: ['repl/embed.js'],
  'embed-edits': ['repl/embed.js', 'repl/settings.js', 'repl/samples.js', 'repl/editor/chain.js'],
  kind: ['repl/kind.js'],
  library: ['repl/library.js'],
  // the elements (elements/): the editor in parts, in a page of its own
  'audio-code': ['elements/'],
  'audio-sound': ['elements/'],
  'audio-picture': ['elements/'],
  'embed-sound': ['elements/', 'repl/embed.js', 'repl/editor/host.js']
}
// what every repl suite loads: the site, the repl, the library's worker and deck, the tests' page and fixtures
const REPL = [...SITE, 'repl/', 'worker.js', 'deck.js', 'fn/curves.js', 'test/repl/page.js', 'test/gen.js', 'test/fixture.wav']
const OWNED = [...new Set(Object.values(FEATURES).flat())]

// advice: on a shared runner the audio thread misses deadlines now and then, so these report and don't fail the run
// `off`: files under `on` that don't reach it
const SUITES = [
  // the library's own suite on a page, against dist/audio.js
  { name: 'library', run: 'TEST_PAGES=library node test/browser.js', on: [...LIB, 'test/index.js', 'test/test.html', 'test/browser.js'] },
  // its resources released and its heap bounded, on a bare page and on the demo
  { name: 'memory', run: 'npm run test:memory', on: [...LIB, ...SITE, 'test/memory.test.js', 'test/memory-core.test.js'] },
  // the editor, a feature a suite: its engine against the library in Node, its code against the CLI
  ...Object.entries(FEATURES).map(([name, own]) => ({ name: `repl ${name}`, run: `node --test test/repl/${name}.test.js`, on: [...REPL, ...own, `test/repl/${name}.test.js`], off: OWNED.filter(p => !own.includes(p)) })),
  // what a visitor sees first, as test/live.js checks the deployed site after each deploy: here, before one, on the site
  // as Pages gets it (the repl's page minified), the home's hero held to its first-load budget
  { name: 'live', run: 'node test/live.js --local', on: [...SITE, 'repl/', '.site-serve.js', 'test/live.js'] },
  { name: 'recording', run: 'CI= node --test --test-name-pattern="recording with the spectrogram shown|a take recorded as the others play" test/repl/recording.test.js', advice: true, on: ['repl/', 'test/repl/page.js', 'test/repl/recording.test.js'] },
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
