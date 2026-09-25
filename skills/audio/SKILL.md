---
name: audio
description: Inspect, edit, convert and analyze audio files (wav, mp3, flac, ogg, opus, m4a, aiff…) and the sound of videos (mp4, mov) with the `audio` CLI, no ffmpeg. Loudness/LUFS and true peak, normalize for podcast, streaming, broadcast or audiobook specs, trim silence, cut, fade, EQ, match EQ, repair, denoise, ducking, speed, pitch, mix, split, BPM, key, chords. Use for any task that reads or changes an audio file.
---

Shell: `npx -y audio ARGS`. MCP: tool `audio`, same ARGS.

ARGS = SOURCE [OP ARGS]… [SINK]
- SOURCE: path (audio or video), URL, `'*.wav'` (batch), `a.mp3 + b.wav` (concat), `record 10s` (mic)
- SINK: `stat [NAMES]` (default: overview) · `save PATH [192k] [24bit]` (format from extension, `-f` overwrites; a video saved as .mp4 keeps its picture) · `play`
- Units: `1.5s` `500ms` `1:30` · `-3db` · `80hz` `2khz` · band `1khz..4khz`. Range `10s..20s`, `-5s..` (last 5s): after an op it scopes that op, alone it scopes the output. Options: `name:value`.

Ops: trim [DB] · shrink [GAP] · normalize podcast|streaming|broadcast|DB [lufs|rms] · gain DB · fade IN -OUT · crop RANGE · remove RANGE [XFADE] · pad S · speed R · stretch F (2 = twice as long) · pitch SEMI · highpass HZ [ORDER] · lowpass HZ · eq HZ DB [Q] · lowshelf/highshelf HZ DB · notch HZ · mix FILE [AT] [DB] · crossfade FILE S · remix 1|2 · resample HZ · dither 16 · match REF · spectral BAND [DB] RANGE · repair RANGE · split T… (save `part-{i}.wav`). Plugins by name: compressor, limiter, deesser, dehum, declick, dereverb, ducker key:VOICE… `--help` lists all; `OP --help` shows params.

Stats: db peak rms loudness momentary shortterm dialog truepeak lra dc clipping silence crest correlation bpm key chords notes; `spectrum 32` takes bins.

Measure, edit, verify:
1. `in.wav`: overview (duration, peak, LUFS, BPM, key, clipping, DC)
2. `in.wav trim normalize podcast stat loudness truepeak`: preview, nothing written
3. `in.wav trim normalize podcast save out.mp3`: write a new file, keep the source
4. `out.mp3 stat loudness truepeak`: confirm; report a missed target, don't hide it

Targets (loudness normalize holds ≤ -1 dBTP, `ceiling:-2` for -2): podcast -16 LUFS (Apple) · streaming -14 (Spotify, YouTube) · broadcast -23 (EBU R128) · speech `-18 lufs` (AES) · Netflix dialog -27, ≤ -2 dBTP (measure `stat dialog`). ACX audiobook: RMS -23 to -18 dB, peak ≤ -3 dB, noise floor ≤ -60 dB (`rms` is linear: dB = 20·log10), `save book.mp3 192k`.
