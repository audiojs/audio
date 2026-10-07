---
name: audio
description: Inspect, edit, convert and analyze audio files (wav, mp3, flac, ogg, opus, m4a, aiff…) and the sound of videos (mp4, mov) with the `audio` CLI, no ffmpeg. Loudness/LUFS, true peak and noise floor, normalize and check against podcast, streaming, broadcast, audiobook (ACX) or Netflix specs, trim silence, cut, fade, EQ, match EQ, repair, denoise, ducking, speed, pitch, mix, split, BPM, key, chords. Use for any task that reads or changes an audio file.
---

Shell: `npx -y audio ARGS`. MCP tool `audio`: same ARGS.

ARGS = SOURCE [OP ARGS]… [SINK]
- SOURCE: path (audio/video), URL, `'*.wav'` (batch), `a.mp3 + b.wav` (concat), `record 10s` (mic)
- SINK: `stat [NAMES]` (the default) · `check SPEC` · `save PATH [192k] [24bit]` (format by extension, `-f` overwrites; .mp4 keeps a video's picture; .edl/.fcpxml/.otio: cut list) · `play`
- Units: `1.5s` `500ms` `1:30` · `-3db` · `80hz` `2khz` · band `1khz..4khz`. Range `10s..20s`, `-5s..` (last 5s): after an op: that op; alone: the output. Options: `name:value`.

Ops: trim [DB] · shrink [GAP] · normalize podcast|streaming|broadcast|DB [lufs|rms] · gain DB · fade IN -OUT · crop RANGE · remove RANGE [XFADE] · pad S · speed R · stretch F (2 = twice as long) · pitch SEMI · intonation F (0 monotone, 2 twice as wide) · formant SEMI (pitch kept) · highpass HZ [ORDER] · lowpass HZ · eq HZ DB [Q] · lowshelf/highshelf HZ DB · notch HZ · mix FILE [AT] [DB] · crossfade FILE S · convolve IR [MIX] (a room, a cabinet) · remix 1|2 · resample HZ · dither 16 · match REF · master REF · roomtone (fill silence) · spectral BAND [DB] RANGE · repair RANGE · split T… (save `part-{i}.wav`). Plugins by name: compressor, limiter, deesser, dehum, declick, dereverb, ducker key:VOICE… `--help`: all ops; `OP --help`: params.

Native plugins (VST3, CLAP, AU, LV2; needs @audio/host): `plugin "NAME" key:value`; `audio --plugins` lists them, `audio --plugins NAME` its keys; a WAM by its module URL. Devices: `audio --devices`; `record --device NAME`; `record OPS play` hears the mic through OPS live.

Stats: db peak rms noisefloor loudness momentary shortterm dialog truepeak lra dc clipping silence crest correlation bpm key chords notes; `spectrum 32`: 32 bins.

Measure, edit, verify:
1. `in.wav`: levels, BPM, clipping, DC
2. `in.wav trim normalize podcast check podcast`: preview, nothing written
3. `in.wav trim normalize podcast save out.mp3`: writes a new file
4. `out.mp3 check podcast`: ✓/✗ per rule; report a fail, don't hide it

Specs: podcast (Apple, -16 LUFS) · streaming (Spotify, -14) · broadcast (EBU R 128, -23) · netflix (dialog -27, ≤ -2 dBTP) · acx (audiobook). normalize holds ≤ -1 dBTP (`ceiling:-2`). ACX: `omlsa compressor -24 2.5 normalize -20 rms ceiling:-3.5 trim pad 1.5s 2s roomtone resample 44100 save book.mp3 192k`; `'ch*.wav' check acx`: a book.
