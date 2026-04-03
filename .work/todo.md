## Ideas

* [ ] Common processing scripts (vocal warmup etc)
* [ ] Increase page size to wavearea page size
* [ ] play params


## v2.2 Plugin Architecture Refactor

### Principles

1. **Core is a minimal audio container** — pages, sampleRate, channels, read from pages, `audio.run` for applying ops.
2. **Everything lives on `audio.*`** — `audio.op` (ops dict), `audio.stat` (stats dict), `audio.fn` (instance prototype, like `$.fn`), `audio.hook` (single-slot hooks), `audio.run` (op dispatch).
3. **`audio.use(...plugins)`** — each plugin receives `audio`, extends it however it needs. After all plugins run, `use()` wires `audio.op` entries to `audio.fn`.
4. **Plugins own their complexity** — history owns edit pipeline, duration-through-edits, plan/streaming. Stats own block accumulation. Cache owns OPFS/eviction. Ops are pure transforms.
5. **An op is just `(chs, ctx) => chs`** — not a factory. Args come in `ctx.args`. No `.dur`, `.plan`, `.ch`. Output IS the new length/channels.
6. **`audio.run` is the dispatch** — core's default applies ops destructively (flatten → run → repaginate). History replaces it to push edits instead. Not a hook — a method on `audio`.
7. **Hooks are single-slot, manually chainable** — plugin authors chain the previous hook themselves: `let prev = audio.hook.X; audio.hook.X = (...a) => { myStuff(); return prev?.(...a) }`.
8. **trim/normalize are fn methods, not ops** — they read stats and call `this.crop()`/`this.gain()`. They live in `fn/` but register on `audio.fn`, not `audio.op`.
9. **Options object for range + extras** — last arg is opts object: `a.gain(-3, { at: 1, dur: 2 })`. No `.args` metadata. No positional ambiguity. Extra op options (e.g. `{ curve: 'exp' }`) go in the same object.

### Op contract

```js
// NOT a factory. Args in ctx.args. Flat function.
audio.op.gain = (chs, ctx) => {
  let f = 10 ** (ctx.args[0] / 20)
  return chs.map(ch => {
    let o = new Float32Array(ch)
    for (let i = 0; i < o.length; i++) o[i] *= f
    return o
  })
}

// ctx shape:
// { args, at, dur, sampleRate, render, state?, ...extraOpts }
//
// args       — positional op parameters: a.gain(-3) → ctx.args = [-3]
// at         — start position in seconds (undefined = start)
// dur        — range in seconds (undefined = to end)
// sampleRate — Hz
// render     — fn to materialize audio sources (for insert/mix).
//              Core provides flattenPages. History provides its render engine.
// state      — optional object for inter-block state during streaming render.
//              History's streaming renderer creates it; op reads/writes it.
//              Not used in destructive mode (whole-buffer, single call).
// ...extra   — op-specific options (e.g. curve for fade)
```

### User API + arg splitting

Last arg is opts object → range + extras. Everything before = op args. No `.args` metadata needed.

```js
a.gain(-3)                         // whole audio
a.gain(-3, { at: 1, dur: 2 })     // range
a.crop({ at: 1, dur: 2 })         // no op args, just range
a.fade(0.5)                        // fade in 0.5s
a.fade(-0.5, { curve: 'exp' })    // fade out, exponential
a.fade(0.5, { at: 2, curve: 'cos' })  // fade in at 2s, cosine
a.insert(src, { at: 1 })          // insert at 1s
```

The fn wrapper:
```js
audio.fn[name] = function(...a) {
  let opts = a.length && typeof a[a.length - 1] === 'object'
    && !(a[a.length - 1] instanceof Float32Array) ? a.pop() : {}
  return audio.run.call(this, name, a, opts)
}
```

### Serialization

Edits serialize naturally — self-documenting, no positional ambiguity:
```js
{ type: 'gain', args: [-3], at: 1, dur: 2 }
{ type: 'fade', args: [0.5], curve: 'exp' }
{ type: 'insert', args: [srcRef], at: 1 }
```

### Plugin contract

```js
// Every plugin receives audio, extends it
export default (audio) => {
  audio.op.crop = ...      // op dict
  audio.fn.play = ...      // instance prototype (= $.fn)
  audio.stat.energy = ...  // stat dict
  audio.hook.create = ...  // single-slot hook (chain prev manually)
}
```

### What lives on `audio.*`

```js
audio.fn       // instance prototype (like $.fn)
audio.op       // op dict — wired to fn by use()
audio.stat     // stat dict
audio.hook     // single-slot hooks (chain prev manually)
audio.run      // op dispatch — history replaces
audio.use()    // plugin registration
audio.from()   // sync entry
```

No separate exports. Plugins receive `audio`, access everything via `audio.*`.

### What core does NOT contain (moved to plugins)

| Concern | Currently | Becomes |
|---------|-----------|---------|
| Edit history | `pushEdit`, `edits`, `version`, `onchange` in core | `history.js` — replaces `audio.run` |
| Undo/apply | `undo()`, `apply()` on fn | Part of history plugin |
| Render engine | `render()`, `buildPlan`, `streamPlan` | Part of history plugin |
| Op duration/ch hints | `.dur`, `.plan`, `.ch` on ops | History tracks duration/channels eagerly via `audio.run` |
| Stats accumulation | `statFields`, `statSession`, `buildStats` | `stats.js` plugin |
| Stats query methods | `db()`, `rms()`, `loudness()`, `peaks()` | Plain fn methods added by their own plugins |
| Page cache | `evict`, `restorePages`, `opfsCache` | `cache.js` plugin |
| Cursor prefetch | `cursor` setter | Part of cache plugin |
| Serialization | `toJSON()` | Part of history plugin |

### `audio.run` — the dispatch

Core's default applies ops destructively. History replaces it for non-destructive editing. Called via `.call(this, ...)` from fn wrappers.

```js
// core default — destructive, applies immediately
audio.run = function(name, args, opts) {
  let pcm = flattenPages(this)
  let result = audio.op[name](pcm, {
    ...opts, args, sampleRate: this.sampleRate,
    render: (src) => flattenPages(src)
  })
  this.pages = paginate(result)
  this._.len = result[0].length
  this._.ch = result.length
  return this
}

// history replacement — non-destructive, defers to render time
export default (audio) => {
  audio.run = function(name, args, opts) {
    this.edits.push({ type: name, args, ...opts })
    this._.len = computeLen(this)   // eagerly maintained
    this._.ch = computeCh(this)
    this.version++
    this.onchange?.()
    return this
  }
  // history knows structural ops change length:
  // crop = dur opt, remove = subtract, insert = add, repeat = multiply
  // sample ops = same length. Unknown ops = fall back to render.
  // At render time, history provides its own render fn in ctx for insert/mix.
}
```

`duration`/`channels` getters stay simple forever: `this._.len / this.sampleRate`. Both core and history maintain `_.len`/`_.ch` eagerly in `audio.run`. No getter redefinition needed.

### Hooks (single-slot, manually chainable)

```js
audio.hook.create    // (instance) => void — init plugin state on new instance
```

Plugins that set a hook must chain the previous one:
```js
let prev = audio.hook.create
audio.hook.create = (inst) => { prev?.(inst); inst.myState = {} }
```

For `read`/`stream` — plugins wrap `audio.fn` methods (middleware pattern). Order of `audio.use()` = order of wrapping.

### Core (after refactor)

```js
// core.js — ~100 lines
export default async function audio(source, opts) { ... }
audio.from = function(source, opts) { ... }

audio.op = {}
audio.stat = {}
audio.hook = { create: null }

// default destructive dispatch — history replaces
audio.run = function(name, args, opts) {
  let pcm = flattenPages(this)
  let result = audio.op[name](pcm, { ...opts, args, sampleRate: this.sampleRate, render: flattenPages })
  this.pages = paginate(result)
  this._.len = result[0].length
  this._.ch = result.length
  return this
}

audio.use = function(...plugins) {
  for (let p of plugins) p(audio)
  // wire fn from op dict
  for (let [name, op] of Object.entries(audio.op)) {
    if (audio.fn[name]) continue
    audio.fn[name] = function(...a) {
      let opts = a.length && typeof a[a.length - 1] === 'object'
        && !(a[a.length - 1] instanceof Float32Array) ? a.pop() : {}
      return audio.run.call(this, name, a, opts)
    }
  }
}

function create(pages, sampleRate, ch, length, opts) { ... }

audio.fn = {
  get duration() { return this._.len / this.sampleRate },
  get channels() { return this._.ch },
  get length() { return this._.len },
  async read(offset, duration) { return readPages(this, offset, duration) },
}
```

### Bundles

```js
// audio.js — full bundle (current default)
import audio from './core.js'
import history from './history.js'
import cache from './cache.js'
import stats from './stats.js'
import crop from './fn/crop.js'
import gain from './fn/gain.js'
import trim from './fn/trim.js'
import normalize from './fn/normalize.js'
// ... all ops, stats, methods
audio.use(history, cache, stats, crop, gain, trim, normalize, ...)
export default audio

// audio-mini.js — destructive, no history, no cache
import audio from './core.js'
import crop from './fn/crop.js'
import gain from './fn/gain.js'
audio.use(crop, gain)
export default audio
```

### File structure (after)

```
core.js          — audio container, audio.fn, audio.run, audio.use(), create, PAGE_SIZE, BLOCK_SIZE
decode.js        — decode engine (accepts onpage callback for stats)
history.js       — replaces audio.run, edit pipeline, undo, render, plan utilities, streaming, toJSON
cache.js         — OPFS paging, eviction, restore, cursor prefetch
stats.js         — block accumulation, stat session, rebuild
fn/
  crop.js        — op: (chs, ctx) => chs
  gain.js        — op: (chs, ctx) => chs
  fade.js
  insert.js
  remove.js
  repeat.js
  reverse.js
  mix.js
  write.js
  remix.js
  trim.js        — fn method (reads stats, calls this.crop())
  normalize.js   — fn method (reads stats, calls this.gain())
  min.js         — block stat
  max.js         — block stat
  energy.js      — block stat (K-weighted)
  db.js          — fn method (reads stats.min/max)
  rms.js         — fn method (reads stats.energy)
  loudness.js    — fn method (reads stats.energy)
  peaks.js       — fn method (reads stats.min/max)
  play.js
  save.js
  view.js
  split.js
  concat.js
```

---

### Phases

#### [x] Phase 1: Plugin architecture + merge dirs

- [x] Merge `op/` and `stat/` into `fn/`
- [x] Add `audio.fn` (proto), `audio.hook`, `audio.run`, `audio.use()` to core
- [x] `audio.op()` / `audio.stat()` remain as registration functions
- [x] Rewrite all 27 fn/ modules as `(audio) => { ... }` plugins
- [x] `audio.js` uses `audio.use(history, ...plugins)` 
- [x] Removed `audio.fn_register` (dead code)

Note: factory flattening and opts object pattern deferred — separate concern from plugin architecture.

#### [x] Phase 2: Extract history plugin

- [x] Created `history.js` — replaces `audio.run` with edit-pushing version
- [x] History overrides `length`/`channels` getters to walk edits via `.dur`/`.ch` hints
- [x] History wraps `audio.fn.read` and `audio.fn.stream` to apply edits via plan/render
- [x] History wraps `audio.fn.query` to rebuild stats when dirty
- [x] History adds `toJSON()` to proto
- [x] Core's `read` = direct page read (no edits)
- [x] Core's `length`/`duration` = source length (no edit walking)
- [x] `hook.create` called on every instance creation
- [x] `audio.op()` wires proto immediately (custom ops work outside `use()`)

Not extracted (deferred):
- `plan.js` not absorbed into history — still standalone (shared constants)
- `render.js` stays standalone — history imports from it
- `undo()` / `apply()` still in fn/ as plugins — they manipulate edits directly

#### Deferred: Cache + Stats extraction

Cache (`cache.js`) and stats (`stats.js`) are already modular standalone files but deeply coupled to core's creation/decode pipeline. Extracting them into plugins would require:
- Cache: hooking into `audio()`, `create()`, `read()`, `stream()`, `cursor` — too many touch points
- Stats: changing decode API to accept onpage callback — breaks existing contract

Both are already clean separation-of-concerns at the file level. Plugin extraction deferred until there's a concrete use case (e.g., someone wanting `audio` without stats or without OPFS).

#### Phase 3: Documentation + types

- [ ] Update research.md — architecture section
- [ ] Update .work/todo.md — clean up plan to match reality


---


## [x] v2.1 Refactoring Plan (completed)

### Phase 1: Internal naming + props consolidation

No public API changes. Tests keep passing throughout.

#### 1a. Consolidate internal props into `a._`

Current (8 underscore props + `numberOfChannels`):
```
a.numberOfChannels, a._len, a._cache, a._cacheVer,
a._lenCached, a._lenVer, a._chCached, a._chVer, a._cursor
```

After (1 object):
```js
a._ = { ch, len, cache: null, cacheV: -1, lenV: -1, chV: -1, cursor: 0 }
```

- [x] Update `create()` — single `_` object
- [x] Update getters: `length`, `duration`, `channels`, `cursor`
- [x] Update `render()`, `rebuildStats()`, `pushEdit()`
- [x] Update `audio.from(instance)` — copy reads `source._.ch`, `source._.len`
- [x] Update `toJSON()` — uses `this._.ch`
- [x] Verify tests pass


#### 1b. Unify function naming — `verb + object`, no abbreviations

| Current | New | Reason |
|---------|-----|--------|
| `resolve` | `resolveSource` | ambiguous without context |
| `decodeBuf` | `decodeSource` | decodes a source, not just a buf |
| `decodeInWorker` | `workerDecode` | shorter |
| `toPages` | `paginate` | verb |
| `indexChunk` | `indexBlock` | works per-block |
| `buildIndex` | `buildStats` | becoming stats |
| `pageBytes` | inline | 2-line utility, just inline it |
| `evictToFit` | `evict` | shorter |
| `ensurePages` | `restorePages` | what it actually does |
| `refreshIndex` + `rebuildIndexStreaming` | `rebuildStats` | merge into one, picks strategy |
| `renderCached` | `render` | caching is impl detail |
| `planChunks` | `streamPlan` | yields chunks from a plan |
| `chunksFromPcm` | `streamPcm` | same pattern as above |
| `estimateDecodedSize` | `estimateSize` | shorter |
| `playAudio` | `startPlayback` | more precise |

- [x] Rename all functions in core.js
- [x] Update worker.js import (`decodeBuf` → `decodeSource`)
- [x] Update audio.js export (`decodeBuf` → `decodeSource`)
- [x] Verify tests pass


#### 1c. Simplify decode pipeline

`decodeSource` currently has 6 nested functions (`init`, `indexPage`, `emitDelta`, `pushChunk`, plus inline logic for format detection, page assembly, index building).

- [x] Flatten nested functions — make top-level or inline
- [x] Separate concerns: format detection, chunked feed, page assembly, stat building
- [x] Remove redundant variables (pageBuf/pagePos can be loop-local)
- [x] Verify tests pass


#### 1d. Size guard on `render()`

`new Float32Array(totalLen)` crashes if totalLen > ~2^30. Streaming render avoids this.

- [x] Add `MAX_FLAT_SIZE = 2 ** 29` constant (~500M samples, safe margin)
- [x] In `render()`: if totalLen > MAX_FLAT_SIZE, prefer streaming plan
- [x] If no plan available (inline fns), throw clear error with guidance
- [x] Verify tests pass

---

### Phase 2: Public API renames

Tests updated in this phase.

#### 2a. `audio.index()` → `audio.stat()`

Registration method rename. Factory pattern (like ops):
```js
audio.stat('energy', () => {
  let kState = null
  return (channels, ctx) => { /* K-weight, compute mean square */ }
})
```

Stateless stats use trivial factory:
```js
audio.stat('min', () => (channels) => channels.map(ch => {
  let mn = Infinity
  for (let i = 0; i < ch.length; i++) if (ch[i] < mn) mn = ch[i]
  return mn
}))
```

- [x] Rename `audio.index` → `audio.stat` in core.js
- [x] Rename `indexFields` → `statFields` (or `stats`)
- [x] Update factory pattern: init() returns block function (like ops)
- [x] Update decode loop to call factories, carry state per-decode
- [x] Update tests — `audio.index()` calls → `audio.stat()`
- [x] Verify tests pass


#### 2b. `a.index` → `a.stats`

Property rename on all instances.

- [x] `a.index` → `a.stats` in `create()`, all stat/analysis code
- [x] Update `trim.resolve`, `normalize.resolve` — read `ctx.stats`
- [x] Update `buildPlan` — passes `a.stats` in resolve context
- [x] Update `rebuildStats` — sets `a.stats`
- [x] Update tests — `a.index.*` → `a.stats.*`
- [x] Verify tests pass


#### 2c. Strip "document" everywhere

- [x] `package.json` description → "Audio loading, editing, and rendering for JavaScript"
- [x] `core.js` header → "audio core — paged audio engine"
- [x] `audio.d.ts` → "Audio instance" not "Audio document"
- [x] README → strip "document" qualifier, just "audio"
- [x] research.md → same


---


### Phase 3: Extract stats to `stat/`

Core becomes stat-agnostic. `audio.js` registers everything.

#### 3a. Create stat files

```
stat/
  min.js          Block stat — per-block minimum amplitude
  max.js          Block stat — per-block maximum amplitude
  energy.js       Block stat — K-weighted mean square (stateful filter)
  db.js           Method — peak level in dBFS (from stats.min/max)
  rms.js          Method — root mean square (from stats.energy)
  loudness.js     Method — integrated LUFS, BS.1770 (from stats.energy)
  waveform.js     Method — downsampled min/max for display
```

- [x] Extract min block computation → `stat/min.js`
- [x] Extract max block computation → `stat/max.js`
- [x] Extract K-weighted energy → `stat/energy.js` (stateful factory)
- [x] Write `stat/db.js` — peak dBFS from stats.min/max
- [x] Write `stat/rms.js` — RMS from stats.energy
- [x] Write `stat/loudness.js` — gated LUFS from stats.energy
- [x] Write `stat/peaks.js` — downsample stats.min/max


#### 3b. Core decode loop becomes pluggable

Core hardcodes nothing. During decode, iterates registered stat functions.

- [x] Remove hardcoded min/max/energy computation from decode loop
- [x] Decode loop calls registered stat factories, one per block
- [x] Stats initialized fresh per decode session (factory provides clean state)
- [x] `buildStats()` uses same registered functions for PCM → stats


#### 3c. `audio.js` registers all built-in stats + methods

```js
import audio, { proto } from './core.js'

// block stats (computed during decode)
import min from './stat/min.js'
import max from './stat/max.js'
import energy from './stat/energy.js'
audio.stat('min', min)
audio.stat('max', max)
audio.stat('energy', energy)

// methods (computed from stats on demand)
import db from './stat/db.js'
import rms from './stat/rms.js'
import loudness from './stat/loudness.js'
import waveform from './stat/waveform.js'
proto.db = db
proto.rms = rms
proto.loudness = loudness
proto.waveform = waveform
```

- [x] Update audio.js with all registrations
- [x] Verify `audio/core` import has no stats (bare engine)
- [x] Verify `audio` import has all stats + methods


#### 3d. Update exports

- [x] `audio/stat/*` importable individually
- [x] `package.json` exports: `"./stat/*": "./stat/*"`
- [ ] Verify tree-shaking: `audio/core` + cherry-picked stats works (deferred)


---


### Phase 4: Break `stat()` method into individual methods

Remove `a.stat()`. Replace with focused methods registered in Phase 3.

| Method | Returns | Source data |
|--------|---------|-------------|
| `await a.db(off?, dur?)` | Peak dBFS (number) | stats.min + stats.max |
| `await a.rms(off?, dur?)` | RMS level (number) | stats.energy |
| `await a.loudness(off?, dur?)` | Integrated LUFS (number) | stats.energy + BS.1770 gating |
| `await a.waveform(count, opts?)` | `{min, max}` Float32Arrays | stats.min + stats.max |

- [x] Remove `stat()` and `peaks()` from proto in core.js
- [x] Each method: rebuild stats if dirty, then compute from `a.stats`
- [x] Update CLI `--stat` to call `a.db()`, `a.rms()`, `a.loudness()`
- [x] Update `normalize.resolve` — uses `a.stats` directly (no change)
- [x] Update `trim.resolve` — uses `a.stats` directly (no change)
- [x] Update tests — `a.stat()` → individual methods, `a.peaks()` → `a.peaks()`
- [x] Update d.ts — new method signatures, remove `stat()`, add `db/rms/loudness/peaks`


---


### Phase 5: Documentation

- [x] README: reflect all API changes, update architecture diagram
- [x] `audio.d.ts`: all new types, methods, remove old
- [x] `research.md`: update API section, architecture, plugin contract
- [x] `package.json`: description, exports


---


### Execution order + dependencies

```
Phase 1a (props)  ─┐
Phase 1b (names)  ─┼─ independent, can parallelize
Phase 1c (decode) ─┤
Phase 1d (guard)  ─┘
        │
Phase 2a,2b,2c (API renames)
        │
Phase 3a,3b,3c,3d (extract stats)
        │
Phase 4 (break stat into methods)
        │
Phase 5 (docs)
```

Each phase ends with all tests green.


---


## Known defects

- [ ] `record` — not implemented
- [x] K-weighted energy extracted to `stat/energy.js` (Phase 3)
- [x] `render()` size guard — streams for >500M samples (Phase 1d)
- [x] normalize.resolve was dead code — fixed (.plan/.resolve on init fn)
- [x] rebuildStats version-guarded — no triple rebuild on sequential queries
- [x] Stat methods decoupled from `_.ch` — use `ch` from `_range`
- [x] `concat` redundant branch removed
- [x] `render` passed directly, no wrapper closure
- [x] CLI "document" language stripped


## v2.1+ Features (post-refactor)

- [ ] Plugin auto-discovery: scan `node_modules/audio-*` at CLI startup
- [ ] Macro system: `--macro recipe.json` applies serialized edit list
- [ ] Batch CLI: process multiple files with same edits
- [ ] Per-op help: `audio gain --help`
- [ ] In-place pipeline mutation for memory efficiency
- [ ] Index delta-tracking through edits (avoid stale rebuild for gain→trim chains)
- [ ] Structural custom ops (variable-length output)
- [ ] Wavearea integration


## Archive

### Done (v2.0 cleanup sprint)

- [x] Extract plan utilities to `op/plan.js` — ops no longer import from core
- [x] `ctx.render` for insert/mix — decoupled from `renderCached` import
- [x] Inline remix logic — dropped `audio-buffer` dependency
- [x] `Object.create(null)` for ops and indexFields
- [x] `.resolve` pattern for trim/normalize — avoids full render via index
- [x] Normalize presets: `'streaming'`, `'podcast'`, `'broadcast'`
- [x] Deduplicated LUFS constants (single source in normalize.js)
- [x] Removed `audio.LUFS_*` from public API
- [x] Renamed `.do()` → `.apply()`
- [x] Added `audio.concat(...sources)` — inverse of split
- [x] CLI: `--play`, `--stat`, `--force`, overwrite warning
- [x] Deleted `.travis.yml`, `.eslintrc.json`
- [x] 144 tests passing (115 lib + 29 CLI)


### v2.0 Release ✓

Built: complete CLI, browser Web Audio playback, OPFS paging, streaming render with plan-based pipeline, .resolve pattern for smart ops, pluggable op system.

144 tests passing (115 library + 29 CLI).

Phases 1–11 completed. See git history for details.


## Exhaustive Feature Roadmap

### Tier 2: Competitive

**Separate Packages** (plugins via `audio.op()`)

| Package | Purpose | Type |
|---------|---------|------|
| `audio-spectrum` | Frequency-domain analysis, FFT | Analysis plugin |
| `audio-stretch` | Pitch/time stretch | Structural op |
| `audio-gate` | Noise gate | Sample op |
| `audio-eq` | Parametric EQ | Sample op |
| `audio-compress` | Dynamic range compression | Sample op |
| `audio-reverb` | Reverb | Sample op |
| `audio-declick` | Click/pop removal | Sample op |
| `audio-denoise` | Noise reduction | Sample op |

All streamable with current op contract (stateful closures).


### Tier 3: Delighting

| Package | Purpose |
|---------|---------|
| `audio-spectral-edit` | Frequency-domain selection/edit |
| `audio-stem-separate` | Vocal/instrumental separation (ML) |
| `audio-pitch-correct` | Auto-tune |
| `audio-transient-shaper` | Transient enhancement |
