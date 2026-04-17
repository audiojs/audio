# AI Integration — audio + MCP + Skills

## MCP Server

**Model Context Protocol** — Anthropic's open standard for AI agents to call external tools. An MCP server exposes functions that Claude, Copilot, Cursor, etc. invoke during conversation. The agent decides *when* and *how* to call them based on user intent.

### Why it fits

The `audio` API is already tool-shaped: clean named operations, parameterized opts, rich analysis. An MCP server is a thin wrapper.

### Tools

```
audio.load(src)              → load file/url/buffer
audio.info()                 → duration, channels, sampleRate, format, edits
audio.analyze(stats, opts?)  → query LUFS, spectrum, BPM, key, silence, clipping, etc.
audio.edit(ops)              → chain ops: gain(-3), trim(-30), normalize('podcast'), fade(0.3)
audio.save(path, format?)    → export to file
audio.undo()                 → revert last edit
audio.read(opts?)            → get PCM data (range, channel, format)
audio.play()                 → preview (if terminal supports)
```

### Value

Any AI agent gets audio processing. "Clean up this podcast" → agent loads, analyzes LUFS/silence/DC, decides chain, applies, verifies, saves. Low effort (API is ready), high utility.

### Who uses it

Podcast producers, content creators, musicians, sound designers, developers — anyone who talks to AI and has audio files.

### Implementation

~200-300 lines. Could live in `bin/mcp.js` or separate `audio-mcp` package. Depends on `@modelcontextprotocol/sdk`. Stateful server holding one or more audio instances. JSON-RPC over stdio.

---

## Teaching AI to Hear — The Beethoven Principle

Beethoven composed his greatest works deaf. He understood music *structurally*: harmony, counterpoint, instrument ranges, form. He didn't need to hear to *know* what it should sound like.

AI is the same. It doesn't need ears — it needs **metrics that encode what ears perceive**.

### Available metrics (already implemented)

| Metric | What it "hears" |
|--------|-----------------|
| LUFS | Perceived loudness |
| Spectrum (mel) | Frequency balance — muddy? harsh? thin? |
| MFCCs (cepstrum) | Timbral fingerprint — voice vs music vs noise |
| Peak / RMS | Headroom, average energy |
| DC offset | Technical flaw |
| Clipping | Distortion |
| Silence | Dead air, gaps, leading/trailing |
| BPM / key / chords | Musical structure |
| Notes / onsets / beats | Rhythmic and melodic content |

### The closed loop

**measure → decide → apply → verify**

The AI reads stats, applies ops, re-reads stats, confirms convergence. No ears needed.

---

## Skills — Domain Knowledge Layer

MCP server gives **hands**. Skills give **judgment**. Without skills, AI has 40 tools and no idea when to use which.

### 1. `audio-master` (highest value)

Mastering workflow by target format. Encodes the decision tree:

```
1. Analyze: stat(['loudness','dc','clipping','silence','spectrum'])
2. Diagnose: DC > 0.01? → fix. Silence > 0.5s at edges? → trim. LUFS off target? → normalize.
3. Process: high-pass if low-end mud (energy < 80Hz > threshold). Normalize to target.
4. Verify: re-measure. LUFS within ±0.5 of target? Peak < ceiling? Done.
```

**Presets:**
- **Podcast**: LUFS -16, trim silence < -40dB, normalize, gentle highpass 80Hz, dither 16-bit
- **Broadcast (EBU R128)**: LUFS -23, true peak -1dB, loudness gate -70
- **Music streaming (Spotify)**: LUFS -14, -1dB true peak
- **Voice memo cleanup**: trim, normalize, highpass
- **YouTube**: LUFS -14, true peak -1dB
- **Audiobook (ACX)**: LUFS -18 to -23, peak -3dB, noise floor < -60dB

### 2. `audio-clean` (high value)

Detect and fix problems automatically:
- Silence trimming (leading/trailing/gaps)
- DC offset removal
- Clipping detection → gain reduction
- Noise floor estimation (spectral flatness) → denoise (when available)
- Click/pop detection → declick (future)
- Hum removal (50/60Hz notch)

### 3. `audio-analyze` (medium-high value)

Generate human-readable reports from metrics:
- "This track is A minor, 120 BPM, -8 LUFS (too loud for podcast, fine for music)"
- "DC offset on left channel, clipping at 3 points, 2.3s leading silence"
- Compare files: "Track B is 3dB louder, brighter (centroid 4.2kHz vs 2.8kHz)"

### 4. `audio-match` (medium value)

Match characteristics between reference and source:
- Analyze reference → extract loudness, spectral profile, dynamic range
- Analyze source → compute deltas
- Apply EQ curve, gain, compression to match

### 5. `audio-edit` (medium value)

Smart content editing:
- Remove silences (podcast pacing)
- Split by silence/beats/onsets
- Auto-crossfade segments
- Shrink pauses to target gap duration

---

## The Moat

The unique combination: **programmatic audio processing + rich analysis + AI tool interface — all JS, all streaming, no ffmpeg.**

- Sox/ffmpeg: CLI-only (bad for MCP, bad for programmatic verification loop)
- Web Audio API: browser-only, no analysis pipeline
- Tone.js: real-time only, no file I/O
- Python librosa: analysis-only, no editing
- Pedalboard: Python-only, no analysis

`audio` is the only package where AI can: **load → analyze → decide → edit → verify → save** — in one runtime, streaming, cross-platform.

---

## What's NOT worth building (yet)

- Stem separation, noise profiling, pitch correction — need ML models, different beast
- Genre classification from MFCCs — niche, skill can hardcode presets
- Real-time voice effects — different use case (Tone.js territory)

---

## Dependencies on existing roadmap

- Compressor/limiter needed for proper mastering chains
- Denoise needed for audio-clean skill
- Gate needed for noise floor management
- The more ops exist, the more powerful the AI integration becomes
- Missing stats (crest, centroid, flatness) should land before MCP

## Effort estimate

- Missing stats (crest, centroid, flatness, stereo correlation): small
- MCP server (bin/mcp.js): small-medium
- audio-master skill (.md): small
- audio-clean skill (.md): small
- audio-analyze skill (.md): small
