# audio v2 — Implementation Plan

## Phase 1: Foundation — data model + create + properties

Clean repo. Fresh ESM package. The Audio class with pages, index, edits.

- [x] Remove old v1 code (index.js, src/*.js, old deps, old tests)
- [x] package.json: ESM, `"type": "module"`, deps on audio-decode/encode
- [x] Audio class: `pages`, `index`, `edits`, `sampleRate`, `channels`, `version`
- [x] `audio.from(data, opts?)` — sync. Accepts Float32Array[], AudioBuffer, number (silence). Builds pages + index from PCM. Always resident.
- [x] `audio(source, opts?)` — async. Detects input: encoded → decode via audio-decode, PCM → wraps immediately. Returns Promise always.
- [x] Index computation during page creation: min/max/energy per block per channel at blockSize=1024
- [x] Properties: `duration`, `channels`, `sampleRate` (read-only)
- [x] `edits` array (inspectable, readonly), `version` counter, `onchange` callback
- [x] Tests: create from PCM, create from silence, create from file, URL, ArrayBuffer, AudioBuffer, properties correct, index populated

**Gate:** `await audio('test.wav')` works. `.duration`, `.channels`, `.sampleRate` correct. Index computed. ✓


## Phase 2: Streaming decode + onprogress

Progressive decoding with append-only index deltas.

- [x] Decode for encoded sources via audio-decode, build pages + index
- [x] `onprogress({ delta, offset, total })` — append-only delta: fromBlock, per-channel min/max/energy
- [x] Index grows incrementally as pages are processed
- [x] Tests: onprogress fires with correct delta shape, delta covers full index

**Gate:** `await audio('large.mp3', { onprogress })` streams index deltas progressively. ✓

Note: Current decode is synchronous (full decode then page-by-page index). True worker-based streaming decode deferred — architecture supports it via onprogress contract.


## Phase 3: Structural ops

Edit list + ops that reorganize the timeline.

- [x] Op representation: `{ type, args }` in `edits`
- [x] `slice(offset, duration)` → new Audio sharing source pages
- [x] `insert(other, offset?)` — splice pages into timeline
- [x] `remove(offset, duration)` — exclude range from timeline
- [x] `pad(duration, {side})` — insert silence pages
- [x] `repeat(times)` — multiply timeline references
- [x] All return `this` (except slice → new Audio)
- [x] `undo()` / `redo()` — move between edits and redo stack. New edit after undo clears redo.
- [x] `version` increments, `onchange` fires on edit/undo/redo
- [x] Tests: each op queued, each op materialized correctly, chaining, undo/redo cycles, version tracking, slice independence, pad start/end, structural + sample chained

**Gate:** `a.remove(1, 2).insert(b, 3).pad(0.5)` chains and materializes correctly. Undo/redo works. ✓


## Phase 4: Sample ops

Block-level transforms with range support.

- [x] `gain(db, offset?, duration?)`
- [x] `fade(duration)` — position-dependent
- [x] `reverse(offset?, duration?)`
- [x] `mix(other, offset?, duration?)`
- [x] `write(data, offset?)`
- [x] Range filtering: engine applies op only to blocks within offset..offset+duration
- [x] Tests: each op, gain with range (before/in/after), fade in/out, reverse values, mix sum, write overwrite

**Gate:** `a.gain(-3, 2, 1).fade(.5).reverse()` queues and materializes correctly. ✓


## Phase 5: Smart ops + audio.define

- [x] `trim(threshold?)` — scan index for silence, refine at sample level in boundary pages, queue slice()
- [x] `normalize(targetDb?)` — read max(index.max), queue gain()
- [x] `audio.define(name, opts?, fn)` — register custom sample op
  - opts: `{ args: 0|1, index: true|false }`
  - Validates name, reserves built-ins, adds chainable method
- [x] Tests: trim sample-level accuracy, normalize target, define + use custom op, custom op with args, custom op with range, duplicate throws, toJSON serialization

**Gate:** `a.trim().normalize()` correct. `audio.define('invert', fn); a.invert(2, 1)` works. ✓


## Phase 6: Materialization — read, encode, save

Output pipeline: pages + ops → PCM / bytes / file.

- [x] Materialization engine: build output timeline from structural ops → iterate, load pages, apply sample ops
- [x] `read(offset?, duration?)` → Float32Array[] (copies)
- [x] `read(offset, duration, { format })` → format conversion for int16/uint8
- [x] `encode(format)` → Uint8Array via audio-encode
- [x] `save(target)` — Node: fs.writeFile(path)
- [x] `toJSON()` — serialize edits
- [x] Tests: read full (lena), read sub-range, read with format, read returns copies, encode/decode round-trip, save + reload, toJSON

**Gate:** `a.gain(-3).trim().read()` returns correct PCM. `save('/tmp/out.wav')` works. ✓


## Phase 7: Analysis from index

- [x] `limits(offset?, duration?)` → `{min, max}` from index, collapsed
- [x] `loudness(offset?, duration?)` → LUFS from index.energy (400ms windows + BS.1770 gating)
- [x] `peaks(count)` → `{min, max}` downsampled from index, collapsed. Per-channel via `{ channel }` option.
- [x] Index-dirty detection: walk edits, compute stale block ranges from dirty ops
- [x] Stale → materialize + reindex affected blocks only (range-scoped)
- [x] Tests: limits sine wave, limits with range, peaks count + type, peaks per-channel, loudness synthetic + lena, dirty op reindexes

**Gate:** Analysis instant from index. Dirty op reindexes correctly. ✓


## Phase 8: Playback

- [x] `play(offset?, duration?, opts?)` → PlaybackController
- [x] Controller: `pause()`, `stop()`, `currentTime`, `playing`, `ontimeupdate`, `onended`
- [x] Parallel by default: multiple controllers from same Audio
- [ ] Browser: AudioBufferSourceNode, windowed buffer, 15ms click-free fades
- [x] Node: audio-speaker (lazy-loaded)
- [x] Tests: play returns controller with all methods, parallel controllers are distinct

**Gate:** Two controllers created simultaneously. Stop one, other independent. ✓

Note: Browser WAA backend deferred — Node playback via audio-speaker works. Browser needs AudioContext integration.


## Phase 9: Streaming

- [x] `stream(offset?, duration?)` → AsyncIterableIterator yielding Float32Array[] per page
- [x] Ops applied during materialization
- [x] Tests: stream full, stream sub-range, stream after ops

**Gate:** `for await (let block of a.stream()) { ... }` yields correct blocks. ✓


## Phase 10: OPFS page cache

- [ ] Detect OPFS on `audio()` call
- [ ] `storage: 'auto'` (default): OPFS if available + file is large. Memory otherwise.
- [ ] `storage: 'persistent'` / `'memory'` explicit overrides
- [ ] Estimate decoded size → decide mode. Fail early if impossible.
- [ ] LRU eviction to OPFS when budget exceeded. Page-in on demand.
- [ ] Index never evicted.
- [ ] Tests: large file OPFS, eviction/page-in, fail-early, index survives

**Gate:** 2h+ file loads in browser. Pages evict/restore transparently.

Note: Architecture supports paging (pages have `data: null` for evicted state, index is separate). OPFS implementation requires browser environment — deferred to browser testing phase.


## Phase 11: Polish + publish

- [ ] JSDoc on all public methods → generate .d.ts
- [ ] Full test suite: tst
- [ ] README from research.md API section
- [ ] Verify wavearea integration end-to-end
- [ ] Publish v2.0.0
