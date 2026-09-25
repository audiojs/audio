# Memory investigation — 2026-09-25

The reported 60 GB was not reproduced in the local working tree. Real resource
leaks were reproduced in the audio API and fixed. The demo uses its own Web Audio
scheduler, so those API defects alone do not establish the cause of the page alert.

## Reproduced defects

- `play()` finished with `write(null)`, but the installed `@audio/speaker@2.3.3`
  browser backend does not close its context on that call. Twelve short playbacks
  left twelve contexts open. Playback now explicitly closes the device on finish,
  stop, restart, disposal and failure; normal completion drains pending audio.
- Worker disposal left its AudioWorklet, port and context running. Six disposed
  players left six contexts open. Each playback session now owns its sink and
  releases it, including cancellation during asynchronous worklet startup. Loops
  reuse the same device; empty loops terminate.
- Worker buffering counted `chunk[0].length` after transferring its ArrayBuffer.
  Transfer detaches the sender's buffer, making that length zero and disabling
  backpressure. Counting before transfer limits the queue to 8,192 frames plus one
  1,024-frame block. A one-second test now takes actual playback time to finish.
- Disposal retained edit references, whole-render caches, statistics, metadata and
  generated cover-art Blob URLs. These are now released; delayed cache reads
  cannot restore disposed pages, and waiting streams are woken. Worker facades
  also clear mirrored edits, reject reuse and ignore late snapshots; shutdown
  rejects pending requests and decode waiters.
- Interrupted decoding skipped codec cleanup. Codec resources are now freed on
  every exit. The 256 KiB metadata prefix no longer copies or pins an entire
  encoded input buffer. Disposal aborts unfinished fetch/file reads and cancels
  Blob readers, including reads stalled before metadata arrives.
- Browser microphone acquisition is asynchronous. Recording now awaits it and
  releases a device that arrives after stop/dispose. Acquisition errors clear
  recording state and emit an error so a later recording can start.
- The demo retired loop-position history only when painting the playhead.
  Background tabs can suspend animation frames while audio continues. The
  playback pump now retires that history itself, keeping it bounded.

[AudioContext.close() releases system audio resources](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/close);
JavaScript references to buffers and nodes must also be released.

## Measurements

Headless Chromium, local assets, macOS. A dedicated browser process group was used;
RSS below includes its renderer, browser and GPU processes. Heap measurements are
after forced garbage collection; RSS includes native allocations and allocator
high-water marks, so it is diagnostic rather than a strict test assertion.

| Exercise | Result |
| --- | --- |
| 12 API plays after the fix | 12 contexts created, 12 closed |
| 6 worker players disposed | 6 contexts created, 6 closed |
| Worker queue | Maximum 9,216 frames; playback position reaches one second |
| 30 page play/pause/sample replacements | About 0.5 MiB additional retained JS heap; 92 event listeners before/after; one shared context |
| Two minutes of tiny selection looping, animation frames suppressed | 4,619 sources scheduled; at most five simultaneously active; zero active after pause |
| Loop test retained JS heap | 3,510,620 → 3,449,740 bytes |
| Loop test buffer backing storage | 5,690,922 → 5,579,449 bytes |
| Loop test total browser RSS | 471,089,152 → 371,310,592 bytes (about 449 → 354 MiB) |

These results do not rule out a browser-specific leak, a different deployed
revision, a particular file/effect, or growth over hours. The original browser,
monitor metric and steps preceding the alert are still needed to attribute 60 GB.

## Repeat

```sh
npm run test:memory
AUDIO_MEMORY_SOAK_MS=120000 node --test --test-name-pattern='tiny loops' test/memory.test.js
npm run test:all
```

The 28 memory tests exercise real browser devices with synthetic audio, fake
microphone input, cancellation races, disposal, decode failure, cover-art URLs,
cache restoration and the actual page. It is included in `test:all`.

Working-tree review verification: `npm run test:all` exited successfully. The core,
fixes, batch, CLI, MCP and browser suites passed, followed by all 122 site tests
and all 28 memory tests. The final full run also passed the unchanged logo
fling/settle test that timed out in the first run. Both two-minute loop runs passed.

Commit isolation verification: the memory changes and rebuilt website bundle were
tested separately from other uncommitted work. Core, fixes, batch, CLI, MCP and
browser tests passed; 110 of 112 site tests passed. The two workshop layout tests
(`the continuous strip has one divider per join and rounded ends after wrapping
and deletion` and `wrapped connectors follow the chain and point along its
direction through resize, reorder and removal`) also fail on unchanged HEAD.
All 28 memory tests passed separately in the isolated commit tree.

## Review evidence

Test names below omit the common `memory:` prefix. They live in
[`test/memory-core.test.js`](../test/memory-core.test.js) and
[`test/memory.test.js`](../test/memory.test.js).

| Exact test name | Input and operation sequence; invariant |
| --- | --- |
| one-frame A → A → stereo B decodes exactly across the final byte boundary | Float32 WAV: mono `[.25]` twice, then three-frame stereo; Blob byte splits at N−1 and N; read and streamed PCM equal every input sample at 48 kHz. |
| zero-frame encoded input rejects and frees its decoder | Valid empty WAV container → readiness and stream reject, codec freed once. |
| worker one-frame A → A → stereo B preserves PCM at the block boundary | Replay one mono frame, then 1,025 stereo frames; capture worklet messages before transfer and compare every sample. |
| dispose wakes a stream waiting for more pushed data | `audio(null)` → pending stream read → dispose → EOF. |
| worker disposal drops mirrored edit buffers and rejects reuse | Mix buffered PCM → queue another edit → dispose before its snapshot arrives → edits stay empty; repeated disposal succeeds; play rejects without opening a device. |
| closing during worker open rejects waiters and a new worker remains usable | Open → close before ready → readiness rejects; new stereo source reads exactly; disposing a pushable worker settles its pending readiness. |
| rejected worker transfer settles and the next open succeeds | Non-cloneable function source → DataCloneError; next valid mono open/read succeeds. |
| microphone denial permits retry and repeated capture releases every track | Denied getUserMedia → error and idle state → two record/stop cycles on the same instance → every track ended, no live contexts. |
| disposal during eviction cannot restore a page slot | One PCM frame, zero-byte budget, deferred cache write → dispose → finish write → pages remain empty. |
| disposal aborts an unfinished URL fetch and settles readiness | Pending fetch with an observed AbortSignal → dispose → signal aborted, readiness settled, no pages. |
| disposal cancels a stalled byte read before metadata | Blob with a stalled body → waiting decode and stream → dispose → reader cancelled/unlocked and stream EOF. |

Sibling checks covered both speaker sinks, queued and immediate worker sends,
cache reads and writes, codec exits, and byte-source cancellation. Export Blob
URLs already have timed revocation; the worklet module URL is one reusable Blob,
not a per-playback allocation. Unused sink flush methods were removed.

The audio hot path keeps one cancellation callback per active wait, rather than
attaching every block to a never-settling promise. Abort controllers/listeners are
per decode, outside the PCM loop. Worker lifetime checks are constant-time; no
sample copies or dependencies were added to production processing.

Full decoded PCM still costs `frames × channels × 4` bytes per Float32 copy.
The page retains source and edited PCM for its waveforms and editor, and original
playback creates an AudioBuffer. API page-cache budgets do not cap all render
caches, full `read()` results, retained application references or browser memory.
The page checks the two-minute duration limit after `decodeAudioData()` completes;
the 20 MB compressed-file limit therefore does not bound peak decode memory.
Call `dispose()` when an instance is no longer needed and release application
references to its returned buffers.
