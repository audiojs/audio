# Worker engine — off-main-thread render (design)

Status: **P1 shipped 2026-07** (`audio/worker` + `audio/worker-host`, test/fix-worker.js — facade≡local bit-exact oracle, cross-facade refs, streams, pushables) · P2 curves + P3 playback pending · answers todo.md "webworker mode - any meaning, no?" → yes

P1 deltas from the sketch below: op methods proxied against the worker's live registry (no facade op list at all); ops are fire-and-forget chainable with `'error'` event + strict `run()`; the facade/thenable must never be the resolution value of internal promises (thenable adoption deadlocks on never-decoding pushables — see worker.js comments).

## Why

All DSP runs on the calling thread today (fn/play.js drives the full op pipeline in the
same loop that feeds the speaker). Every on-concept op added (compressor, denoise,
declick) raises the odds that a chain misses the ~23ms/block real-time budget and the UI
jank compounds. The README promises "realtime editing" of "10Gb+ files" — that needs a
thread story, decided before 20 more ops assume main-thread execution.

## The unlock: edits are already the protocol

The plan model makes the worker boundary nearly free. `a.edits` is serializable data
(`[type, opts][]`, `toJSON` proven), the plan compiles deterministically from it, and
`stream() ≡ read()` gives a cross-boundary test oracle. No new RPC design needed — the
edit list IS the wire format:

```
main thread                          worker
audio.worker('file.mp3')  ──open──▶  audio('file.mp3')     (decode, pages, cache, stats)
facade.gain(-3)           ──edit──▶  a.gain(-3)            (same edit tuple, postMessage)
facade.read(range)        ──req───▶  a.read(range)  ──transferable Float32Arrays──▶
facade.stat('loudness')   ──req───▶  a.stat(...)    ──structured clone──▶
'data'/'meter'/'change'   ◀──port──  emit(...)             (events forwarded)
```

The facade mirrors the instance API; `version`/`length`/`duration`/`channels` sync via
metadata messages. Undo = pop edit both sides.

## Playback

- **Browser**: worker renders blocks into a `SharedArrayBuffer` ring; an `AudioWorklet`
  consumes it. Two hops off the main thread — UI can't glitch audio and audio can't jank UI.
  (SAB requires COOP/COEP headers — document; fall back to main-thread play() otherwise.)
- **Node**: `worker_threads` renders into the same ring layout; main thread pumps
  audio-speaker from it (speaker write is IO, not DSP — cheap).

## Bonus: OPFS gets *faster* in a worker

`createSyncAccessHandle` (synchronous OPFS IO) is worker-only. Moving the engine into a
worker turns cache.js's async page restore into sync reads — the page cache design
improves rather than compromises.

## Limitations (decided, documented)

- **Function params can't cross the boundary.** Automation `t => v` and `transform(fn)`
  stay main-thread-only, or serialize as breakpoint curves: `{t: Float32Array, v:
  Float32Array}` accepted wherever a fn is — engine samples curves exactly like fns
  (sub-block). Curve support is the P2 deliverable; it also fixes toJSON's fn-omission gap.
- **Instance refs (mix/insert sources)** transfer as their own serialized form
  (source + edits) — both sides materialize independently; raw-PCM sources transfer once.

## Phases

1. **P1 — offline offload**: `audio.worker(source)` facade with edits/read/stat/save/
   encode + events. No SAB needed (transferables only). Oracle: same fixture + edit chain,
   facade.read ≡ local read, bit-exact.
2. **P2 — curves**: breakpoint-curve params (main-side too — independent value).
3. **P3 — realtime**: SAB ring + AudioWorklet play(); node worker_threads variant.
   Latency budget: ring ≥ 4 blocks (~93ms) to start, tunable down.
4. **P4 — default**: `audio(src, {worker: true})` opt-in becomes the recommended path for
   heavy chains; main-thread stays the default (zero-setup, no COOP/COEP demands).

## Non-goals

Multiple workers per instance (one engine thread owns pages/cache); worker-side plugins
beyond what importScripts of fn/ modules gives for free.
