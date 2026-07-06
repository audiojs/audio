# audio-module — unified processor contract (design)

Status: designed 2026-07 · pilot pending · owner of todo.md "audio-module" section

## Problem

Four processor conventions coexist across the ecosystem, none interchangeable:

| convention | shape | lives in |
|---|---|---|
| audio-effect | `fn(data, params)` mutating, param-obj state | audio-effect |
| pitch-shift | `makePitchShift(batch, stream)` factory | pitch-shift |
| dynamics-processor | polymorphic `fn(data, opts)` + `{write, flush}` | dynamics-processor |
| audio op | `process(input, output, ctx)` per block | audio (plan.js) |

Every host (audio plan, AudioWorklet, VST wrapper, batch script) needs hand-written glue
per module. Each convention evolved for a reason (zero-alloc, ergonomics, overlap-add) —
the contract must cover all three via adapters or migration stalls (todo.md risk note).

## Contract

```js
export default {
  name: 'compressor',
  channels: 'any',            // or fixed N
  latency: 0,                 // samples of lookahead the host must compensate
  tail: 0,                    // samples the module keeps producing after input ends
  params: {
    threshold: { min: -60, max: 0, default: -24, unit: 'dB' },
    ratio:     { min: 1, max: 20, default: 4 },
    attack:    { min: 0.0001, max: 1, default: 0.003, unit: 's', smooth: 'ramp' },
  },
  create(sampleRate, channels, init) {
    // allocate all state here — flat typed arrays / scalars only
    return {
      process(input, output, n) {},   // Float32Array[] in/out, n samples; NEVER allocates
      set(name, value) {},            // param change; module dezips per its params.smooth
      reset() {},                     // clear state (seek), keep allocation
      serialize() {}, restore(s) {},  // optional — snapshot state (undo across render)
    }
  }
}
```

Narrowest target wins: this mirrors `AudioWorkletProcessor` (fixed create-time format,
per-quantum process, no allocation). Wider hosts adapt down, never up.

## The jz alignment — one discipline, two payoffs

The `create/process` body is written in the **jz subset** (numeric-pure JS: typed arrays,
scalars, loops, math — no promises, no host APIs, no dynamic object graphs in the hot
path). Consequences:

1. **It runs as plain JS everywhere today** — valid jz is valid JS. No build step required.
2. **It compiles to GC-free WASM with jz as an opt-in build**, per module, behind the same
   export. The JS source stays the reference implementation and the test oracle:
   differential CI asserts bit-exact JS↔wasm agreement (biquad-class kernels; tolerance
   band only where reductions reorder). jz is never a hard dependency — a jz version bump
   requires re-verification, not trust.

Rules that make a module jz-clean (enforced by a lint in the module template):
state in `Float32Array`/`Float64Array`/scalars closed over by `create` — no Maps, no
string keys in `process`, no allocation after `create`, params numeric only.

## Adapters (ship with `audio-module`, hosts import one)

- `toOp(module)` → `audio.op` descriptor. Engine already supplies range scoping,
  automation (fn params → `set` per sub-block), click-free ramps — the adapter maps
  `ctx` params to `set()` calls and persists the instance on `ctx`.
- `toBatch(module)` → `fn(channelData, params)` one-shot (audio-effect compatible).
- `toStream(module)` → `{write(chunk), flush()}` (dynamics-processor compatible).
- `toWorklet(module)` → `AudioWorkletProcessor` subclass; `params` → `parameterDescriptors`.

## Decisions

- **Naming**: `@audio/fx-*` for effects, `@audio/pitch-*`, `@audio/stretch-*`. Existing
  packages become thin meta-packages re-exporting the scoped module (babel pattern).
- **Peer dep**: none on `audio` — modules depend only on the contract. `audio` depends on
  modules, not vice versa.
- **Pilot**: **compressor** (simple, stateful, common; exercises params/smooth/latency).
  Acceptance: runs as batch + stream + AudioWorklet + `audio` op with zero per-host glue,
  plus a jz build passing differential CI.
- **Migration order**: compressor (new) → audio-effect (wide, shallow) → pitch-shift /
  time-stretch (stateful, windowed) → audio-filter (biquad state maps 1:1).
- **Native targets** (VST3/AU/CLAP): contract must *allow* a WASM+JUCE/iPlug wrapper
  (it does — fixed create-time format, no host API in process) but build nothing until
  one flagship module justifies it.

## Non-goals

Graph topology, scheduling, MIDI — the module is one node's DSP; hosts own wiring.
