---
name: audio
description: Inspect, edit, convert and analyze audio files (wav, mp3, flac, ogg, opus, m4a, aiff…) with the `audio` CLI, no ffmpeg. Loudness/LUFS, normalize for podcast or streaming, trim silence, cut, fade, EQ, speed, pitch, mix, split, BPM, key, chords. Use for any task that reads or changes an audio file.
---

Shell: `npx -y audio ARGS`. MCP: tool `audio`, same ARGS.

ARGS = SOURCE [OP ARGS]… [SINK]
- SOURCE: path, URL, `'*.wav'` (batch), `a.mp3 + b.wav` (concat), `record 10s` (mic)
- SINK: `stat [NAMES]` (default: overview) · `save PATH` (format from extension, `-f` overwrites) · `play` (speakers)
- Units: `1.5s` `500ms` `1:30` · `-3db` · `80hz` `2khz`. Range `10s..20s`, `-5s..` (last 5s): after an op it scopes that op, alone it scopes the output.

Ops: trim [DB] · shrink [GAP] · normalize [podcast|streaming|broadcast|DB] · gain DB · fade IN -OUT · crop RANGE · remove RANGE · pad S · speed R · stretch F (2 = twice as long) · pitch SEMI · highpass HZ · lowpass HZ · eq HZ DB [Q] · lowshelf/highshelf HZ DB · notch HZ · mix FILE [AT] · crossfade FILE S · remix 1 · resample HZ · dither 16 · split T… (save `part-{i}.wav`). `--help` lists all ops, stats and plugins (compressor, limiter, deesser, dehum, declick, freeverb, truepeak…); `OP --help` shows params.

Stats: db peak rms loudness dc clipping silence crest centroid flatness correlation bpm beats onsets key chords notes; `spectrum 32`, `cepstrum 13` take bins.

Measure, edit, verify:
1. `in.wav`: overview (duration, peak, LUFS, BPM, key, clipping, DC)
2. `in.wav trim normalize podcast stat loudness db`: preview a chain, nothing written
3. `in.wav trim normalize podcast save out.mp3`: write a new file, keep the source
4. `out.mp3 stat loudness db`: confirm

Targets: podcast -16 LUFS, -1 dBTP (Apple) · streaming -14 LUFS (Spotify, YouTube) · broadcast -23 LUFS (EBU R128); each is a `normalize` preset. ACX audiobook: RMS -23 to -18 dB, peak ≤ -3 dB, noise floor ≤ -60 dB (`rms` is linear: dB = 20·log10).
