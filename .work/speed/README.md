# Speed, 2026-11-12 to 13

Five agents (Opus 5.5) over two rounds made audio's decode, loudness, normalize, resample, stretch and pitch rows
faster. The libraries were published on 11-13; audio's own changes were committed that night, the two patches that
waited for a yes among them, tested against the published packages; 2.15.0 went out on 11-14. This file is the
record: what changed, what was measured and how it was shown, what was found on the way. It is kept by the commit
that added it and gone from the tree with the next: what is open went to `.work/todo.md`, what waits on the
libraries' release to the head of `.work/channels-together.patch`.

## Where it stands

Published to npm, 2026-11-13 (each installed here and compared with its checkout: the same files):

| Package | Version | What |
|---|---|---|
| `fourier-transform` | 2.5.1 → 2.6.0 | `pair`: two channels' real FFTs at once in WebAssembly SIMD, a lane each, the bits `fft` and `ifft` give at 3.5 to 4 times the two JS calls; its window and overlap-add in the kernel's memory (`pair.own`); `stftStream` takes `channels` |
| `@audio/spectral-pvoc` | 1.1.1 → 1.2.0 | the lock step in a WebAssembly SIMD kernel (`lockStep`), the JS path the same bits; free bins turned by a table of whole turns and fdlibm's kernels, within 1e-12 rad of `Math`'s: 26.5 → 7.2 µs a channel-frame |
| `@audio/stretch-pvoc-lock` | 1.3.3 → 1.4.0 | `channels`: one vocoder for all of them, each channel's samples its own stream's; the lock step by `lockStep` |
| `@audio/stretch` | 2.3.0 → 2.4.0 | the umbrella on pvoc-lock `^1.4.0` |
| `@audio/encode-wav` | 1.5.2 → 1.5.3 | 16-bit stereo through a WebAssembly SIMD kernel, the same bytes: 61 to 81 → 23 to 29 ms on 10 minutes |
| `@audio/decode-wav` | 2.0.0 → 2.0.1 | 16, 24 and 32-bit PCM to float32 in a WebAssembly SIMD kernel, the loops' bits (the 600 s file 41.5 → 15.6 ms); a 32-bit integer or 64-bit float WAV in a Node Buffer off its alignment decoded, where it threw |
| `@audio/neural-denoise` | 0.6.1 → 0.7.0 | `segments()` (not speed: the repl's kind; it shared the release) |
| `@audio/neural-tag` | 0.1.0, new | YAMNet's 521 AudioSet classes (not speed: the repl's kind) |

In audio, one commit on 4499870 (68f43c3, "The inner loops in WebAssembly SIMD kernels…"; 2.15.0 is c2febea after
it, both pushed on 11-13; 421d07b after them, the tests as CI runs them, and 04ad077, the site's build, pushed on
11-14; 2.15.0 published by the owner from 04ad077 on 11-14, 14:58 UTC, the registry's tarball the tree's: shasum
ac4e18dd…, 106 files). Its files hold nothing but this
work (`package.json` apart: another session's peer entries are in it): 4499870 with the five patches that were
applied gave the first five rows' files and the two test files byte for byte, but for the review's changes named
below and the two patches the owner applied on 11-13.

| What | Files | Output |
|---|---|---|
| The sinc's dot products in a WebAssembly SIMD kernel (1,336 bytes), four outputs a pass; the linear read's end test and reverse case out of its loop | `fn/resample.js`, `fn/resample.wat`, `plan.js` | the same bits |
| The index: each block's levels and K-weighted energy in one WebAssembly SIMD pass (810 bytes), a run of blocks a call | `fn/block.js`, `fn/block.wat`, `fn/stat.js`, `fn/loudness.js`, `stats.js` | the same bits |
| The CLI's 100 ms sleep before a save gone, the spinner's first frame drawn at once | `bin/cli.js` | |
| Stretch and pitch: one vocoder for all channels; the read-back's taps once a sample for both channels, the plan's map a piece at a time; a pitch with no range asks for no edge | `fn/stretch.js`, `fn/pitch.js` | audio's part the same bits; with the libraries' trig, 0.3% of samples one float32 step off (5.96e-8: round one's measure) |
| A WAV opened by its path in Node read and decoded a page at a time, each page the decoder's own arrays | `core.js`, `fn/parts.js` | the same bits |
| A stretch whose timeline is sources reads them at the vocoder's own rate (`stretch-source.patch`) | `fn/stretch.js`, `plan.js` | changes a stretch's sound (the two patches, below) |
| An MP3 opened by its path decoded in parts on threads (`mpeg-parts.patch`) | `core.js`, `fn/parts.js`, `parallel.js` | the serial decoder's samples over a corpus (below) |
| `fourier-transform` `^2.6.0`, `@audio/stretch` `^2.4.0`; dev `@audio/neural-denoise` `^0.7.0`, `@audio/neural-tag` `^0.1.0` | `package.json`, `package-lock.json` | |
| Tests (below); the bench's rows like for like, its run of 11-13 and the figures it gives | `test/index.js`, `test/stream.js`, `test/cli.js`, `test/repl/run.test.js`, `bench/bench.js`, `bench/bench.py`, `bench/results.json`, `docs/comparison.md`, `README.md` | |

Each kernel keeps its JS loop for where WebAssembly SIMD does not run, and its `.wat` beside it: `wat2wasm` gives the
bytes embedded in `fn/block.js` and `fn/resample.js` (checked 11-13).

What differs that is not the samples:
- A WAV by its path sends `'data'` a page at a time (23.8 s of 44.1 kHz), not at each 64 KB read, and the first
  after a page's bytes: at 12 ms against 8 for the 600 s file on this disk, the whole decode 126 ms against 155 (in
  process, the least of 7 runs each). Not measured on a slow disk or a network mount, where the first sample waits
  for a page to be read: 4 MB at 16-bit stereo, 19 MB at 24-bit 5.1.
- Two WAV kinds that threw now decode (32-bit integer or 64-bit float data off its alignment in a Node Buffer).
- One block function serves every level and the K-weighted energy, so a session asked for one stat measures them
  all: free in the kernel, a second pass in the JS loops.
- The sinc kernel's memory holds a copy of each bank it has used and never shrinks (WebAssembly's cannot): about
  0.5 MB for upsampling and for each distinct downsampling ratio, beside the JS copy that was already kept.

## The review, 2026-11-13

**Why step 6 failed.** Its `npm i fourier-transform@^2.6.0 @audio/stretch@^2.4.0` ran about 08:31:41 (the patched
files' times), before `@audio/stretch-pvoc-lock` 1.4.0 (08:32:07, npm's times) and `@audio/spectral-pvoc` 1.2.0
(08:33:00) were there: the umbrella asks for pvoc-lock `^1.4.0`, so it could not resolve, and 2.5.1 and 2.3.0
stayed installed, `package.json` untouched. The patches applied all the same, and `stretch.patch` passes `channels`
to a vocoder that dropped it: 40 tests, each "Cannot read properties of undefined (reading 'length')". Reproduced
(978 pass, 40 fail), then the installs run again: no failure. Nothing was wrong with the patches or the packages;
the old RELEASE.md had no `&&` between its installs, its patches and its tests.

Read line by line: the five applied patches, both kernels' `.wat` against the loops they replace. Changed:
- `fn/block.js`: `block.simd`, the switch `sincInterp.simd` is, so a test can run the JS loops. No test ran them
  once the kernel took every block.
- `fn/stretch.js`: `piece` uses the map's one binary search (it carried a copy of it).
- Three tests in `test/index.js` that keep what the deleted harnesses showed, each seen to fail on a one-character
  fault put into the code: the block kernel against the JS loops and the two by turns in one session (240
  sessions: one to five channels, four rates, NaN, infinities, signed zeros, denormals); the linear read against
  the plain loop (1,650 reads); a channel stretched alone, in a pair and among three or four (the two-channel
  read-back against the general one, one vocoder at any count), after a gain or a filter too.
- `test/repl/run.test.js`: "Stop while an edit renders undoes it" waited for a progress message that a stretch of
  100 s no longer lasts long enough to show: the one test the speed broke. Its edit is 17 minutes now.
- `bench/bench.js`: audio's stretch cell ran `stretch 0.8` (480 s out) against SoX's `tempo 0.8`, FFmpeg's
  `atempo=0.8` and librosa's `rate=0.8` (750 s out each, measured). It runs `stretch 1.25` now.
- `bench/bench.py`: Pedalboard's resample cell ran its `Resample` plugin, which converts and converts back: 44.1 kHz
  out, twice the work. It reads the file at 48 kHz now (`AudioFile.resampled_to`): 6.15 → 3.40 s.
- `bench/bench.js` holds each transform row to its work, the length and rate of every file a tool wrote, and says
  which is another: it names both cells above when they are put back, and FFmpeg's pitch, which its filter shortens.
- `~/projects/@audio/stretch`: step 3's `npm install` had not run (its lock held fourier-transform 2.5.0 and
  spectral-pvoc 1.1.0). Run: the lock updated, committed there by the owner (04b69fa); 175 tests pass on the
  published packages.
- `@audio/neural-tag` was read here as unpublished, wrongly: one 404 from the registry at 08:34, a minute and a
  half after it went up (08:32:49), never asked again. The owner's publish was refused as a repeat.
- `test/repl/page.js`: installed as a dev dependency (the old RELEASE.md's step 6), the tagger makes a page fetch
  YAMNet from Hugging Face whenever a sound opened is neither speech nor music, and the tests' page refuses every
  request that leaves it: 14 tests failed for that alone. The tests' page serves the model from the cache Node
  keeps it in, a 404 where it is not there (the page then has no word): the suite below.
- `test/cli.js`: its CLI runs took the runner's stdin, so from a terminal the two tests of an output that exists
  without `--force` met the prompt (Overwrite? [Y/n]) and timed out at 5 s: the owner's step 4, 152 pass and 2 fail.
  Their stdin is empty now: 154 pass and 1 skipped, in a terminal (`script`) and out of one. There since
  2026-07-06, not the speed's.
- **What CI found once the commits were pushed, that this machine had not** (11-14, fixed in 421d07b):
  - The block test added in this review compared a NaN's bits. On CI's Linux x64 (Node 20, 22, 24) the kernel and
    the JS loops parted in 42 of the 240 sessions; on arm64 in none. WebAssembly leaves a NaN result's sign and
    payload open (Core Spec 4.3.3, NaN propagation), ECMA-262 its encoding in a typed array (NumericToRawBytes), and
    x64 gives the NaN it makes the sign bit. The test holds a NaN to be a NaN and every number to its bits, and says
    where two sessions part. So "the same bits" above reads: every number, bit for bit; a NaN is a NaN.
  - `test:browser` had not been run here (it was listed as not run). Its library page failed on four tests written
    for Node: the review's block, linear-read and stretch tests and round one's sinc test (an internal module is the
    bundle in the page; `Buffer` is not there). The three of internal modules are Node's now, as the repo's others
    are; the stretch test runs in the page.
- `docs/comparison.md`'s Performance table, the ratios under it and `README.md:1003` held July's figures. They hold
  the run of 11-13 now (Measured, below), and two things July's text did not say: the resample row is audio's
  linear default against the others' sincs (its `type: 'sinc'` about 1 s there: 1018 ms against 418, the least
  of 3 in process), and part of the change since July came with the releases between (HEAD ran the resample in
  1.17 s before this work).

Checked again today, a WAV's pages against the stream path (HEAD's `core.js`), samples and every stats field bit
for bit: 25 WAV files (8 to 32-bit, float, G.711, ADPCM, 5.1, 96 kHz, LIST, bext, RF64, a piped WAV, odd lengths;
22 of them go by pages) at page sizes 65,536 and 1,048,576: 0 differ.

## Measured

`bench/bench.js` on the published packages and the commit, 2026-11-13 at 23:15: the 600 s fixture, the best of 3
warm runs, another session's load about 7 on 14 cores. It is `bench/results.json` and `docs/comparison.md`'s table.
The other tools' cells came out within 8% of July's, but for SoX's normalize (20% over) and librosa's stretch and
pitch (22% under; 7.00 and 6.22 s that morning, the same librosa): the load moves a cell by that much at most.

| Operation | `audio` (Node) | librosa | Pedalboard | SoX | FFmpeg |
|---|---|---|---|---|---|
| WAV decode | 246 ms | 86 ms | 34 ms | 50 ms | 73 ms |
| MP3 decode | 306 ms | 278 ms | 447 ms | | 484 ms |
| Peak normalize | 405 ms | | | 555 ms | |
| LUFS measurement | 229 ms | | | | 336 ms |
| Resample 44.1k → 48k | 450 ms | 605 ms | 3.51 s | 1.04 s | 292 ms |
| Time stretch 0.8× (750 s out) | 3.09 s | 5.46 s | | 5.82 s | 665 ms |
| Pitch shift +2 st | 2.83 s | 5.20 s | 9.12 s | 6.02 s | 821 ms |
| FFT spectrum (1024-pt) | 664 ms | 444 ms | | | |
| MFCC (13 coeff) | 707 ms | 604 ms | | | |
| Beat tracking | 255 ms | 1.11 s | | | |

That morning's run, before the two patches: MP3 decode 936 ms, the stretch 4.38 s, audio's other cells within 8% of
these. July's: WAV decode 967 ms, MP3 1.57 s, normalize 1.89 s, LUFS 973 ms, resample 2.00 s, stretch 8.74 s (at
480 s out), pitch 15.2 s. Not all of the difference is this work: HEAD already ran the resample in 1.17 s. FFmpeg's
stretch is `atempo`, a time-domain overlap-add, and its pitch `asetrate` with a resample, which moves the duration
too (534.5 s out): neither is a vocoder's work. The resample row is audio's linear default against the others'
sincs. Pedalboard's resample cell is the corrected call's (July's ran its plugin, a round trip: 6.24 s).

What each round gave, wall, s: each pair the least of interleaved runs in one loop, under load 7 to 26, so a pair's
ratio holds and the absolute values do not (round two began where round one ended, at another load):

| Row | Round one | Round two |
|---|---|---|
| WAV decode | 0.58 → 0.39 | 0.35 → 0.28 |
| LUFS | 0.57 → 0.37 | 0.34 → 0.27 |
| Normalize, write | 0.89 → 0.60 | 0.49 → 0.44 |
| MP3 decode | 1.38 → 1.20 | 0.92 → 0.93 (0.28 with `mpeg-parts.patch`) |
| Resample 44.1 → 48k, linear (the default) | 0.80 → 0.75 | |
| Resample 44.1 → 48k, `type: sinc` | 2.74 → 1.44 | |
| Stretch 0.8× (480 s out) | 11.75 → 6.97 | 4.66 → 3.42 (2.59 with `stretch-source.patch`) |
| Pitch +2 st | 8.07 → 5.20 | 3.73 → 2.89 |

Beside them in round two's loops: Rubber Band 4.0 R2 3.42 s on the stretch (6.27 s of CPU) and 5.28 s on the pitch;
audio's own `method: wsola` 9.73 s.

## Tests

On the published packages, the tree with both patches in (the commit, and the repl session's work beside it),
`@audio/neural-tag` installed, 2026-11-13 from 23:20, another session's load 6 to 10:

| Suite | Result |
|---|---|
| `npm test` | 1023: 1022 pass, 1 skipped (`restore`: `@audio/neural-restore` is not installed, nor on npm) |
| `test:fixes` | 140 pass (`fix-worker.js` 109 assertions where it ran 113: a delta a page, not a read) |
| `test:batch` | 13 pass |
| `test:cli` | 155: 154 pass, 1 skipped (the 28-minute encode), in a terminal (`script`) and out of one |
| `test:stream` | 103: 102 pass, 1 skipped |
| `test:mcp` | 33 pass |
| `test:repl` | 523: 522 pass, 1 fail, in the tree itself |

`test:repl`'s one failure, "the status bar holds still … a 1280px window", fails at 4499870 too. "a sound longer
than the page holds sounds under the caret as it is pressed" passed in this run; it hears nothing at 1500 s in
about half its runs (6 of 13 with the speed's files, 4 of 6 with them as at HEAD, under load 7 to 13).

That morning's first run in the tree (518: 489 pass, 29 fail) had 23 failures in the embedded chain that session
was then building, 4 that passed run again, the status bar, and the speed's one (above). `engine.test.js`'s tests
pass, among them the library's output, peak and loudness in Chromium's worker against its run in Node.

Beside the suites, what a user of the package gets: it was packed and installed from the registry into an empty
folder (328 packages). Its decode of a WAV and of the 600 s MP3, loudness, stretch, pitch, sinc resample, normalize
and a saved WAV are the tree's, hash for hash, and its CLI's stretch the tree's file byte for byte. Of its 159
registry plugins 158 load; `rnnoise` asks for the optional `@audio/neural-denoise`. And the commit alone, exported
without the repl session's files: `test:node` passes (`npm test` 1012 and 11 skipped: the plugin host's, whose test
plugin a copy lacks, and `restore`).

The publish was rehearsed in a terminal, `npm publish --dry-run`: through `prepublishOnly` (the version, the build,
`test:node`) to `+ audio@2.15.0`, 106 files, 731.3 kB, nothing sent. Its warning that `bin[audio]` "was invalid
and removed" is how npm 11.12.1 says it cleaned the name: 2.12.0 to 2.14.0 went up by that npm from the same field
and have their `bin` on the registry.

`test:browser`, run on 11-14 with 421d07b's tests: the library's page 613, 586 pass and 27 skipped. Its playback
page 17, 14 pass and 3 fail at load 4 to 6 (clicks and gaps under a busy main thread); on CI that page failed 6 of
17 at 4499870 and 5 at c2febea.

CI at 421d07b, Linux x64: `test` passes on Node 20, 22 and 24, on Bun and Deno (`runtimes`), `polyfill` and
`check`; `browser` ran the library's suite alone (what the change reaches), which passes. Two tests this work does
not touch failed once and passed run again: `test/deck.js`'s splice on Node 24 (2.8e-4 against 1e-6) and, at
c2febea, `repl run`'s "still zoomed in". At c2febea the browser suites that failed otherwise were those failing at
4499870: live, playback, repl pitch, repl writers. `pages` fails at the site build's copy (found, below).

Not run: `test:memory`, Firefox, WebKit, a strict CSP, a big-endian host, Windows, a quiet machine.

## The two patches, applied by the owner on 11-13

Both are in the commit, and the suites above ran with them; the patch files are gone (11-14: the first's read is
every stretch's now, 4ceb9fd, and no longer reverses; the second is published). Advised here before they went in:
the first after a listen, the second held (no test forces its fallbacks; its place is `@audio/decode-mp3`). The
owner listened on 11-14: below, after the listen.

On 11-14 the first was measured on recordings, the commit against a copy of it with the patch reversed (the pair
differs by the patch alone): a voice (7 s, mono, 48 kHz) and a soundtrack (30 s, stereo, 48 kHz), each band's level
against the source's in the same band, dB (four second-order Butterworth sections an edge, FFmpeg's `astats` RMS):

| | < 1 kHz | 1–4 kHz | 4–10 kHz | 10–16 kHz | > 16 kHz |
|---|---|---|---|---|---|
| voice 1.25, before | −0.1 | −0.7 | −1.3 | −3.2 | −6.3 |
| voice 1.25, patched | −0.1 | −0.7 | −0.8 | −1.5 | −1.7 |
| voice 0.8, before | −0.2 | −1.2 | −1.8 | −3.7 | −12.9 |
| voice 0.8, patched | −0.2 | −1.1 | −1.3 | −2.1 | −2.4 |
| soundtrack 1.25, before | −0.2 | −0.5 | −1.3 | −2.5 | −6.2 |
| soundtrack 1.25, patched | −0.2 | −0.4 | −0.7 | −1.0 | −1.7 |
| soundtrack 0.8, before | −0.3 | −0.7 | −1.7 | −3.0 | −12.9 |
| soundtrack 0.8, patched | −0.3 | −0.7 | −1.2 | −1.5 | −2.4 |

Level, not sound: it says the top is kept, not what the vocoder does to a transient. The two renders are far apart
as waveforms where the source has a top (the voice: r 0.47 to 0.55, what is left once they are subtracted as loud
as the sound; a piano with nothing over 10 kHz: r 0.996 to 0.999, −21 to −28 dB), and it is what the source holds
over 3 kHz that parts them, not time: the voice low-passed at 3 kHz first gives r 0.9991, and thirteen bursts at
known times land within 0.01 ms of where the factor puts them in both, at 44.1 and 48 kHz, 0.8 and 1.25. So the
patch moves every sample of a full-band stretch, the vocoder's phases with it, not the top octave alone.

**`stretch-source.patch`: changes a stretch's sound.** Before it a stretch read its source back from the plan's linear
interpolation of it, which aliases and dulls the top: at 0.8× a 10 kHz tone has an image at −20.8 dB, a 15 kHz tone
at −10 dB, and over 17.6 kHz the alias is louder than the tone; the blackbird gains 30 to 52 dB over 18 kHz, where
its file has nothing. With the patch the vocoder reads the source at its own rate where the stretched timeline is
sources: every tone within 0.72 dB, nothing else over −51.6 dB, and the stretch 0.8 s faster. The agent's measure:
pure tones, 2^16 samples of the steady middle, 4-term Blackman-Harris (sidelobes −92 dB: Harris 1978, Proc. IEEE
66(1)); the level against the input's, and the largest other component against the tone, dB:

| Tone | 0.8×, before | 0.8×, patched | 1.25×, before | 1.25×, patched |
|---|---|---|---|---|
| 1 kHz | −0.04, −52.5 | −0.03, −52.5 | −0.04, −51.5 | −0.02, −51.5 |
| 5 kHz | −0.84, −34.0 | −0.49, −59.5 | −0.83, −34.2 | −0.49, −57.8 |
| 10 kHz | −1.58, −20.8 | −0.18, −52.0 | −1.51, −21.9 | −0.18, −52.0 |
| 15 kHz | −4.13, −10.0 | −0.09, −52.1 | −2.83, −17.2 | −0.08, −51.9 |
| 19 kHz | −18.15, +10.0 | −0.72, −51.9 | −5.25, −12.2 | −0.72, −52.6 |

Its limit as it went in: a stretch after a processed stage (a gain or a filter before it) kept the read-back and
its aliasing, so one stretch sounded two ways by what stood before it (ended on 11-14: after the listen). It carries
a test (10, 15 and 19 kHz keep their level within 1.5 dB, nothing else over −40 dB), which passes; the table above
was not measured again. It reads sources outside the pages the plan asks for, so it was run on 11-13 with pages let
go of (a cache with room for one page of 21, pages of 65,536): a stretch of 0.8, of 1.25, of a range, and one after
a gain, read whole and as a stream, each the bits of the sound held in memory.

**`mpeg-parts.patch`: an MP3 opened by its path in Node, three pages or more, decoded on threads past its first
page.** Each part by a fresh mpg123 started a few frames early, its first samples checked against those made before
it, the file decoded again from the start on any mismatch. The 600 s MP3: 942 → 312 ms in the CLI (FFmpeg 486); in
process today 838 → 200 ms, the first `'data'` at 34 ms against 21. It costs about 350 ms more CPU on that file, up
to eight threads kept for the process (unref'd), the MP3 read into memory whole (14 MB; the stream held 1 MB), and
a part's work going on after `dispose()` until it comes back. MPEG-2 Layer III (22, 24, 16 kHz) stays serial:
there a part differed for good. It leans on how mpg123 keeps its reservoir and its synthesis ring; a decoder that
keeps them otherwise falls back at the seam check, slower, not wrong. It also keeps the profiler's flags off
`parallel.js`'s threads, which at HEAD hang the process at exit under `--cpu-prof` (2 runs of 3).

Its evidence is a corpus, not a proof. Run again on 11-13, on that morning's tree: 3,032 parts over 31 MPEG files at three
page sizes, each the serial decoder's samples; end to end against the stream path, the 31 at two page sizes (25 and
24 of them in parts), samples and stats: 0 differ; and each of four failures forced (the first page's count, a part
that does not come back, a seam off, a thread's throw) on two files gave the stream's samples and stats, in the
stream's time. No test in the patch forces a fallback. Not verified: encoders other than LAME and FFmpeg's.
`mpeg-parts/` holds what reran it:

```sh
sh mpeg-parts/gen-corpus.sh bench/.cache/bench-600s.wav <corpus>          # ffmpeg, lame, sox
node mpeg-parts/diff-parts.mjs <patched tree> <corpus>/m*.mp3             # every part against one decoder
node mpeg-parts/diff-pages.mjs <patched> <streaming> default <corpus>/*   # end to end; streaming: HEAD's core.js
FAIL=seam AT=<a part's first byte> node mpeg-parts/fallback.mjs <patched, with fallback-inject.patch> <streaming> file.mp3
```

Open without a patch:
- Sinc as the default for upsampling. Linear at 44.1 → 48k: a 10 kHz tone loses 1.5 dB, its image at −22.8 dB; at
  20 kHz, −6.3 dB and −9.6 dB. The sinc: flat, images −69 to −78 dB under 15 kHz, at 1.44 s against 0.75. FFmpeg,
  SoX and librosa run windowed sincs. An exact-rational phase table would make the kernel about 1.6 times faster
  again (prototype: 7.4 against 11.8 ns an output), its samples one float32 step from today's.
- The index lazy, or after load: what WAV decode needs to pass FFmpeg (the index, 88 ms, takes as long as FFmpeg's
  whole run). It changes when `stats` is there.
- A fast WSOLA, its search by FFT cross-correlation: the row that stands against FFmpeg's `atempo`. Of audio's
  `method: wsola`, 9.5 of 10.7 s is the time-domain search.
- A normalize's dc shift and gain in one pass.
- The frame loop as a pipeline over threads: about 1.2 s less wall on a stretch, estimated from a profile, nothing
  built.

## After the listen, 2026-11-14

The owner heard the pairs: the piano at 0.8× "a bit better" before the patch, "wobbling of pitch" after; the rest
indistinguishable. Measured, the two piano renders are the same in each channel: every partial's pitch steady to
0.03 cents of the other's second by second, the levels of the partials as smooth. What parts them is the phase
between the channels, and that was wrong in both, and in 2.14.0 with the libraries it shipped on: a vocoder a
channel keeps each channel's phases and lets the phase between them go (a note entering a bin takes the rotation
that bin's noise left there, another in every channel). On the piano (40 s, stereo, 44.1 kHz) at 0.8×, in windows
of 2 s, the lag at which left and right agree best, samples:

| | |
|---|---|
| the recording | −6 −14 −14 −6 −9 −11 −12 −4 −14 −10 −9 −12 −22 −15 −15 (r 0.23 to 0.64) |
| 2.14.0, and 2.15.0 before and after the patch | 19 40 −42 −60 45 60 60 7 22 6 −10 13 −38 29 27 (r 0.08 to 0.40; ±60 the search's edge) |
| channels together | −6 −14 −14 −6 −9 −11 −12 −4 −14 −10 −9 −12 −22 −15 −15 (r 0.23 to 0.66) |

and the mono sum against the two channels' power, 4 s at a time: the recording −1.2 to −2.6 dB, the vocoder a
channel −2.2 to −4.4, together the recording's to 0.1 dB. The soundtrack's first 12 s are one sound in both
channels (r 1.00): 2.15.0 at 0.8× brings them out apart (r 0.87, then 0.65 at a lag of 28 samples, the mono sum
1.8 dB down), together as they were. Noise at −96 dBFS added to the input moved the patched
render for good in one channel from 2 s on (what is left once the two are subtracted 2 dB under the sound), the
old read's for a note at a time: the same defect, another draw of it.

Fixed where it is, in three libraries, committed, not pushed, not published on 11-14:
- `fourier-transform` 2.7.0 (4e9f945): `stftStream` takes `joint`, one `process` call a frame with every channel's
  bins and one state.
- `@audio/spectral-pvoc` 1.3.0 (1481d65): `lockJoint`, the lock step once a frame on a reference (the channels'
  root power, its phase advanced by the angle of Σ X·conj(X′) over them, which the phase between channels cannot
  cancel as it does in their sum), its rotation on every channel's bin; two passes more in the kernel (pvoc.wat,
  4,644 bytes), the JS loops' bits (640 frames of 1 to 5 channels).
- `@audio/stretch-pvoc-lock` 1.5.0, the umbrella 2.5.0 (c8bec07): channels and arrays of channels through it.
Timed on the 600 s stereo file under a load of 15 to 18, the least of 4: stretch 1.25 3.93 s (2.15.0: 4.27), 0.8
2.81 (3.14), pitch 3.68 (3.67). With the two passes in JS it was a second slower.
In audio it is `.work/channels-together.patch`: the test of it (the lag within a sample of the input's,
the level apart within 0.5 dB, stretch and pitch), the README's two rows, the two ranges. Its suite passed on the
libraries' heads: 1026 (1025, 1 skipped), fixes, batch 13, cli 155, stream 103 (1 skipped), mcp 33.

In audio, committed (4ceb9fd), each tested:
- **One stretch whatever stands before it.** The vocoder reads the timeline as it was through a reader of its own
  (plan.js `timelineOf`, `apart`: a stage keeps a cursor for it beside the timeline's). After a gain, a crop or a
  filter it is the stretch of the processed sound, bit for bit; a range after a filter within 3e-8, its cursor
  seeking into the filter. The read-back is deleted. A processed stage is rendered twice for it.
- **The grid after a seek**: content from the whole sample at or before where a session opens, every feed from
  where the last ended.
- `a.resample(48000, undefined)`: trailing undefined arguments are dropped.
- `test/deck.js`'s splice test: the crossfade's start by fit.
- The command line's sinc: this record was wrong, `resample 96000 type:sinc` always worked (any `name:value` is an
  option); the usage says so now.

CI's tests (the second commit of 11-14):
- `pages` deployed and failed its last step: `test/live.js` waited for an `.empty` the repl no longer draws (the
  repl session's three lines, committed). Its hero check counted nothing on the deployed site (`http://` sent on to
  `https://`, 0 KB in 1 file): counted now. The budget is 535 KB for the 525 it loads: 513 before 2.15.0, 12 more
  with the kernels and the paged decode. The owner's number: 510 stood since 11-03.
- `repl layout`: the note heard as a sound plays (the bar's `.heard`, 11-06) sits before the message, which the
  test held to its place: it is held to what stands before it.
- `repl clipboard`: headless Chromium on Linux names the web WAV among the clipboard's types and holds no data for
  it; the WAV half is read where it is kept.
- `repl recording`: "a take recorded as the others play" is real time (CI: the strike not drawn when looked for);
  skipped under CI and run with the advice suite, as its neighbour is.
- `repl writers`, `repl pitch`: a level or a tool dragged locks the pointer and reads `movementY`
  (`repl/view/pointer.js`); CI's headless Chromium grants the lock and a driven mouse's moves come wrong (the pill
  not heard, an intonation dragged down ×1.00 on 11-04, ×3.00 since). The tests' page has no pointer to lock. Read
  from the logs and the code, not reproduced here: CI is the proof.

The owner's second listen (11-14): the piano at 0.8× "robotic" before the patch, a bit more after, "maybe
subjective". Measured at the recording's 40 strongest attacks, the mono sum: the level rises 14.6 dB in 8 ms in
the recording, 10.4 before, 10.1 after, 10.3 with the channels together (a channel alone: 10.62 and 10.63, 10.96
and 11.02): the vocoder softens every attack by about 4 dB in all three, and nothing measured parts before from
after. `method: 'wsola'` keeps 12.3 of it, and the lag and the mono sum as the recording has them; `'transient'`
11.2; `'hybrid'` 10.1 with the channels apart.

## Still open

- **2.15.0's `restore()`** names `@audio/neural-restore`, not on npm. Prepared for release on 11-14
  (`~/.cache/audiojs/neural/hosting/READY-restore.md`); its weights' licence is the owner's to decide (Dialogs'
  OpenRAIL flows down to the model and to what it makes).
- The locked drag (`movementY`) has no test: the suites run without the lock.
- The MP3 parts' fallbacks have no test in the suite (`mpeg-parts/` forces them).
- A processed stage before a stretch is rendered twice (the timeline's read of it, unused inside the range, and
  the vocoder's).
- The bench's analysis rows (LUFS, FFT, MFCC, beat) write no file, so its check of a row's work does not reach
  them: whether `stat spectrum` and `librosa.stft(n_fft=1024)`, or the others, are the same work was not examined.
- `docs/comparison.md`'s stretch and pitch figures are 2.15.0's (11-13); not measured again with the channels
  together.
- CI's `playback` and `recording` advice suites miss their real-time measures on shared runners now and then.

## What did not pay

So that it is not tried again without a new idea:
- Start-up: at most 15 ms of the 44 ms audio adds to Node's, and only by dropping methods; V8's compile cache 6 ms.
- The index on a thread: K-weighting runs in order; started cold before a boundary it matched the serial state at
  3 of 12 seams with 4 s of pre-roll, and moved whole to another thread it is still the longest serial step.
- WAV pages on threads: 260 ms wall at twice the CPU against 280 on one.
- FFmpeg's MP3 lead was not threads: with `-threads 1` it ran the same.
- A scalar WebAssembly port of the lock step: 9.4 µs against JS's 11.8; the gain came from two bins to a
  float64x2 and the rotations filled by region (7.2 µs).
- Locking every free bin to its peak would cut the vocoder's trigonometry by nine tenths (under 0.2 s) and change
  the sound: the library's decision, not made.
- The stretch's profile after both rounds (CLI `stretch 0.8`, with `stretch-source.patch`): lock step 30%, FFT
  22%, STFT framing 14%, the cursor 10%, decode, index and encode 8%, the source read 4%.
