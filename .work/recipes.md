# Recipes and scenarios

Researched 2026-10-01. Every script below ran in Node against the working tree (`import audio from 'audio.js'`) and was measured from the rendered file: 46 runs, 0 errors. Numbers are measurements, not listening; a human pass is still owed (see [market.md](market.md), "Recipes that pass the numbers but sound processed").

## Terms

- **Preset**: one op's settings. `normalize('podcast')`, `deesser({ fc: 7500 })`. Already in [playground/ops.js](../playground/ops.js) as `presets`.
- **Recipe**: an ordered chain with settings and a reason per step. It encodes a technique: parallel compression, the Abbey Road send.
- **Scenario**: a goal with a spec. Recipe + `check(spec)` + the measurements that steer it. A scenario passes or fails; a recipe only sounds a certain way.

A scenario is a script, not only a chain. Several measure first and then act: dialogue loudness sets the gain (Netflix, ATSC), per-mic loudness sets the trims (interview), onsets drive the gate (gated reverb). [playground/recipes.js](../playground/recipes.js) already runs `await` inside a recipe, so this needs no new machinery.

For the editor panel and for agents, one entry should carry:

```js
{ group, name, text,        // as now
  code,                     // `$src` = the open sound, as now
  spec,                     // check() key, or null for a technique (as now)
  input: 'speech',          // what it expects: speech | music | stereo | any
  sources: ['https://…'] }  // what the settings rest on
```

An agent told "use scenario `netflix`" runs `code`, then `check(spec)`, and reports each rule. A failing rule names the knob to turn: integrated loudness is the last `normalize`, true peak is its `ceiling`, short-term peaks are the compressor before it. A recipe market needs `sources` plus an author field; the measurements below are what a listing should show.

## How it was verified

Harness (outside the repo, scratchpad): `$src` becomes an awaited `audio(file)`, the script's value is rendered with `save()` to 32-bit float WAV (or the target format: MP3 192k, M4A, 16-bit WAV), the file is re-opened and measured with `stat(['loudness', 'truepeak', 'db', 'rms', 'lra'])`, then `check(spec)` where a spec exists. Where `save()` hits defect D2 (below), the result was rendered with `read()` and the run is flagged.

Inputs:

| File | What | License |
|---|---|---|
| speech.wav | [Spoken Wikipedia, "Angelo Fabroni"](https://commons.wikimedia.org/wiki/File:Angelo_Fabroni_(Spoken_Wikipedia,_English).ogg), first 60 s, mono 44.1 kHz, home narration, -18.7 LUFS, peaks at 0 dBFS | CC BY-SA 3.0 |
| speech2.wav | [Spoken Wikipedia, "Bone Wars"](https://commons.wikimedia.org/wiki/File:Bone_Wars_spoken_Wikipedia_article_(English).ogg), 20 to 80 s, 32 kHz resampled to 44.1 | CC BY-SA 4.0 |
| music.wav | [Kevin MacLeod, "Smoother Move"](https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Smoother_Move.ogg), 30 to 75 s, -25.4 LUFS, LRA 16.1 LU | CC BY 3.0 |
| music2.wav | [Kevin MacLeod, "Clean Soul"](https://commons.wikimedia.org/wiki/File:Kevin_MacLeod_-_Clean_Soul.ogg), 30 to 75 s (reference track, -27.8 LUFS) | CC BY 3.0 |
| field.wav | speech.wav after a 2 s pre-roll, plus gusting brown-noise wind, 60/120/180 Hz hum, pink hiss | derived |
| interview.wav | L = mic A, R = mic B; 15 s turns; B speaks 6 dB quieter; each mic hears the other at -14 dB, 1.5 ms late | derived |
| vinyl.wav | music2 through `lofi({ crackle: 0.4, wow: 0.1 })` | derived |
| tape.wav | music2 with mild wow and pink hiss at -48 dB RMS, after a 1.5 s hiss-only leader | derived |
| drums.wav, kick.wav, pad.wav, sfx.wav | the library's own `kick`, `snare`, a sine chord, `sfx({ preset: 'laser' })`, 120 BPM | generated |

Conventions used throughout:

- **Gain staging first.** Thresholds are absolute dB, so a recipe that compresses starts with `normalize(-18, 'lufs', { ceiling: false })`. That pins the level the thresholds were tuned at, so they behave the same on a quiet and a loud take. -18 is the usual "-18 dBFS = 0 VU" working level; it is a convention, not a rule.
- **The last `normalize` is the limiter.** In LUFS mode it holds a channel-linked true-peak ceiling and makes the loudness back up ([fn/normalize.js](../fn/normalize.js)). The `limiter` plugin is sample-peak and per channel, so deliveries end in `normalize`, not `limiter`.
- "Starting point" marks a number the source does not give; it was set by measurement here.

---

## 1. Delivery scenarios

### The specs

| Target | Loudness | Max peak | Measured as | Also | Source |
|---|---|---|---|---|---|
| Apple Podcasts | -16 LKFS ±1 | -1 dBTP | BS.1770-5 | WAV/FLAC must be stereo (mono: two identical channels); MP3 mono or stereo | [Apple](https://podcasters.apple.com/support/893-audio-requirements) |
| Spotify podcasts | none published | none | | MP3 128k+ or AAC-LC MP4, 12 h max ([delivery spec v1.10](https://assets.ctfassets.net/jtdj514wr91r/4r4op9KhH3fY1t3BKt2eiH/7b1b682acf4c41baf79f9574d6dedd7f/Podcast_Delivery_Specification_v1.10_-_master_doc.pdf)). "-14 LUFS for podcasts" is the music figure reused | [Spotify for Creators](https://support.spotify.com/us/creators/article/podcast-specification-doc/) |
| Spotify podcast ads | -16 LUFS ±1.5 | -2 dBTP | integrated | MP3 44.1 kHz 192 kbps stereo; pre-roll 30 s, mid-roll 60 s max; 0.5 s silence head and tail | [Spotify Ads](https://ads.spotify.com/en-US/guide-to-creating-audio-ads/podcast-ads-minimum-requirements/) |
| AES streaming | speech -18 (+1 LU), dialogue-gated; podcasts/assorted -18 (+2); music track -16, album-loudest track -14 | -1 dBTP at the codec input | | | [AES TD1008](https://aes.org/wp-content/uploads/2024/01/20210924_TD1008_v3.13.pdf) |
| ACX audiobook | RMS -23 to -18 dB | -3 dB | | floor -60 dB RMS; room tone 1 to 5 s each end; MP3 192k+ CBR 44.1 kHz; 120 min per file; all mono or all stereo | [ACX](https://help.acx.com/s/article/acx-audio-submission-requirements) |
| EBU R 128-2023 | -23.0 LUFS; ±0.2 LU QC, ±1.0 LU only live | -1 dBTP; -2 dBTP into AC-3 / MPEG-1 L2 ([Tech 3343](https://tech.ebu.ch/docs/tech/tech3343.pdf)) | BS.1770 gated, Tech 3341 | LRA a descriptor, no maximum | [R 128](https://tech.ebu.ch/docs/r/r128.pdf) |
| EBU short-form (ads, promos) | -23.0 LUFS, max short-term -18.0 LUFS | -1 dBTP | | up to about 2 min | [R 128 s1](https://tech.ebu.ch/docs/r/r128s1.pdf) |
| ATSC A/85:2026-07 (US TV) | -24 LKFS; "±2 dB ... should not be targeted to the high or low side" | -2 dBTP | long-form: dialogue-gated BS.1770-1; short-form: full mix BS.1770-3+ | streaming services: one target in -23 to -27 | [A/85](https://www.atsc.org/wp-content/uploads/2026/07/A85-2026-07.pdf) |
| Netflix | -27 LKFS ±2, dialogue-gated | -2 dBTP | BS.1770-1 | 48 kHz/24-bit; 5.1 required, 2.0 optional | [Netflix mix spec](https://partnerhelp.netflixstudios.com/hc/en-us/articles/360001794307) |
| Spotify music | plays at -14 LUFS (Loud -11, Quiet -19) | -1 dBTP; -2 dBTP if louder than -14 | ITU 1770 | quiet tracks raised only as far as 1 dB of TP headroom | [Spotify](https://support.spotify.com/us/artists/article/loudness-normalization/) |
| Apple Music | not published; -16 LUFS reported | -1 dBTP (Atmos spec) | | Atmos: ≤ -18 LKFS, ≤ -1 dBTP (official) | [Production Expert, 2022](https://www.production-expert.com/production-expert-1/apple-choose-16lufs-loudness-level-for-apple-music-heres-why), [Apple Atmos](https://help.apple.com/itc/videoaudioassetguide/en.lproj/itcf946aaace.html) |
| YouTube | not published; -14 LUFS measured, quiet uploads not raised | | | YouTube Music reduces only above -7 LUFS (measured) | [Shepherd 2015](https://productionadvice.co.uk/youtube-loudness-normalisation-details/), [2023](https://productionadvice.co.uk/youtube-music/) |
| Tidal, Amazon, Deezer | -14, -14, -15 LUFS (reported, not published) | | Tidal: album-loudest track, attenuate only | | [AudioXpress](https://audioxpress.com/news/tidal-implements-album-loudness-normalization-and-activates-it-by-default-for-mobile-players), [MeterPlugs](https://www.meterplugs.com/blog/2019/10/15/loudness-penalty-amazon-deezer.html) |
| PlayStation (ASWG-R001 v1.10) | home -24 ±2 LKFS, portable -18 ±2 | -1 dBTP | BS.1770-3, over 30+ min of gameplay | v1.10 moved -23 to -24 "to bring us into line with ... ATSC ... and ARIB" | [ASWG-R001](http://gameaudiopodcast.com/ASWG-R001.pdf) |
| Telephone | | | | G.711: 8 kHz, 8-bit, µ-law or A-law; G.712 channel 300 to 3400 Hz; Amazon Connect prompts: 8 kHz .wav, under 5 min and 50 MB | [G.711](https://www.itu.int/rec/T-REC-G.711), [G.712](https://www.itu.int/rec/T-REC-G.712/en), [Amazon Connect](https://docs.aws.amazon.com/connect/latest/adminguide/prompts.html) |
| iPhone ringtone | | | | 30 s max | [Apple](https://support.apple.com/en-us/120692) |
| Voice-over | no standard | | | convention: 44.1 or 48 kHz, 24-bit, "raw" = no noise reduction, compression, limiting or vocal EQ; a high-pass is fine | [Jim Edgar](https://justaskjimvo.studio/vo-answerbase/), [settings](https://justaskjimvo.studio/numbers-we-need/) |
| Archive transfer (IASA TC-04) | | | | at least 48 kHz and 24-bit; no data reduction; "subjective signal enhancement ... must only be applied on a copy" | [TC-04 §2](https://www.iasa-web.org/tc04/key-digital-principles), [IASA ethics](https://www.iasa-web.org/ethical/222-technical-processing-and-preservation) |

`check()` covers acx, podcast, streaming (Spotify), broadcast (R 128), netflix. Not covered: ATSC, R 128 s1, Spotify ads, ASWG (see Gaps).

### Podcast episode (Apple Podcasts)

Pain: the episode plays quieter or louder than the rest of the feed, or distorts on a phone.

1. `highpass(80)`: rumble, handling, plosive energy below the voice.
2. `omlsa({ gMin: -12 })`: steady noise down at most 12 dB, so the room stays a room. The default (-20) drove floors to dead silence in [pro.md](pro.md).
3. `normalize(-16, 'lufs', { ceiling: false })`: stage the level so the de-esser threshold means the same on every take.
4. `deesser({ mode: 'band', threshold: -30 })`: split-band, only the sibilant band moves.
5. `normalize('podcast')`: -16 LUFS, true peak held at -1 dBTP.

```js
$src
  .highpass(80)
  .omlsa({ gMin: -12 })
  .normalize(-16, 'lufs', { ceiling: false })
  .deesser({ mode: 'band', threshold: -30 })
  .normalize('podcast')
```

Measured: speech -18.70 → -16.00 LUFS, -1.00 dBTP; speech2 -17.96 → -16.00, -1.00. `check('podcast')` passes both. This is the existing "Podcast episode" recipe. Compression is left out on purpose: [gpu.md](gpu.md) measured that it lowered PESQ in the speech chain. Spotify publishes no podcast loudness, so one -16 master serves both; AES TD1008 puts podcasts at -18 (+2 LU), which -16 meets.

### Spotify podcast ad

Pain: an ad rejected for level or length; the only spoken-word loudness spec Spotify publishes.

```js
$src
  .crop({ at: 0, duration: 29 })
  .highpass(80)
  .normalize(-16, 'lufs', { ceiling: -2 })
  .pad(0.5, 0.5)
  .remix(2)
  .resample(44100)
// save('ad.mp3', { bitrate: 192 })
```

Measured from the 192 kbps MP3: 30.00 s, -16.31 LUFS (in ±1.5), -2.26 dBTP after encoding. The -2 dBTP ceiling survived the codec. Reading the MP3 back reports 1 channel (defect D5); ffprobe reports 2.

### Audiobook chapter (ACX)

Pain: ACX rejects for RMS, peak, noise floor or room tone. The hardest spoken-word spec.

1. `highpass(80)`, `omlsa({ gMin: -12 })`: floor under -60 dB without reaching digital silence.
2. `compressor({ threshold: -24, ratio: 2.5 })`: narrows peak-to-RMS so -20 dB RMS fits under -3 dB peaks (measured: -8.4 LU average reduction, PLR 17.4 → 21.9 because the 5 ms attack lets peaks through; the ceiling below takes them).
3. `normalize(-20, 'rms', { ceiling: -3.5 })`: the middle of -23 to -18, half a dB under the peak limit.
4. `trim().pad(1.5, 2).roomtone()`: room tone, not digital silence, at each end.
5. `resample(44100)`.

```js
$src
  .highpass(80)
  .omlsa({ gMin: -12 })
  .compressor({ threshold: -24, ratio: 2.5 })
  .normalize(-20, 'rms', { ceiling: -3.5 })
  .trim()
  .pad(1.5, 2)
  .roomtone()
  .resample(44100)
// save('chapter.mp3', { bitrate: 192 })
```

Measured: speech: RMS -20.26 dB, peak -3.50, floor -63.8 dB, room tone 1.51 s / 1.99 s, 44.1 kHz, pass. speech2: RMS -20.30, floor -89.7 dB (0.3 dB from ACX Check's "dead silence" warning), pass. RMS lands 0.26 dB under target: defect D7.

### Broadcast programme (EBU R 128)

```js
$src.highpass(80).normalize('broadcast')
```

Measured: speech -23.00 LUFS, -5.55 dBTP, LRA 5.3 LU, pass. music (`normalize('broadcast')` alone) -23.00, -5.21 dBTP, LRA 16.1, pass. The music's max short-term is -16.8 LUFS: it would fail as an ad (next).

### Broadcast ad or promo (EBU R 128 s1)

Pain: short-form must hit -23 LUFS and keep max short-term at or under -18 LUFS (+5 LU), so it cannot be loud by peaks.

```js
$src
  .crop({ at: 0, duration: 30 })
  .normalize(-23, 'lufs', { ceiling: false })
  .compressor({ threshold: -26, ratio: 2, attack: 50, release: 1000 })
  .normalize('broadcast')
```

A slow compressor 3 dB under the target trims the 3 s windows without touching transients. Measured: -23.00 LUFS, max short-term -18.80 (input after plain `normalize`: -17.3, fail), -7.23 dBTP. Starting point: 2:1, 50 ms, 1 s. Lowering the integrated target instead fails the ±0.2 LU rule (tried: -23.64).

### US television (ATSC A/85)

Long-form is measured on dialogue, not the full mix. Normalize so the dialogue, not the programme, lands on -24: integrated target = -24 + (programme − dialogue).

```js
let a = $src.highpass(80)
let [L, D] = await a.stat(['loudness', 'dialog'])
a.normalize(-24 + L - D, 'lufs', { ceiling: -2 })
```

Measured: dialogue -24.00 LUFS, programme -24.26, -6.81 dBTP. `stat('dialog')` gates by VAD, while A/85 names a BS.1770-1 meter with a dialogue gate; expect small differences from Dolby Dialogue Intelligence.

### Streaming film or series (Netflix)

Same move at -27 with a -2 dBTP ceiling.

```js
let a = $src.highpass(80)
let [L, D] = await a.stat(['loudness', 'dialog'])
a.normalize(-27 + L - D, 'lufs', { ceiling: -2 })
```

Measured: dialogue -27.00 LUFS, -9.81 dBTP, `check('netflix')` passes. The existing editor list has the spec but no recipe for it.

### Music master for streaming

Pain: the master gets turned down and sounds smaller than the reference, or clips after AAC/Ogg encoding.

```js
$src
  .highpass(20, 4)
  .normalize(-18, 'lufs', { ceiling: false })
  .vca({ threshold: -24, ratio: 2, attack: 30, release: 300 })
  .normalize(-14, 'lufs', { ceiling: -1 })
```

Measured: -14.00 LUFS, -1.00 dBTP, LRA 16.1 → 13.3, `check('streaming')` plays as is. -14 is Spotify's playback level, not a mastering target: louder masters are only turned down, and Ian Shepherd argues for mastering by ear and checking the penalty instead ([productionadvice](https://productionadvice.co.uk/no-lufs-targets/)). Set the last line to the loudness the music wants; keep -1 dBTP, or -2 if louder than -14 (Spotify).

### Master to a reference (Matchering)

Matchering matches "the same RMS, FR, peak amplitude and stereo width" as a reference ([sergree/matchering](https://github.com/sergree/matchering)): level matching on the loudest pieces, mid and side FIR frequency matching, iterative RMS correction, then its Hyrax limiter ([stages.py](https://github.com/sergree/matchering/blob/master/matchering/stages.py)). Ours: `match` in mid/side, then BS.1770 integrated loudness of the reference under -1 dBTP.

```js
$src.master(audio('reference.wav'))
```

Measured: output -27.84 LUFS, exactly the reference's -27.84, -10.13 dBTP. A quiet reference gives a quiet master: pick a finished commercial master.

### Voice-over, raw delivery

Pain: an agency rejects processed audio; the editor wants to do the processing.

```js
$src
  .highpass(80)
  .resample(48000)
// save('vo.wav', { bitDepth: 24 })
```

Measured: 48 kHz 24-bit, level untouched (-18.76 LUFS, -1.30 dBTP). The point is what it leaves out. An agent asked for "VO delivery" should not reach for `normalize('podcast')`.

### Phone prompt (IVR, on-hold)

Pain: prompts sound muffled or clip after the PBX converts them.

```js
let a = $src.highpass(100).remix(1).resample(8000)
let [L, D] = await a.stat(['loudness', 'dialog'])
a.normalize(-18 + L - D, 'lufs', { ceiling: -3 })
// save('prompt.wav')   // 8 kHz PCM; G.711 µ-law/A-law output is a gap
```

Resample before leveling: resampling after a ceiling moved true peak from -3.00 to -2.77 in an earlier version. -18 LUFS dialogue is AES TD1008's speech level, chosen here because no telephony prompt loudness was found; -3 dBTP leaves room for µ-law. Measured: 8 kHz, dialogue -18.00 LUFS, -3.00 dBTP.

### Game audio (PlayStation ASWG-R001)

The spec is for the game's whole output over 30+ minutes, so these apply to a trailer, cinematic or menu loop, not to one asset.

```js
$src.normalize(-24, 'lufs', { ceiling: -1 })   // home console
$src.normalize(-18, 'lufs', { ceiling: -1 })   // portable
```

Measured: -24.00 / -6.21 dBTP and -18.00 / -1.00 dBTP. A single SFX asset has no published spec; common prep:

```js
$src
  .trim(-60)
  .fade(0.002, 0.02)
  .highpass(30)
  .resample(48000)
  .normalize(-1)
```

Measured: 0.23 s, peak -1.00 dBFS but -0.80 dBTP. Peak mode is sample peak; under 0.4 s integrated loudness does not exist (no gating block), so a short asset has only a peak to normalize. See Gaps (true-peak normalize).

### Ringtone (iPhone)

```js
$src
  .crop({ at: 0, duration: 30 })
  .fade(0.5, 2)
  .normalize(-1)
// save('ringtone.m4a')  // rename to .m4r: save() rejects 'm4r' (gap)
```

Measured: M4A, 30.00 s, -1.01 dBTP. The 30 s limit is Apple's; the existing recipe already crops to 30.

---

## 2. Repair

### Order of operations (iZotope)

"Always try to tackle the deepest damage first": de-clip, azimuth, de-click, de-hum, spectral de-noise, voice de-noise, then breaths, de-ess, dialogue isolation ([iZotope](https://www.izotope.com/en/learn/order-of-audio-repair-operations.html)). Each artifact left in feeds the next tool's estimate.

```js
$src
  .declip()
  .declick()
  .dehum({ freq: 60, harmonics: 3 })
  .denoise(15, { noise: { at: 0, duration: 1.5 } })
  .debreath()
  .deesser({ mode: 'band', threshold: -30 })
  .normalize('podcast')
```

Azimuth has no op (gap). Measured on field.wav: floor -66.4 dB, -16.00 LUFS, -1.00 dBTP, pass.

### Field recording

Pain: wind, hum and hiss under a location voice.

1. `dewind()`: adaptive high-pass that follows gusts, before anything that estimates noise.
2. `highpass(100, 4)`: what wind leaves below the voice.
3. `dehum({ freq: 60, harmonics: 3 })`: 60 Hz mains (50 Hz outside the Americas).
4. `denoise(15, { noise })`: learned from the pre-roll where the noise plays alone. Record 1 to 2 s of it on location.

```js
$src
  .dewind()
  .highpass(100, 4)
  .dehum({ freq: 60, harmonics: 3 })
  .denoise(15, { noise: { at: 0, duration: 1.5 } })
  .normalize('podcast')
```

Measured: noise floor -65.0 dB, -16.00 LUFS, -1.00 dBTP, pass. Without a quiet pre-roll, use `omlsa({ gMin: -12 })` or `deepfilter()`.

### Interview, two mics

Pain: one guest 6 dB quieter, each mic full of the other voice.

1. Measure each mic's loudness and trim both to -20: the speakers now start level.
2. `expander` (per channel, as all dynamics here are unlinked): the other voice's bleed is 14 dB down, so pushing 20 dB of range below -40 removes it between turns.
3. `leveler`: rides each mic toward -20 through the phrase.
4. `remix(1)`, `normalize('podcast')`.

```js
let a = $src.highpass(80)
let [l, r] = await a.stat('loudness', { channel: [0, 1] })
a.gain(-20 - l, { channel: 0 })
  .gain(-20 - r, { channel: 1 })
  .expander({ threshold: -40, ratio: 3, range: 20, release: 150 })
  .leveler({ target: -20, frame: 0.5, maxGain: 10 })
  .remix(1)
  .normalize('podcast')
```

Measured: speakers 6 dB apart in → turns at -16.3 and -14.4 LUFS out (1.9 LU apart; 2.9 without the leveler), episode -16.00, pass. The per-mic measurement includes bleed, which is why trims alone leave a gap. Settings are starting points; the canonical tool is a gain-sharing automixer (gap).

### Vinyl transfer, access copy

Pain: clicks, crackle, rumble.

1. `declick()`, `decrackle()`: impulses first, then the dense small ones.
2. Side-only high-pass at 100 Hz: rumble is "mostly vertical ... a difference signal in stereo reproduction", so a filter on the difference removes it "without loss of bass" ([Wikipedia, rumble](https://en.wikipedia.org/wiki/Rumble_(noise)), after Macaulay, Wireless World 1978). The same move as mastering's mono bass (below). 100 Hz is a starting point.
3. `highpass(20, 4)`: subsonic warp.

```js
$src
  .declick()
  .decrackle()
  .midside({ mode: 'encode' })
  .highpass(100, 4, { channel: 1 })
  .midside({ mode: 'decode' })
  .highpass(20, 4)
```

Measured: second-difference spikes over 0.05 (clicks): 521 → 2, loudness -27.95 → -28.05. Keep the flat transfer as the preservation copy (IASA, table above). A flat transfer needs RIAA de-emphasis (75, 318, 3180 µs: [RIAA](https://en.wikipedia.org/wiki/RIAA_equalization)), not an op yet.

### Tape transfer, access copy

```js
$src
  .denoise(12, { noise: { at: 0, duration: 1.4 } })
  .highpass(20, 4)
```

Hiss learned from the leader. Measured: leader hiss -48.3 → -61.5 dB RMS (13 dB for 12 asked). IASA: Dolby/dbx "decoding is better undertaken at the time of transfer", and undocumented cassettes "should be made flat" ([TC-04 5.4.11](https://www.iasa-web.org/tc04/magnetic-tapes-noise-reduction)). Decoders, azimuth and wow correction are gaps.

---

## 3. Mix and master techniques

### Parallel ("New York") compression

Robjohns ([SOS, Feb 2013](https://www.soundonsound.com/techniques/parallel-compression?page=2)): threshold -23 dBFS, ratio 50:1, "just over 20dB of gain reduction" near full scale, the compressed path "mixed at unity gain with the direct path". It "leaves the loud bits unaffected and raises the quiet bits by 6dB".

```js
let dry = $src
let wet = dry.clone().compressor({ threshold: -23, ratio: 20, knee: 0, attack: 0.1, release: 100 })
dry.mix(wet)
```

20:1 is the plugin's maximum; the 0.1 ms attack keeps transients out of the wet path. Measured on drums: kick tail +5.0 dB (Robjohns' model: +6), hit +1.0 dB, integrated +0.3 LU; true peak 0.91 → 2.25 dBTP, so trim after it. Threshold sits about 22 dB under the input's peaks; move it with the material.

### Series compression: 1176 into LA-2A

Universal Audio: the 1176 "tames loud transients with the fast attack", then the LA-2A "smooths dynamic range" ([UA](https://www.uaudio.com/blogs/ua/uad-spotlight-ua-1176-la-2a)): 1176 fast attack, fast release, 4:1 or 8:1. Hardware: 1176 attack 20 to 800 µs, release 50 ms to 1.1 s ([1176LN manual](https://media.uaudio.com/assetlibrary/1/1/1176ln_manual.pdf)); LA-2A release "0.06 seconds for 50% release, 0.5 to 5 seconds for complete release" ([LA-2A manual](https://media.uaudio.com/assetlibrary/l/a/la-2a_manual.pdf)).

```js
$src
  .highpass(80)
  .normalize(-18, 'lufs', { ceiling: false })
  .fet({ threshold: -12, ratio: 4, attack: 0.2, release: 50 })
  .opto({ threshold: -20, ratio: 3 })
  .normalize(-18, 'lufs')
```

Measured per stage: `fet` -2.1 dB average and -3.0 dB on true peak; `opto` -2.7 dB average and 0 on peaks. Each does the job UA assigns. LRA 5.3 → 2.7 LU. Thresholds are starting points for -18 LUFS staging.

### Chris Lord-Alge, lead vocal

His words ([SOS, May 2007](https://www.soundonsound.com/techniques/secrets-mix-engineers-chris-lord-alge)): "blue 1176 compression, 4:1, quick release", "de-essing with the Dbx 263x", delays "tempo-set to quarter or eighth notes", a tape slap "at 15ips with varispeed".

```js
let bpm = 120
$src
  .highpass(80)
  .normalize(-18, 'lufs', { ceiling: false })
  .fet({ threshold: -16, ratio: 4, attack: 0.2, release: 50 })
  .deesser({ mode: 'band', fc: 7500, Q: 1, threshold: -30 })
  .delay({ time: 60 / bpm / 2, feedback: 0.2, mix: 0.15 })
  .normalize(-18, 'lufs')
```

The FET works hard here: -4.4 dB average. Measured: LRA 3.15 LU, -1.86 dBTP. Feedback and mix are starting points. He reports the setting for one record, not a formula.

### Andrew Scheps, parallel vocal compression

His words ([Owsinski, 2017](https://bobbyowsinskiblog.com/2017/10/25/andrew-scheps/)): parallel compressors "just for the lead vocal: one that's sort of spitty and grainy and one that's sort of fat". The two characters are his; the settings below are mine.

```js
let dry = $src.highpass(80).normalize(-18, 'lufs', { ceiling: false })
let grainy = dry.clone().fet({ threshold: -30, ratio: 20, attack: 0.02, release: 50 }).transistor({ drive: 3 })
let fat = dry.clone().opto({ threshold: -30, ratio: 6 }).lowshelf(150, 3)
dry.mix(grainy, 0, -12).mix(fat, 0, -9).normalize(-18, 'lufs')
```

Measured: -18.00 LUFS, -1.00 dBTP, LRA 4.8 LU. `save()` fails on it ("Unknown op: transistor", D2); it ran via `read()`.

### Pultec low-end trick

Boost and attenuate the same low frequency on an EQP-1A: "because the boost and cut circuits are not exact reciprocals ... a low-frequency boost with a cut about an octave higher" ([Robjohns, SOS, Feb 2019](https://www.soundonsound.com/reviews/pulse-techniques-eqp-1a)). Approximation with biquads:

```js
$src
  .lowshelf(60, 4)
  .eq(120, -2, 1)
```

Measured response: 30 Hz +3.6, 60 Hz +1.4, 120 Hz -1.8, 240 Hz -0.6, 1 kHz 0.0 dB. Boost below, dip an octave up, as described. The passive curve shapes themselves are not modeled (gap).

### Abbey Road reverb send

Owsinski ([2010](http://bobbyowsinski.blogspot.com/2010/04/secret-of-abbey-road-reverb.html)): roll off "below 600Hz and above 10kHz" at "12dB per octave", on the send "before it hits the reverb". Mud and fizz never enter the reverb.

```js
let dry = $src
let send = dry.clone().highpass(600).lowpass(10000).plate({ decay: 0.6, damping: 0.3, mix: 1 })
dry.mix(send, 0, -12)
```

Order 2 is the 12 dB/octave he gives. `mix(send, 0.02, -12)` adds 20 ms of pre-delay (the plate has none). Measured: +0.06 LU: the send adds space, not level. -12 is a starting point.

### Mix-bus glue (SSL G-series bus compressor)

Controls: attack 0.1 to 30 ms, release 0.1 to 1.2 s or auto, ratio 2:1, 4:1, 10:1; 2:1 "relatively subtle and transparent", auto release "tended to leave it set in that mode" ([Robjohns, SOS 2006](https://www.soundonsound.com/reviews/ssl-xlogic-g-series-compressor)). Detection is linked: "the dominant, ie. louder channel, controls the gain reduction", with a sidechain high-pass ([SSL](https://www.solidstatelogic.com/assets/uploads/downloads/SSL_500_Series_G_Comp_Module_User_Guide.pdf)).

```js
$src
  .normalize(-18, 'lufs', { ceiling: false })
  .vca({ threshold: -24, ratio: 2, attack: 30, release: 300 })
```

Measured: about 1 dB average, 1.1 dB on peaks, LRA 16.1 → 14.8. Our `vca` is unlinked, has no auto release and no sidechain filter (gaps), so on a wide mix it can move the image.

### Mastering chain, dither last

Order: corrective EQ, glue, tonal EQ, the limiter, sample-rate conversion, then dither. Dither "must be the absolute last edit ... Any effect applied after dithering, even a slight gain adjustment, or a sample-rate conversion, can undermine" it ([iZotope](https://www.izotope.com/community/blog/what-is-dithering-in-audio)).

```js
$src
  .highpass(20, 4)
  .normalize(-18, 'lufs', { ceiling: false })
  .eq(250, -1, 1)
  .vca({ threshold: -24, ratio: 2, attack: 30, release: 300 })
  .highshelf(10000, 1)
  .normalize(-14, 'lufs', { ceiling: -1 })
  .resample(44100)
  .dither(16)
// save('master.wav', { bitDepth: 16 })
```

Measured from the 16-bit file: -14.00 LUFS, -1.00 dBTP, LRA 13.4. The EQ moves are placeholders for what the material asks.

K-System (Katz): 0 on the meter sits 20, 14 or 12 dB below full scale; K-14 for "moderately-compressed high-fidelity productions", K-12 for broadcast; RMS "calibrated as per AES-17", so a sine reads its peak ([digido](https://www.digido.com/portfolio-item/level-practices-part-2/)). K-14's 0 is therefore -17.01 dBFS true RMS. `normalize(-14 - 3.01, 'rms', { ceiling: -1 })` measured whole-file RMS -18.00 (D7) and -14.66 LUFS. A K-meter is a monitoring practice with 600 ms ballistics, not a whole-file RMS, so this is a rough mapping.

### De-essing

Mike Senior ([SOS, May 2009](https://www.soundonsound.com/techniques/techniques-vocal-de-essing)): sibilance "usually focused somewhere in a region from 4-10kHz", around 5 kHz on male voices, higher on female; high-pass the detector "at around 4kHz", or add "a whopping peak EQ boost at about 7.5kHz"; de-ess "post-compression and post-EQ"; too much and the singer is "lisping". FabFilter: "around 8 to 10 kHz" ([Pro-DS](https://www.fabfilter.com/help/pro-ds/using/basiccontrols)).

```js
$src
  .normalize(-18, 'lufs')
  .deesser({ mode: 'band', fc: 7500, Q: 1, threshold: -35, ratio: 4 })
```

Q 1 at 7.5 kHz spans roughly Senior's region. Measured: band over 4 kHz -31.6 → -35.2 LUFS (3.5 dB), broadband -0.08 LU.

### Haas widening

The Haas window is "5-35 ms"; the catch: the parts "will disappear or, at best, change in tone and level when mixed to mono" ([Houghton, SOS, Aug 2015](https://www.soundonsound.com/sound-advice/q-can-haas-delays-be-mono-compatible)).

```js
$src.remix(2).haas({ time: 15 })
```

Measured: correlation 0.02; the mono sum (L+R)/2 is -21.59 LUFS against -18.70 for the source: 2.9 dB lost to comb filtering. Use it on parts that can afford that. `haas({ channel: 'right' })` crashes (D3).

### Mono bass (mid/side)

A high-pass on the side channel is "exactly the same thing" as a bass-mono plugin ([Robjohns, SOS, Aug 2021](https://www.soundonsound.com/sound-advice/q-how-do-you-make-only-low-frequencies-mono)).

```js
$src
  .midside({ mode: 'encode' })
  .highpass(120, 4, { channel: 1 })
  .midside({ mode: 'decode' })
```

Measured: correlation below 100 Hz 0.857 → 0.987. 120 Hz is a starting point. Any M/S EQ follows the same pattern, e.g. `.highshelf(8000, 2, { channel: 1 })` for air on the sides.

### Slapback

Sun Studio's tape slap measured at 134 to 137 ms on Elvis's "Tryin' to Get to You", one mono repeat ([Halmrast, ARP 2019](https://www.arpjournal.com/asarpwp/wp-content/uploads/2021/12/Tor-Halmrast_ARP2019.pdf)).

```js
$src.remix(1).delay({ time: 0.135, feedback: 0, mix: 0.25 })
```

`mix` crossfades dry and wet: 0.25 puts the repeat 9.5 dB under the dry and lowers the dry 2.5 dB (measured -2.08 LU).

### ADT (automatic double tracking)

Ken Townsend, Abbey Road, 1966: a second tape machine "delayed by a few milliseconds", with "an oscillator ... to vary the speed of the second machine, providing variation in delay and pitch" ([Wikipedia](https://en.wikipedia.org/wiki/Automatic_double_tracking), after Lewisohn and Martin).

```js
$src.chorus({ rate: 0.3, depth: 0.3, delay: 0.006, voices: 1 })
```

One voice sweeping 4.2 to 7.8 ms at 0.3 Hz: about 6 cents of drift. `chorus` sums dry and wet 50/50 and halves (measured -2.5 LU). Delay and rate are starting points inside "a few milliseconds".

### Gated reverb

Hugh Padgham: the room mic "had a very heavy compressor on it" and the SSL's gate cut it ([MusicTech, 2019](https://musictech.com/features/interviews/hugh-padgham-on-gated-reverb-effect-and-evolving-technology/)); "going from all to nothing in milliseconds" ([MusicRadar, 2014](https://www.musicradar.com/news/drums/classic-drum-sounds-in-the-air-tonight-590970)). Our gate has no key input, so the drum's onsets drive a gain envelope on the compressed reverb: a keyed gate with a 250 ms hold.

```js
let dry = $src
let hits = await dry.stat('onsets'), t = [], v = []
for (let h of hits) t.push(h, h + 0.002, h + 0.25, h + 0.26), v.push(-80, 0, 0, -80)
let room = dry.clone()
  .fdn({ decay: 0.8, damping: 0.2, mix: 1 })
  .compressor({ threshold: -30, ratio: 8, attack: 1, release: 50 })
  .gain({ t, v })
dry.mix(room, 0, -6)
```

Measured: 0.3 to 0.45 s after a hit -39.6 dB against -14.7 dB in the body: the tail is cut. The 250 ms hold and compressor settings are starting points; hits closer than 0.26 s need a shorter hold.

### Sidechain pumping

A pad ducked by the kick; the threshold "approximately -30dB for pronounced throb", "increase the ratio for some serious throbbing" ([Vincent, SOS, Sept 2024](https://www.soundonsound.com/techniques/studio-one-how-do-side-chaining)).

```js
$src.ducker({ key: audio('kick.wav'), threshold: -12, ratio: 10, range: -12, attack: 1, release: 150 })
```

The kick here peaks near -1 dBFS, so -12 lets only its attack trigger; at -20 its tail kept the pad 4.2 LU down on average. The source's -30 suits a quieter key. Measured per beat: -9 dB at the kick, back to about -2 dB by the next; depth 13.9 dB in 10 ms windows.

### Music bed under a voice

```js
let voice = audio('speech.wav')
$src
  .crop({ at: 0, duration: 30 })
  .gain(-6)
  .ducker({ key: voice, threshold: -40, range: -15, attack: 20, release: 500 })
  .mix(voice)
  .normalize('podcast')
```

The README's own pattern. Measured: -16.00 LUFS, -1.94 dBTP, pass. Unsourced settings: 15 dB of duck, 500 ms release so the bed does not breathe between words.

---

## 4. Character

### Telephone

ITU-T G.712 specifies the channel "over the frequency range 300 Hz to 3400 Hz" ([G.712](https://www.itu.int/rec/T-REC-G.712/en)).

```js
$src
  .remix(1)
  .highpass(300, 4)
  .lowpass(3400, 4)
  .distortion({ drive: 0.2 })
  .normalize(-18, 'lufs')
```

Measured: -18.00 LUFS, -6.65 dBTP. The existing "Telephone" recipe ends at `distortion({ drive: 0.3 })`: measured -9.48 LUFS, sample peak 0.00 dBFS, +0.38 dBTP, 9 LU louder than its input. Add the final `normalize`. A real µ-law path would be `resample(8000)` plus companding (gap).

### AM radio

Orban's AM processor limits bandwidth "in 500Hz increments between 4.5 kHz and 9.5 kHz" (9.5 kHz for NRSC-1) and pre-emphasizes "to help overcome the high-frequency rolloff of typical AM radios" ([Optimod TRIO manual](https://bgs.cc/content/ORB-TRIO%20MANUAL.pdf)). The effect is the receiver: mono, 4.5 kHz, compressed, with hiss.

```js
let a = await $src
let hiss = audio.from(t => 0.01 * (Math.random() * 2 - 1), { duration: a.duration })
a.remix(1)
  .mix(hiss)
  .highpass(100, 4)
  .lowpass(4500, 8)
  .compressor({ threshold: -24, ratio: 4 })
  .normalize(-18, 'lufs')
```

Hiss before the filters, so the receiver band shapes it too. Built with `audio.from` rather than `noise()`: a registry op inside a mixed source breaks `save()` (D2). Measured: -18.00 LUFS, -1.17 dBTP.

### Broadcast processor (Optimod-style)

Orban's chain: "a gentle AGC that is ordinarily used to slowly ride gain, keeping long-term average drive levels into the following multiband compressor stage constant", then "a five-band compressor" with a clipper inside the crossover, then "a safety clipper and overshoot compensator" (same manual). The FM output is "switchable to 50µs or 75µs" pre-emphasis, and its chain includes a 15 kHz low-pass (same manual).

```js
$src
  .leveler({ target: -18, frame: 3, maxGain: 10 })
  .multiband({ low: 150, high: 3000, threshold: -30, ratio: 4, attack: 5, release: 200, makeup: 6 })
  .softclip({ drive: 1.5, oversample: 4 })
  .lowpass(15000, 8)
  .normalize(-11, 'lufs', { ceiling: -1 })
```

Measured: -11.00 LUFS, LRA 16.1 → 7.0 LU. Our multiband has 3 bands, not 5; no pre-emphasis op (gaps). The loudness is a choice for the effect, not a broadcast spec.

### SP-1200 grit

"26.04 kHz 12-bit samples"; a "reconstruction filter was deliberately omitted, resulting in a brighter sound due to imaging" ([Wikipedia](https://en.wikipedia.org/wiki/E-mu_SP-1200)).

```js
$src.bitcrusher({ bits: 12, rate: 26040 / 44100 })
```

No low-pass after it: the missing filter is the sound. Level unchanged (-25.36 LUFS). The existing `lofi()` recipe covers the tape-and-vinyl flavor.

---

## 5. What playground/recipes.js has, and what changes

Measured in the same harness where marked.

| Existing | Verdict |
|---|---|
| Podcast voice, Enhance speech (+ neural), Reduce noise (+ neural), Remove room echo, Breaths/clicks/pops, Shorten pauses, Room tone for silence, Repair clipping | keep. Enhance speech on field.wav: -16.00 LUFS, pass |
| Remove hum (`dehum({ freq: 50 })`) | keep; name the 60 Hz variant |
| Restore vinyl (`declick().decrackle().highpass(30)`) | replace with §2 Vinyl: the same click removal (521 → 2 spikes, both), plus rumble taken from the side channel only |
| Repair clipping | keep; precede the §2 order recipe |
| Loudness for streaming / for broadcast | keep; the broadcast one pairs with the new R 128 s1 entry |
| Measure loudness | keep |
| Audiobook chapter (+ neural) | keep; passes ACX on both inputs here |
| Podcast episode | keep, as the §1 podcast scenario |
| Narration, tightened | keep |
| Master to a reference | keep; add "pick a finished master" (a quiet reference gives a quiet master) |
| Master a song (`multiband` at -20 on an unstaged input) | keep or replace by §1 Music master: its threshold depends on input level; staging first makes it predictable |
| Vocal chain (de-ess, compress, EQ, plate) | replace by §3 1176 into LA-2A plus de-ess after compression (Senior), and the plate as an Abbey Road send |
| AI track, settled | keep (no source; it is our own fix) |
| Ringtone | keep; it already fits Apple's 30 s |
| Telephone | fix: add `normalize(-18, 'lufs')` (it leaves at 0 dBFS, +9 LU) |
| Hall, Lo-fi, Remove/Isolate vocals, Slow down, Shift pitch, Reverse, Loop, Generate, Analyze, Batch | keep |

Join: Spotify ad, R 128 s1 ad, ATSC A/85, Netflix dialogue (the spec exists, the recipe does not), music master for streaming, voice-over raw, phone prompt, game console/portable, game SFX, repair order, field recording, interview two mics, tape transfer, parallel compression, 1176 into LA-2A, CLA vocal, Scheps parallel vocal, Pultec low end, Abbey Road send, bus glue, mastering chain with dither, de-essing, Haas, mono bass, slapback, ADT, gated reverb, pumping, music bed, AM radio, broadcast processor, SP-1200.

[test/recipes.js](../test/recipes.js) checks voice recipes against one synthetic narration. Each recipe with a spec should join it, and techniques should assert what they claim (Pultec response shape, mono-bass correlation, parallel +5 dB on tails), not a loudness.

Left out, for lack of a source with settings: the "smile curve" EQ, walkie-talkie, tape saturation settings, Serban Ghenea (no interview in his own words found), Bob Clearmountain and Michael Brauer (not researched in this pass).

---

## 6. Gaps

Ops and specs the recipes above needed and did not have. Ordered by how many recipes they unblock.

1. **Sidechain key on compressor, gate, expander, deesser.** Only `ducker` takes `key`. Needed for gated reverb (worked around with onsets + `gain`), keyed de-essing, frequency-conscious compression.
2. **Stereo-linked detection** on every dynamics op (and M/S detection). All of them run per channel, so `vca` on a mix, or `limiter`, can shift the image. SSL's bus compressor is linked by design. A `link: true` default for buses.
3. **Dry/wet on any op**: an engine-level `{ wet: 0..1 }` with latency compensation would make parallel compression, sends and the Scheps chain one call each, instead of `clone()` + `mix()`, and would sidestep D2.
4. **Sidechain high-pass** on compressors (SSL G has one) and **auto (program-dependent) release** on `vca`.
5. **Dialogue-gated normalize**: `normalize(-27, 'dialog', { ceiling: -2 })` in place of the `-27 + L - D` offset used in the ATSC, Netflix and phone recipes (also open in [pro.md](pro.md)).
6. **check specs**: `atsc` (-24 dialogue-gated, -2 dBTP), `ebu-s1` (max short-term -18), `spotify-ad` (-16 ±1.5, -2 dBTP, 30/60 s, 0.5 s pads), `aswg-home` / `aswg-portable`. And a multi-platform playback report (Spotify -14, Apple -16 reported, YouTube -14 measured, Tidal, Amazon, Deezer) in the manner of Loudness Penalty.
7. **True-peak normalize in peak mode**: `normalize(-1, 'truepeak')`. Peak mode is sample peak; the SFX asset measured -0.80 dBTP at -1 dBFS.
8. **Codecs for delivery**: G.711 µ-law / A-law WAV (phone prompts, what the network carries), and `m4r` as an alias of m4a (iPhone ringtones).
9. **Archive transfer tools**: RIAA de-emphasis (`@audio/weighting-riaa` exists, not in the registry), Dolby B/C and dbx decode, azimuth (inter-channel delay) alignment, wow and flutter correction.
10. **Broadcast tools**: FM pre-emphasis / de-emphasis at 50 and 75 µs (`emphasis` is a one-pole speech filter by `alpha`), a 5-band `multiband`.
11. **Automixer** (gain sharing) for multi-mic dialogue, in place of expander + leveler.
12. **Pultec-style passive EQ**: the boost/attenuate interaction as one op, rather than a shelf plus a bell.
13. **Reverb pre-delay** param on `plate`/`fdn` (today: `mix(send, 0.02)`).
14. **Tempo-synced times**: delay and release in note values from `stat('bpm')` (today: `60 / bpm / 2`).

## 7. Defects found while verifying

All reproduce on committed HEAD (f5fc6bb) as well as the working tree.

- **D1 (fixed: audio.js wires registry ops before encode and save, as before stream; test/pro.js "a file just opened"). `audio(path).<registry op>().save()` fails before decode finishes**: "Unknown op: compressor". The headline pattern `audio('voice.wav').highpass(80).compressor(…).normalize('podcast').save('out.mp3')` fails in a fresh process, with or without the `normalize`; awaiting the source first works. `save()` takes its live path while the file decodes and reads `inst.duration` ([fn/save.js](../fn/save.js), `total ??= inst.duration`) before `stream()` wires the registry ops ([audio.js](../audio.js), the `stream` wrapper), and `duration` builds the plan.
- **D2. Registry ops inside a source passed to `mix` or `insert` are not wired.** `stat()` on the result always fails ("Unknown op: transistor", `noise`, `plate`, `compressor`); `save()` fails after `insert`, or when a resolve op such as `normalize` follows the `mix`; `read()` works. `autowire` in audio.js walks only the instance's own `edits`, not its refs'. It breaks every parallel recipe, sends, and generated noise in a mix, wherever the result is measured or saved. Not checked in the editor, whose Check panel measures with `stat()`.
- **D3. `haas({ channel: 'right' })` crashes** ("chs.map is not a function", plan.js `run`): the plugin's `channel` param collides with the engine's `{ channel }` range key. Rename the param (`side`), or reserve the range keys.
- **D4. A 32-bit float WAV the library writes cannot be read back** when the source had tags: the LIST chunk puts `data` at an offset not divisible by 4 and @audio/decode-wav builds a `Float32Array` view on it ("start offset of Float32Array should be a multiple of 4", decode-wav.js:191). Copy to an aligned buffer, or read through a DataView.
- **D5. Dual-mono MP3 and M4A decode as 1 channel** (ffprobe: 2). The ACX "all mono or all stereo" rule and Apple's stereo-only WAV/FLAC rule depend on this count.
- **D6. `auto('speech')` misses its own targets**: -15.21 LUFS for -16, sample peak -1.00 dBFS but +0.28 dBTP, failing `check('podcast')`. Its limiter holds sample peak, though @audio/chain's README says true-peak ceiling. `auto('speech').normalize('podcast')` passes.
- **D8 (fixed: they wait for the file's header first). `stat('dialog')` and `stat('noisefloor')` of a file just opened** read its rate before it was known: dialog -Infinity, so the Netflix and ATSC scenarios gained without bound on a real narration (lena: -Infinity, now -17.05 LUFS).
- **D7. `normalize(target, 'rms', { ceiling })` lands under target** by what the ceiling limited: -20.26 for -20 (ACX recipe), -18.00 for -17.01 on music. LUFS mode makes the loss back up; RMS mode does not.
