# v2.3.0 — ecosystem edition (draft)

Pre-release checklist (see todo.md ## Release):
- publish @audio/effect + @audio/denoise manifest releases, then switch
  test files import published /atom artifacts (done);   devDeps in place — CI has no sibling checkout (done)
- npm version minor (prepublishOnly runs build + version sync + full tests)

## Notes

- `@audio` contract atoms host natively: `audio.use(factory)` or `audio.use('name')` — ~40-atom registry (dynamics, denoise, effects)
- Whole-render hosting — `streaming: false` atoms (declick, declip, leveler…) materialize the timeline and process it in one pass
- Plugin delay compensation — declared `latency` (lookahead limiters, STFT denoisers) lands aligned to the timeline
- Param-dependent tails — feedback delays pad by RT60 from live feedback, undo-atomic
- Sidechain — `music.ducker({ key: voice })`
- `audio/worker` — the whole engine in a Worker: thin facade, zero-copy reads, edits as the wire protocol, playback via AudioWorklet port (no SharedArrayBuffer) or @audio/speaker
- Breakpoint-curve automation `{t, v}` — serializable, survives toJSON and the worker boundary
- Engine automation for every op param — functions/curves sampled sub-block, click-free ramps, `{at, duration}` on all process ops
- `@audio` scope adopted: decode/encode/mic/speaker, filter+eq, weighting, stretch (phase-locked pvocLock), beat, pitch/mir/note, vocals, window — 9 legacy deps dropped
- LUFS per ITU-R BS.1770-4 — channel-summed, 75% overlap gating, exact K-weighting at any sample rate
- Blob/File/Response sources
- CLI: registry ops auto-resolve, `--help` synthesized from module param metadata, strict value parsing, negative ranges (`-1s..`)
- Structural-edit correctness overhaul: reversed-range crop/insert/remove/repeat/reverse, stat-conditioned resolve after edits, ref sample-rate reconciliation, circular-ref guard, channel-width pipeline
- ~1200 tests across node/CLI/browser suites

**Full Changelog**: https://github.com/audiojs/audio/compare/v2.2.0...v2.3.0
