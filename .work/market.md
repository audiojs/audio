# Market: who needs what, and where `audio` fits

Research notes, 2026-09-26; updated 2026-09-27 after two build rounds and a test on ten real recordings. Sources: public web pages (linked at the end), npm and PyPI download counts for 2026-08-26 to 2026-09-24, our own code, and measurements on real files. We have no interviews and no search-volume data, so the order of segments is a guess to test, not a measurement.

Serving > marketing. Protection > power, usefulness > fame, help > greed.

## In short

- People who work with a recording want three things: it sounds finished, it passes the rules of wherever it goes, and it comes out in the right format.
- **Our focus: speech that sounds finished, with proof that it passes.** Podcasters, narrators, course makers and video creators first; ACX is one of the specs, not the product. Music gets the same loop through reference mastering.
- Format jobs are free everywhere; there is little room for us there. Neural cleanup (Adobe Podcast Enhance) leads on bad rooms; ours is statistical, and we say so.
- Built this round: `check` against five delivery specs (CLI, library, MCP, and an editor panel of each rule before and after, with a Before button to hear the original), `roomtone`, `master REF` (Matchering's method on our stack), cut lists for video editors (EDL, FCPXML, OTIO), and recipes that end in a check.
- On ten real amateur narrations: our podcast recipe passes Apple Podcasts on 10 of 10, and our audiobook chain passes every ACX rule on 10 of 10, room tone included (see "What the test showed").
- Second round: `auto` (automatic enhancement) runs 15 to 32 times faster than real time, 4 to 6 times faster than before, and no longer declicks clean speech; Ogg decoding of FLAC, Opus and cut files is fixed. Published 2026-09-27; `audio` depends on the new versions, itself unreleased.
- Every use case raised so far, with its status, is in "Every use case".

## Who uses it now (2026-10-05)

Found by lockfile on GitHub, not guessed: developers. Six terminal music players (five started the same day, 2026-08-25, a class by the look of it; one says it took `audio` "for true pause/resume support") and a Node game on SDL playing its sound effects. None of them is a podcaster. Podcast and audiobook production stays a fit for the engine, but as a product of its own; the library's own users are developers who need sound in JavaScript.

Read downloads on days without a release: 64% of September's 3,195 fell on its four release days (mirrors and scanners fetch each version), the other 26 days averaged 44.

## Who needs what

| Who | The moment it hurts | What they use today | Our fit now |
|---|---|---|---|
| **Podcasters, course makers, YouTubers** (speech) | It sounds amateur: noise, hum, echo, two voices at different levels, long pauses; the platform turns it up or down | Auphonic ($11 to $99/month, uploads, credits), Descript (cloud), Adobe Podcast Enhance (neural, uploads), iZotope RX (expensive) | **Strong**: "Enhance speech" and "Podcast episode" recipes, `check podcast` and a Before/After comparison in the editor. **Weak** on bad rooms: our denoise is statistical, not neural |
| **Narrators** (audiobooks) | ACX rejects the file: noise floor, digital silence instead of room tone, peaks, RMS; pauses too long; a phrase read flat | ACX Check in Audacity, iZotope RX, paid studios | **Strong**: `check acx` (the same measure as ACX Check), the "Audiobook chapter" recipe, `roomtone`, `shrink` for pauses, the editor pitch tool for a phrase's contour, `'ch*.mp3' check acx` for a whole book |
| **Vocalists** (a voice take, singing) | Wants it to sound produced without knowing a vocal chain | Plugins in a DAW, paid presets, LANDR-style services | **Good as a recipe**: "Vocal chain" (de-ess, compress, presence, air, plate, streaming loudness). **Automated**: `auto` measures the take and picks the chain, 15 to 32 times faster than real time |
| **Producers mastering a song** | Wants it to sound like a reference track; LANDR, eMastered and CloudBounce charge to download; Matchering needs Python | LANDR, eMastered, CloudBounce, BandLab, Matchering (11.9k downloads/month) | **Strong**: `master REF` matches the reference's tone in mid and side, its width and its loudness, under -1 dBTP |
| **People polishing AI music** (Suno, Udio) | Muddy, fizzy, flat, smeared stereo | Suno Remaster, Sunofix, de-artifact (neural) | **Partial**: "AI track, settled" recipe (mud cut, fizz tamed dynamically, low end in mono, some dynamics back). The metallic codec sound needs neural tools |
| **Video creators** | Wants pauses cut and the sound fixed, then the same cuts in the picture | Descript, AutoTrim, CapCut | **Good**: `shrink` + `save cuts.edl` (or .fcpxml, .otio); extract, fix and remux the sound of a video |
| **Developers adding audio to an app** | ffmpeg.wasm is 20 to 30 MB; exporting from Web Audio is painful | ffmpeg.wasm, wavesurfer, Tone.js | **Strong**: one engine for preview and export, paged, nothing to install |
| **AI agents** | The ffmpeg MCP servers convert and cut but don't measure | ffmpeg wrappers, CleanAudio (hosted) | **Strong**: `check` gives the agent a pass or fail per rule; a failed check is a result, not a tool error |
| **Batch jobs** (datasets, game audio) | Thousands of files to level and verify | sox, pydub, librosa | **Good**: globs, batch recipes, `check` over a folder |
| Musicians, students, teachers · archivists · linguists | Key and tempo, wobble and clicks, pitch curves | Mixed In Key, Moises, Sonic Visualiser, Praat | Good enough: util pages exist |

## What the test showed

Ten English narrations from Spoken Wikipedia (volunteers recording at home, 2010 to 2026), the first 90 seconds of each: two 16-bit WAVs, seven Ogg Vorbis files at 32 to 48 kHz, stereo and mono. Two more files didn't decode then; both decoder bugs are now fixed (see "Second round").

| Chain | Apple Podcasts (-16 LUFS ±1, ≤ -1 dBTP) | ACX, rules failed across 10 files |
|---|---|---|
| Raw | 0 of 10 | RMS 4, peak 5, noise floor 2, room tone start 8, end 10, sample rate 3 |
| "Enhance speech" (Apple recipe) | **10 of 10** | not aimed at ACX |
| First ACX chain (denoise, level to RMS -20, ceiling -3.5) | | RMS 1 (a very dynamic take), room tone 10; noise floors pushed to -98 to -141 dB: dead silence, which ACX Check warns about |
| **"Audiobook chapter"** (gentle denoise, compressor, level, trim, pad, `roomtone`, 44.1 kHz) | | **none: 10 of 10 pass every rule.** RMS -20.1 to -21.1 dB, peak -3.4 to -3.5, floor -60.3 to -84.4 (no dead silence), room tone 1.5 s before and 2.0 s after |

What we learned:

- **Four of ten raw files had pauses edited to digital silence.** Their noise floor reads -∞. ACX passes that number but rejects the sound; this is exactly the "digital silence instead of room tone" rejection. `roomtone` came out of this.
- **Levelling up raises the room with the voice.** The narrator threads say it ("below -60 dB ... suddenly popping up into the -50's to -40's") and our chain shows it. Order matters: level, then a gentle denoise, then room tone from what is left.
- **A dynamic take needs a compressor before levelling.** One narration (30 dB between peaks and average) fell back to RMS -24.4 through the limiter; with 2.5:1 compression first it passes.
- **Denoising too hard kills the room.** Default OM-LSA took floors to -98 to -141 dB; a gentler setting (gMin -12 dB) leaves a natural -65 to -80 dB.
- **Apple Podcasts is easy to meet; ACX is the hard spec.** Every file passed Apple with the enhance recipe.
- The ACX chain that passes also meets ACX's format: MP3 at 192 kbps CBR (verified frame by frame), 44.1 kHz.
- The closest call is the noisiest room (floor -60.3 dB against a -60 limit). A worse room needs neural denoise.
- The test also found an engine bug: after a crop from the start, `normalize`, `trim` and `shrink` measured the whole source (0.2 LU off on one file). Fixed, with a regression test.

## What narrators get rejected for

From ACX's rejection emails as quoted by narrators' guides, and narrators' own forum threads:

1. **Noise floor over -60 dB**, most often because raising RMS into ACX's window raised the room too ("Floor noise is below -60 dB until I adjust for RMS and peak", Adobe community).
2. **Digital silence instead of room tone**, pasted at the head and tail or cut into pauses.
3. **Peaks over -3 dB** from limiters that ignore inter-sample peaks.
4. **RMS outside -23 to -18 dB.**
5. **Wrong MP3 settings** (128 kbps, or variable bitrate).
6. **Inconsistent chapters**: different rooms or levels across a book.
7. Mouth clicks and breaths (a performance issue, but narrators fix it in editing).

`check acx`, `roomtone`, the true-peak ceiling and `save book.mp3 192k` cover 1 to 5. Chapter consistency (6) is open: a batch check could report the spread of floor and RMS across a book.

## Coverage against iZotope RX and Ozone, for free

| They sell | We have | Status |
|---|---|---|
| Voice/Spectral De-noise | `omlsa`, `wiener`, `specsub` | statistical; neural (`@audio/neural-denoise`) unpublished |
| Dialogue Isolate | none | neural only |
| De-reverb | `dereverb` | spectral (Lebart 2001) |
| De-hum, De-click, De-crackle, De-clip | `dehum`, `declick`, `decrackle`, `declip` | yes |
| Wow & Flutter | `@audio/denoise-dewow` | package published; not wired as an op |
| De-plosive, Breath Control, De-ess, De-wind | `deplosive`, `debreath`, `deesser`, `dewind` | yes |
| Spectral Repair | `repair`, `spectral` | yes |
| Ambience Match | `roomtone` | fills silence with the room; matching across files is open |
| Loudness Control | `normalize` + `check` | yes, with proof |
| Leveler, Dialogue Contour | `leveler`; editor pitch tool | yes |
| Ozone Match EQ | `match` | yes, now mid/side too |
| Ozone reference mastering, Matchering | `master REF` | yes |
| Maximizer | true-peak ceiling, `limiter` | yes |
| Dynamic EQ, multiband, imager, exciter | `dyneq`, `multiband`, `widener`, `midside`, `exciter` | yes |
| Vintage (tape, tube, opto, vari-mu) | `tape`, `tube`, `opto`, `varimu`, `fet` | yes |
| Master Assistant (automatic) | `auto` | yes, 15 to 32 times faster than real time |
| Music Rebalance, stems | `rebalance` (SCNet-large, MIT weights) | @audio/neural-separate 0.2.0 unpublished; its weights to host for the page |

## Built this round

- **`check SPEC`**: acx, podcast (Apple), streaming (Spotify), broadcast (EBU R 128-2023), netflix. Each limit is quoted from its source in `fn/check.js`. In the CLI (exit 1 on a fail, `--json`, a glob checks a whole book), the library (`a.check()`), MCP (a failed check is a result), and the editor (a Check button, a panel of each rule before and after, a Before button that plays the original level-matched to the result).
- **`stat noisefloor`**: ACX Check's measure, ported and tested sample-for-sample (0.000 dB difference).
- **`roomtone`**: digital silence becomes the recording's own room tone.
- **`master REF`**, **`match(ref, { midside: true })`**, **`normalize(ref)`**: reference mastering.
- **Cut lists**: `a.cuts()`, `save x.edl|x.fcpxml|x.otio`; validated with OpenTimelineIO's own readers.
- **Recipes** in the editor, each checked against its spec on real files (20 of 20 runs pass): Podcast episode, Audiobook chapter, Narration tightened, Enhance speech, Remove room echo, Breaths/clicks/pops, Room tone for silence, Master to a reference, Master a song, Vocal chain, AI track settled.
- README, skill (within its 2048-character limit), and a line in audio-decode's README pointing to `audio` (local, not yet published).

## Second round: speed and decoding

Fixed in dependency packages, each with a test against the slow or old form. Published: audio-type 2.8.0, @audio/decode 3.16.2 (vorbis 1.3.3, opus 1.3.2, flac 1.3.5), @audio/resample 1.2.3 (sinc 1.2.0, polyphase 1.1.0), eq-fir 1.0.2, @audio/denoise 0.3.11 (denoise-detect 0.2.0, noise-estimate 1.0.2), @audio/chain 0.1.1.

- **`auto` is 4 to 6 times faster.** CPU time for 90 s of speech: 16.1 → 2.8 s and 24.5 → 5.8 s, so 15 to 32 times faster than real time. "About real time" was wall time on a machine at load average 50.
  - **Declick fired on clean speech** (6 of 10 narrations). Its click test measured how spiky the signal is, and a voice is spiky: each vocal-fold pulse is a small impulse. It now counts isolated impulses per second; a voice's pulses repeat every pitch period, a click doesn't. Clean speech and a sung vowel read 0 per second, real clicks 2.6; declick fires on 0 of 10.
  - **The resampler** computed a sine per filter tap; now from tables, 3 to 8 times faster.
  - **The EQ** convolved directly; now by FFT, 86 times faster on a 511-tap filter.
  - **The noise tracker** rescanned its history every frame; now keeps a running minimum, the same output to the bit, 7.6 times faster.
  - What's left is spread thin: the STFT, filters, the limiter.
- **Resampling** (reported by the transcription work, which compares against librosa's soxr):
  - @audio/resample-sinc cut its filter short when downsampling: ±0.3 dB of ripple, aliases at -32 dB, and a 0.1-sample delay at 3:1. Now full length: flat within 0.01 dB to 0.8 of Nyquist, no delay. Oversampled saturation (tube, tape, softclip) aliases at -90 dB instead of -49.
  - @audio/resample-polyphase output came half a sample early at 2:1 and 3:1, and at 3:1 let aliases through at -35 dB. Now on time, -93 dB at every ratio.
- **Decoding.**
  - Ogg-wrapped FLAC goes to the FLAC decoder.
  - A cut Ogg file (Vorbis, Opus, FLAC) decodes up to the cut. The published decoder threw on some cuts; on 9 of 10 Spoken Wikipedia files cut at 64 KB it returned 0.5 to 4.3 s of noise past the cut at speech level, silently. Now all 10 match ffmpeg sample for sample (to 4e-7).
  - Found on the way: Ogg Opus and Ogg FLAC opened by file path went to the Vorbis decoder (`audio` read too few bytes to tell), and chained Opus streams came out 648 samples long.

## Where we are weak

- **Heavy noise and bad rooms.** Statistical denoise only; neural denoise is unpublished.
- **`audio` itself is unreleased** with this round: 2.7.0 (released 2026-09-27) is the committed state before this work; the working tree points at the new dependency versions.
- **Stems, AI-music artifacts, filler words**: unchanged. Stems wait for demucs-web; artifacts need neural tools; fillers need a word-for-word model (stock Whisper drops "um").
- **Chapter consistency and room tone across a book** are open.
- We can measure but not listen: recipe settings are checked against specs and by numbers, not by ear. They need a human pass.

## What we are not

- Not a DAW or a timeline editor: that's [wavearea](https://github.com/dy/wavearea).
- Not a live audio engine or plugin host: that's the Web Audio API, Tone.js, WAM.
- Not a plugin replacement inside a DAW: free native plugins already cover that.
- Not a hosted service: files stay on the user's machine.
- Not a model maker: we run models others trained, behind a plugin, when a use case needs one.
- Not our own stem splitter or transcriber: we call existing ones.
- Not a video editor: we fix the sound and hand back cut lists.
- Not a judge of taste: we measure and match.
- Not a converter directory: util pages exist to help, not to rank.

## Every use case

Each one raised so far: by you ("you"), by the market research ("research"), or by the test on real files ("test"). Status: **built** (an op or recipe, tested), **fits** (built ops cover it, no recipe yet), **partial**, **candidate** (fits the shape, not built), **waiting** (on a model or standard someone else makes), **not ours**.

**Speech**

| Use case | From | What serves it | Status |
|---|---|---|---|
| Speech enhancement: noise, hum, echo, uneven level | you | "Enhance speech", `auto`, `omlsa`, `dehum`, `dereverb`, `leveler` | built; bad rooms wait for neural denoise |
| Denoise | you | `omlsa`, `wiener`, `specsub` | built (statistical); neural waiting |
| Dereverb | you | `dereverb`, "Remove room echo" | built (spectral) |
| Breaths, mouth clicks, plosives, sibilance | research | `debreath`, `declick`, `deplosive`, `deesser`; "Breaths/clicks/pops" | built |
| Two voices at different levels | research | `leveler` | built |
| Podcast episode to Apple or Spotify | research | "Podcast episode", `check podcast`, `check streaming` | built |
| Audiobook chapter to ACX | research, test | "Audiobook chapter", `check acx`, `roomtone`, a folder checked at once | built; consistency across chapters open |
| Narrator shaping pauses, level and tone (prosody) | you | `shrink`, "Narration tightened"; in the editor, drag a phrase's pitch curve, move a moment in time (`warp`), draw a level envelope | built |
| Removing pauses | you | `shrink`, `trim` | built |
| Removing filler words ("um") | you | none: needs word-level transcription, and stock Whisper drops fillers | waiting |
| AI-voiced content (TTS audiobooks, generated podcasts) | research | TTS leaves digital silence between sentences, ACX's rejection: `roomtone`, `check`, a music bed under `ducker` | fits |
| Lecture, sermon and class archives | research | batch CLI: `dehum omlsa leveler normalize`, `check` over a folder | fits; close to your own community |
| Voice-over auditions and demo reels | research | `check` with the casting sites' specs | candidate: specs not verified |
| Transcription prep (interviews before Whisper) | research | denoise and level | candidate: benefit unmeasured |
| Transcription | research | `@audio/neural-asr` | waiting (unpublished); we call models, not make them |
| Language learning, speech therapy | research | the editor's pitch curve, learner against a model | partial; niche |
| Linguists: pitch curves, formants | research | `stat notes`, the pitch view; Praat does more | partial |

**Music**

| Use case | From | What serves it | Status |
|---|---|---|---|
| Vocalist drops a take, gets it produced | you | "Vocal chain" (de-ess, compress, presence, air, plate, loudness), `auto` | built |
| Automated mastering | you | `auto` | built; fast once published; its reference mode isn't reachable from the op |
| Mastering to a reference (Matchering) | you | `master REF`, `match(ref, { midside: true })` | built |
| Free alternatives to plugins, processing chains | you | about 30 ops matched to RX and Ozone modules (see "Coverage"), recipes | built |
| Polishing AI music (Suno, Udio) | you | "AI track, settled" | partial: the metallic codec sound needs neural tools |
| Stem splitting | you | `vocals` (center channel only) | waiting: demucs-web |
| Music analysis: key, tempo, chords, loudness, spectrum | you | `stat key`, `bpm`, `chords`, `beats`, `notes`, `loudness`, `lra`; spectrogram | built |
| Educators showing what a process does | you | the editor: a script, Before/After at matched loudness, spectrogram, share links | built; no lessons written |
| Musicians practising: slow down, transpose, loop | research | `stretch`, `pitch`, `repeat`; "Slow down", "Shift pitch" | built |
| Sample packs: trim, level, tag key and tempo | research | batch trim, `normalize`, `stat key`, `bpm` | fits; tagging not written |
| Game audio assets | research | Sony ASWG-R001 (-24 LKFS console, -18 portable, ≤ -1 dBTP) as a `check` spec; batch levelling | candidate |

**Video**

| Use case | From | What serves it | Status |
|---|---|---|---|
| Fix the sound of a video | you | extract, process, remux | built |
| Cut pauses, then the same cuts in the picture | you | `shrink`, `save cuts.edl` (or .fcpxml, .otio) | built |
| Broadcast and streaming delivery | research | `check broadcast` (EBU R 128), `check netflix` | built |
| US TV and ads | research | ATSC A/85 (-24 LKFS ±2 LU, ≤ -2 dBTP) as a `check` spec; the 2026-07 revision needs reading first | candidate |
| Editing the picture | you | wavearea and video editors | not ours |

**Developers and agents**

| Use case | From | What serves it | Status |
|---|---|---|---|
| Audio in an app: decode, edit, export in the browser | research | the library, paged, nothing to install | built |
| "Do this to this audio" through an agent | you | MCP server, skill, `check` as a result an agent reads | built |
| An agent inside the browser page | you | WebMCP | waiting |
| Models in the browser (denoise, stems, speech) | you | plugins over neural-denoise, demucs-web, neural-asr | waiting |

**Batch, archives, formats**

| Use case | From | What serves it | Status |
|---|---|---|---|
| Datasets: level and verify thousands of files | research | globs, batch recipes, `check` | built |
| Dataset QA: clipping, DC, digital silence, loudness spread | research | the stats exist (`clipping`, `dc`, `silence`, `loudness`); a "clean" spec does not | candidate |
| Archivists: clicks, crackle, hum | research | `declick`, `decrackle`, `dehum` | built |
| Archivists: wow and flutter (tape wobble) | research | `@audio/denoise-dewow` (published): speed curve from partials, a reference tone or pitch, corrected by variable-rate resampling | fits: not wired as an op in `audio` |
| Converting formats | research | `save x.mp3 192k` and others | built; free everywhere, not a focus |

## The editor

What it has now: a script editor with completion and sliders; the same chain as a CLI command; recipes (including delivery and mastering); open, record or find a sound; waveform and spectrogram; the Check panel (spec picker, each rule before and after, limits, the spec's link); a Before button (or B) that plays the original level-matched to the result; share links; export.

The line with wavearea stays: the editor changes sound through a script, wavearea by hand on a timeline.

Agents: their own agent over MCP works today; WebMCP and in-page API keys wait. What makes any agent good here is what it can measure (stats, `check`), what it can do (operations) and what it knows (the skill).

## How this could fail

1. **The editor keeps growing and the proof gets buried.** The panel exists now; keep it one click from every output.
2. **Recipes that pass the numbers but sound processed.** We can't listen. Sign: a human comparing before and after on the ten files prefers the original. Check before promoting the recipes.
3. **Automation is fast but unheard.** `auto` now picks its chain in seconds; nobody has listened to what it picks. Sign: its output on the ten files loses to "Enhance speech" by ear.
4. **Nobody switches.** Sign: downloads and skill installs flat 8 weeks after `check` ships.
5. **Polish before proof.** 13 of the last 60 commits went to the logo and header mark.

## Next steps

1. **Listen.** Compare before and after on the ten files through "Audiobook chapter" and "Enhance speech" in the editor. The numbers pass; the ear decides the settings.
2. **Release `audio`** with both rounds. The dependency packages are published (audio-type 2.8.0, @audio/decode 3.16.2 (vorbis 1.3.3, opus 1.3.2, flac 1.3.5), @audio/resample 1.2.3 (sinc 1.2.0, polyphase 1.1.0), eq-fir 1.0.2, @audio/denoise 0.3.11 (denoise-detect 0.2.0, noise-estimate 1.0.2), @audio/chain 0.1.1).
3. **Listen to `auto`** against "Enhance speech" on the same ten files.
4. **Chapter consistency** in batch `check`: floor and RMS spread across a book, and one room tone for all chapters.
5. **Recipes for the "fits" rows**: AI-voiced content, lecture archives, sample packs.
6. **Candidate specs** once verified: ASWG-R001 (games), ATSC A/85 (US TV), casting sites (voice-over).
7. **Waiting**: demucs-web (stems), WebMCP (browser agents), neural denoise, word-level transcription (fillers).

## Questions for you

1. The recipes are measured, not heard. Who listens before they're promoted: you, or a narrator you know?
2. AI-voiced content and lecture archives both fit what's built. Is either closer to people you serve than ACX narrators?
3. Is the logo finished for now?

## Sources

- Specs: [ACX requirements](https://help.acx.com/s/article/acx-audio-submission-requirements) · [ACX Check 2.4.2-1 (Audacity plugins)](https://plugins.audacityteam.org/analyzers/loudness-compliance-checks) · [Apple Podcasts](https://podcasters.apple.com/support/893-audio-requirements) · [Spotify](https://support.spotify.com/us/artists/article/loudness-normalization/) · [EBU R 128](https://tech.ebu.ch/docs/r/r128.pdf) · [Netflix v1.6](https://partnerhelp.netflixstudios.com/hc/en-us/articles/360001794307) · [ASWG-R001](http://gameaudiopodcast.com/ASWG-R001.pdf) · [ATSC A/85](https://www.atsc.org/wp-content/uploads/2015/03/Techniques-for-establishing-and-maintaining-audio-loudness.pdf)
- Rejections: [ACX rejection email decoder](https://chapterpass.com/learn/acx-rejection-email-decoder) · [Floor noise rises after levelling (Adobe community)](https://community.adobe.com/t5/premiere-pro-discussions/floor-noise-is-below-60-db-until-i-adjust-for-rms-and-peak/td-p/11419375) · [The noise floor problem](https://headroomstudio.dev/blog/acx-noise-floor.html) · [Why ACX rejects](https://tomevox.com/blog-acx-rejection-reasons)
- Test recordings: [Spoken Wikipedia on Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Spoken_Wikipedia)
- Reference mastering: [Matchering 2.0](https://github.com/sergree/matchering)
- Cut lists: [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO)
- Download counts: `https://api.npmjs.org/downloads/point/2026-08-26:2026-09-24/<package>` · [pypistats: matchering](https://pypistats.org/packages/matchering)
- Voice and podcasts: [Auphonic pricing](https://toolradar.com/tools/auphonic/pricing) · [Adobe Podcast on G2](https://www.g2.com/products/adobe-podcast) · [Descript silence remover](https://www.descript.com/blog/article/best-silence-remover-tools) · [AutoTrim](https://www.autotrim.app/en/guides/remove-filler-words-from-video)
- Developers: [$200 server → browser](https://dev.to/khoanna/i-replaced-a-200month-audio-processing-server-with-40-lines-of-browser-javascript-56ef) · [ffmpeg.audio.wasm](https://github.com/JorenSix/ffmpeg.audio.wasm) · [Export audio on the web](https://danielbarta.com/export-audio-on-the-web/)
- Agents: [video-audio-mcp](https://github.com/misbahsy/video-audio-mcp) · [CleanAudio MCP](https://cleanaudio.app/mcp) · [WebMCP tutorial](https://www.datacamp.com/tutorial/webmcp-tutorial)
- Mastering: [AI mastering shootout](https://www.whippedcreamsounds.com/ai-mastering-shootout/) · [Free AI mastering tested](https://undetectr.com/blog/free-ai-mastering)
- AI music: [Fixing AI artifacts](https://intrect.io/blog/how-to-fix-ai-music-artifacts/) · [Why Suno sounds bad](https://replayedstudio.com/blog/why-suno-song-sounds-bad/)
- Stems and fillers: [demucs-web](https://github.com/timcsy/demucs-web) · [CrisperWhisper](https://arxiv.org/pdf/2408.16589)
- Commodity tools: [MyFreeAudioTool](https://myfreeaudiotool.com/) · [Soniqtools comparison](https://soniqtools.com/blog/best-free-online-audio-tools/)
