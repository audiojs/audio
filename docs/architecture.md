# Architecture

See also: [Plugins](plugins.md)

## Files

| File | Role |
|------|------|
| `core.js` | Engine — decode, paginate, plugin registry, instance factory, page I/O. The only required file. |
| `stats.js` | Block-level stat engine — min/max/energy/clip/dc per `BLOCK_SIZE`-sample block during decode. Powers waveform, loudness, stat queries without touching PCM. |
| `cache.js` | Page cache — LRU eviction to OPFS, on-demand restore. Large files stay playable without exhausting RAM. |
| `plan.js` | Edit pipeline — non-destructive edit list, plan builder, stream renderer. `a.gain(-3).trim()` becomes a declarative plan materialized on read. |
| `audio.js` | Full bundle — core + stats + cache + plan + all plugins. The default import. |
| `fn/*.js` | Plugins — each file is one op, stat, or method. Self-contained, independently importable. |
| `bin/cli.js` | CLI — arg parsing, plugin auto-discovery, batch/glob/macro/playback. |

## Three import paths

```js
import audio from 'audio'            // full bundle — all ops, stats, cache
import audio from 'audio/core.js'    // bare engine — no ops, no cache
import gain from 'audio/fn/gain.js'  // individual plugin
```

## Stream-first

No operation touches full PCM at once. Audio is stored in pages. Decode streams pages progressively. Every output — `stream()`, `play()`, `save()`, `stat()` — walks pages one chunk at a time through the edit pipeline. `read()` materializes into memory but still processes through the same chunk pipeline internally.

A 2-hour file never needs 2 hours of float arrays in memory unless you `read()` the whole thing.

## Non-destructive editing

Ops don't mutate source pages. `a.gain(-3).crop({at: 1, duration: 5})` pushes two entries to `a.edits`. Source data stays immutable. The edit list replays on demand — undo, serialize, or reapply.

## Plan

`buildPlan(a)` compiles `a.edits` into two things, cached until the next edit (version-keyed):

- **Segment map** — copy instructions: which source ranges map to which output positions. Structural ops (crop, remove, insert, repeat, pad, reverse, speed) rewrite segments. Each segment is `[from, count, to, rate?, ref?]` — "read `count` samples from `from`, write at `to`."
- **Sample pipeline** — per-block transforms applied in order (gain, fade, filter, pan). Each op receives one `BLOCK_SIZE` chunk. Stateful ops carry state across blocks.

Compilation happens once per version. Streaming walks the pre-built plan — no recompilation per block.

```
a.edits ──→ buildPlan() ──→ { segments, pipeline }    (compiled once, cached)
                                    ↓
source pages ──→ segment map ──→ sample pipeline ──→ output blocks
(Float32)        (structural)    (per-block ops)    (stream or flat)
```

## Pages and blocks

Audio is fragmented at two levels — **pages** for storage, **blocks** for processing:

| | `PAGE_SIZE` (1024 × BLOCK_SIZE) | `BLOCK_SIZE` (1024) |
|-|---|---|
| **What** | Samples per storage chunk | Samples per processing unit |
| **Stores** | Float32Array[] per channel | min, max, energy, clip, dc per block |
| **Purpose** | Memory management, cache eviction, decode streaming | Op processing, stat computation, waveform resolution |
| **Memory** | PCM data — evictable to OPFS | Stats — always resident (~7 MB for 2h stereo) |

The edit pipeline materializes one block at a time: read source → apply structural ops (segment map) → run sample transforms → yield output block. Peak memory is one block per channel regardless of file length.

Cache eviction works at page granularity: cold pages offload to OPFS, hot pages near the playhead stay resident.

Ops and stats both process in `BLOCK_SIZE` chunks — same unit, same granularity. Stateful ops like filters carry state sample-to-sample within and across blocks.

Both are configurable — set before creating any instances:

```js
audio.BLOCK_SIZE = 256
audio.PAGE_SIZE = 2048 * audio.BLOCK_SIZE
```

Each instance's stats record `stats.blockSize` — the block size used at decode time.

### Waveform zoom and block resolution

`BLOCK_SIZE` sets the finest pre-computed stat resolution. Three zoom regimes:

- **Zoomed out** (many samples per pixel): `stat('max', { bins })` aggregates multiple blocks into fewer bins. Pre-computed stats suffice — no PCM access.
- **1:1** (one block per pixel): stats render directly.
- **Zoomed in** (fewer samples than one block per pixel): read PCM from pages for sample-accurate waveform. Page cache makes this fast for the visible region.

Changing `BLOCK_SIZE` cannot retroactively refine existing stats. For finer resolution in a zoomed region, read the PCM.
