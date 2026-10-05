/**
 * audio — paged audio instance with declarative ops.
 */

/** Time value: seconds as number, or parseable string ('1.5s', '500ms', '1:30') */
type Time = number | string
// Wherever an option is `duration` it may be `d`, and `crossfade` `xfade` (FFmpeg's names); the long one wins
/** A result, or one per channel when `channel` is an array */
type PerChannel<C, R> = C extends number[] ? R[] : R

type AudioSource = AudioInstance | AudioBuffer | Float32Array[] | number
type FilterType = 'highpass' | 'lowpass' | 'bandpass' | 'notch' | 'eq' | 'lowshelf' | 'highshelf' | 'allpass'
type RepairOpts = { at: Time, duration: Time, method?: 'auto' | 'ar' | 'sinusoidal' | 'similarity' | 'spectral', window?: number }
/** Where the noise plays alone (a range of the op's input, or several), or its print (dB per band, one or per channel) */
/** `band` [low, high] Hz: only those frequencies gained, the rest as they were */
/** How much of an edit's output is heard, the rest its input: 0 to 1 (1, all of it, by default), a curve over the input's
 *  time, or a function of it. Any edit that keeps the timeline and the channels takes it; an effect's own mix is its own. */
type Mix = number | { t: number[], v: number[] } | ((t: number) => number)
type DenoiseOpts = { noise: { at?: Time, duration: Time } | { at?: Time, duration: Time }[] | number[] | number[][], band?: [number, number], at?: Time, duration?: Time, d?: Time, mix?: Mix, channel?: number | number[] }

export interface AudioInstance {
  /** Decoded PCM pages */
  pages: Float32Array[][]
  /** Per-channel, per-block stats (min/max/energy + registered fields) */
  stats: AudioStats
  /** Sample rate in Hz */
  sampleRate: number
  /** Effective channel count (reflects remix edits) */
  readonly channels: number
  /** Effective sample count (reflects structural edits) */
  readonly length: number
  /** Effective duration in seconds */
  readonly duration: number
  /** Stored sample depth of the source (16, 24, 32 = float); null for lossy or generated audio. Lossless save() keeps it. */
  readonly bitDepth: number | null
  /** Original source reference (URL/path string, or null for PCM-backed) */
  source: string | null
  /** Storage mode */
  storage: string
  /** Promise — resolves to true when ready (decoded, mic active, etc.) */
  ready: Promise<true>
  /** Edit list (inspectable) */
  edits: EditOp[]
  /** Monotonic counter, increments on edit/undo */
  version: number
  /** What the speakers play now, in seconds (their latency compensated); at pause it holds where playback resumes.
   *  Set it, or seek(), while stopped; playing, seek(). */
  currentTime: number
  /** True when playing */
  playing: boolean
  /** True when paused */
  paused: boolean
  /** Playback volume, 0 (silent) to 1 (full). Clamped. */
  volume: number
  /** Whether playback is muted (independent of volume) */
  muted: boolean
  /** Playback speed ratio: 1 = normal, 2 = double speed, 0.5 = half. Clamped 0.0625–16. */
  playbackRate: number
  /** At a rate other than 1, the pitch kept (WSOLA), as a media element's; false: it follows the speed, as a tape's. Default true. */
  preservesPitch: boolean
  /** Whether playback loops its span; settable while playing (each seam a 10 ms equal-power crossfade) */
  loop: boolean
  /** True when playback ended naturally (not via stop) */
  ended: boolean
  /** True during a seek operation */
  seeking: boolean
  /** Promise — resolves when playback sounds, rejects on failure */
  played: Promise<void>
  /** The block the speakers play now (its first channel), for visualization */
  block: Float32Array | null
  /** Container tags: title/artist/album/year/pictures/... + raw format-specific blocks. Writable; persists through save. */
  meta: Meta
  /** Structural markers in output seconds, projected through the edit plan. Writable: set, they are marked as mark() does. */
  markers: Marker[]
  /** A marker at `time`, seconds of the audio as edited so far, or a region over `{ at, duration }`; the edits after it carry it along. */
  mark(time: number | { at: number, duration?: number, d?: number }, label?: string): this
  /** Structural regions in output seconds, projected through the edit plan. Writable: set, they are marked as mark() does. */
  regions: Region[]

  // ── Events ──────────────────────────────────────────────────────
  /** Subscribe to instance event */
  on(event: 'change', fn: () => void): this
  on(event: 'metadata', fn: (event: { sampleRate: number, channels: number, estDuration: number | null }) => void): this
  on(event: 'data', fn: (event: { delta: ProgressDelta, offset: number, sampleRate: number, channels: number }) => void): this
  on(event: 'progress', fn: (event: { offset: number, total: number }) => void): this
  on(event: 'timeupdate', fn: (time: number) => void): this
  on(event: 'ended', fn: () => void): this
  on(event: 'play', fn: () => void): this
  on(event: 'pause', fn: () => void): this
  on(event: 'volumechange', fn: () => void): this
  on(event: 'ratechange', fn: () => void): this
  on(event: 'error', fn: (err: Error) => void): this
  on(event: string, fn: (...args: any[]) => void): this
  /** Unsubscribe from instance event */
  off(event: string, fn: (...args: any[]) => void): this
  /** Dispose — stop playback/recording, clear listeners, release caches */
  dispose(): void

  // ── Core I/O ────────────────────────────────────────────────────
  /** Move playhead — preloads nearby pages, triggers seek if playing */
  seek(t: number): this
  /** Read audio data. Channel option returns single Float32Array. A source still arriving is waited
   *  for: a range until it has arrived, all of it (or a range from the end) until the end. */
  read(opts?: { at?: Time, duration?: Time, d?: Time, channel?: number, format?: string, meta?: Record<string, any> }): Promise<Float32Array[] | Float32Array | Int16Array[] | Uint8Array[] | Uint8Array>
  /** Async-iterable over materialized blocks. `for await (let block of a)` uses default range. */
  [Symbol.asyncIterator](): AsyncGenerator<Float32Array[], void, unknown>
  /** Ensure stats are fresh, return stats + block range */
  /** loudness: integrated LUFS (BS.1770-4, surround weighted) · momentary/shortterm: max 400 ms / 3 s LUFS (EBU Tech 3341) · dialog: speech-gated LUFS (AES TD1008) · noisefloor: dB RMS of the quietest 0.4 s (ACX Check) */
  stat(name: 'db' | 'rms' | 'noisefloor' | 'loudness' | 'momentary' | 'shortterm' | 'dialog' | 'peak' | 'crest', opts?: { at?: Time, duration?: Time, d?: Time, channel?: number | number[] }): Promise<number | number[]>
  /** bins: the value over each of n spans of the range, on the block grid (as waveform bins); NaN where the stat has none */
  stat<C extends number | number[] = number>(name: 'db' | 'rms' | 'noisefloor' | 'loudness' | 'momentary' | 'shortterm' | 'dialog' | 'peak' | 'crest' | 'dc' | 'correlation' | 'centroid' | 'flatness' | 'bpm', opts: { bins: number, at?: Time, duration?: Time, d?: Time, channel?: C }): Promise<PerChannel<C, Float32Array>>
  /** Each rule of a delivery spec, measured: pass is null for rules the spec describes without bounding */
  check(spec: 'acx' | 'podcast' | 'streaming' | 'broadcast' | 'netflix' | 'apple' | 'spotify' | 'ebu'): Promise<{ spec: string, name: string, url: string, note?: string, pass: boolean, rules: { name: string, value: number, unit: string, min?: number | null, max?: number | null, pass: boolean | null, note?: string }[] }>
  stat(name: 'clipping', opts?: { at?: Time, duration?: Time, d?: Time }): Promise<Float32Array>
  stat(name: 'clipping', opts: { bins: number, at?: Time, duration?: Time, d?: Time }): Promise<Float32Array>
  stat(name: 'dc', opts?: { at?: Time, duration?: Time, d?: Time }): Promise<number>
  stat(name: 'correlation', opts?: { at?: Time, duration?: Time, d?: Time }): Promise<number>
  stat(name: 'min' | 'max', opts?: { at?: Time, duration?: Time, d?: Time }): Promise<number>
  stat(name: 'min' | 'max', opts: { bins: number, at?: Time, duration?: Time, d?: Time, channel?: number }): Promise<Float32Array>
  stat(name: 'min' | 'max', opts: { bins: number, at?: Time, duration?: Time, d?: Time, channel: number[] }): Promise<Float32Array[]>
  /** Of the chosen channels' mean power (all by default) */
  stat<C extends number | number[] = number>(name: 'spectrum', opts?: { bins?: number, at?: Time, duration?: Time, d?: Time, fMin?: number, fMax?: number, weight?: boolean, channel?: C }): Promise<PerChannel<C, Float32Array>>
  stat<C extends number | number[] = number>(name: 'cepstrum', opts?: { bins?: number, at?: Time, duration?: Time, d?: Time, channel?: C }): Promise<PerChannel<C, Float32Array>>
  /** The noise print of a range, as `denoise({ noise })` takes it: dB in 1025 bands 23.4375 Hz apart, 0 to 24 kHz (white
   *  noise of RMS 0.01 prints −40 throughout). The channels' power averaged; `channel: [..]` a print each */
  stat(name: 'print', opts?: { at?: Time, duration?: Time, d?: Time, channel?: number }): Promise<number[]>
  stat(name: 'print', opts: { at?: Time, duration?: Time, d?: Time, channel: number[] }): Promise<number[][]>
  stat(name: 'silence', opts?: { threshold?: number, minDuration?: number, at?: Time, duration?: Time, d?: Time }): Promise<{ at: number, duration: number }[]>
  stat<C extends number | number[] = number>(name: 'voicing' | 'hnr' | 'harmonic', opts?: { at?: Time, duration?: Time, d?: Time, channel?: C }): Promise<PerChannel<C, number | null>>
  stat<C extends number | number[] = number>(name: 'voicing' | 'hnr' | 'harmonic', opts: { bins: number, at?: Time, duration?: Time, d?: Time, channel?: C }): Promise<PerChannel<C, Float32Array>>
  stat<C extends number | number[] = number>(name: 'centroid' | 'flatness', opts?: { at?: Time, duration?: Time, d?: Time, channel?: C }): Promise<PerChannel<C, number>>
  stat(name: 'bpm', opts?: { at?: Time, duration?: Time, d?: Time, minBpm?: number, maxBpm?: number, delta?: number, minConfidence?: number, channel?: number | number[] }): Promise<number>
  /** Where the level jumps, up (a strike) or down (a stop), each at the zero crossing a cut there keeps all of the sound from */
  stat(name: 'hits', opts?: { at?: Time, duration?: Time, d?: Time }): Promise<Float64Array>
  stat(name: 'beats' | 'onsets', opts?: { at?: Time, duration?: Time, d?: Time, minBpm?: number, maxBpm?: number, delta?: number, channel?: number | number[] }): Promise<Float64Array>
  stat<C extends number | number[] = number>(name: 'notes', opts: { poly: true, at?: Time, duration?: Time, d?: Time, minFreq?: number, maxFreq?: number, minDuration?: number, onsetThreshold?: number, frameThreshold?: number, channel?: C }): Promise<PerChannel<C, { time: number, duration: number, freq: number, midi: number, note: string, velocity: number, bends: number[] }[]>>
  /** robust: pYIN's stage 1 from @audio/neural-pitch (optional package), for noise and rooms; YIN otherwise */
  stat<C extends number | number[] = number>(name: 'notes', opts?: { poly?: false, robust?: boolean, at?: Time, duration?: Time, d?: Time, minFreq?: number, maxFreq?: number, frameSize?: number, hopSize?: number, minDuration?: number, channel?: C }): Promise<PerChannel<C, { time: number, duration: number, freq: number, midi: number, note: string, clarity: number }[]>>
  /** Chordino on NNLS chroma (Mauch & Dixon 2010), as the reference plugin; tuning: concert A in Hz, read from the audio unless given */
  stat<C extends number | number[] = number>(name: 'chords', opts?: { at?: Time, duration?: Time, d?: Time, frameSize?: number, hopSize?: number, tuning?: number, boostN?: number, channel?: C }): Promise<PerChannel<C, { time: number, duration: number, root: number, quality: 'maj' | 'min' | '7' | 'maj7' | 'min7' | 'maj6' | 'min6' | 'dim' | 'aug' | 'hdim7' | 'N', bass: number, label: string, confidence: number }[]>>
  stat<C extends number | number[] = number>(name: 'key', opts?: { at?: Time, duration?: Time, d?: Time, frameSize?: number, hopSize?: number, tuning?: number, method?: 'nnls' | 'pcp', channel?: C }): Promise<PerChannel<C, { tonic: number, mode: 'major' | 'minor', label: string, confidence: number, scores?: { label: string, score: number }[] }>>
  stat<T extends string[]>(name: T, opts?: { at?: Time, duration?: Time, d?: Time, bins?: number, channel?: number | number[] }): Promise<{ [K in keyof T]: number | Float32Array | Float32Array[] }>
  stat(name: string, opts?: { at?: Time, duration?: Time, d?: Time, bins?: number, channel?: number | number[] }): Promise<number | Float32Array | Float32Array[]>
  spectrum<C extends number | number[] = number>(opts?: { bins?: number, at?: Time, duration?: Time, d?: Time, fMin?: number, fMax?: number, weight?: boolean, channel?: C }): Promise<PerChannel<C, Float32Array>>
  cepstrum<C extends number | number[] = number>(opts?: { bins?: number, at?: Time, duration?: Time, d?: Time, channel?: C }): Promise<PerChannel<C, Float32Array>>
  silence(opts?: { threshold?: number, minDuration?: number, at?: Time, duration?: Time, d?: Time }): Promise<{ at: number, duration: number }[]>
  /** stat('hits'): where the level jumps, each at the sample to cut at */
  hits(opts?: { at?: Time, duration?: Time, d?: Time }): Promise<Float64Array>
  /** stat('print'): the noise print of a range, for denoise({ noise }) */
  print(opts?: { at?: Time, duration?: Time, d?: Time, channel?: number }): Promise<number[]>
  print(opts: { at?: Time, duration?: Time, d?: Time, channel: number[] }): Promise<number[][]>
  centroid<C extends number | number[] = number>(opts?: { at?: Time, duration?: Time, d?: Time, channel?: C }): Promise<PerChannel<C, number>>
  flatness<C extends number | number[] = number>(opts?: { at?: Time, duration?: Time, d?: Time, channel?: C }): Promise<PerChannel<C, number>>
  /** High-fidelity beat/tempo detection via spectral flux of the chosen channels' mean (single streaming pass). More precise than stat('bpm'). */
  detect<C extends number | number[] = number>(opts?: { at?: Time, duration?: Time, d?: Time, frameSize?: number, hopSize?: number, minBpm?: number, maxBpm?: number, delta?: number, channel?: C }): Promise<PerChannel<C, { bpm: number, confidence: number, beats: Float64Array, onsets: Float64Array }>>
  /** Serialize to JSON */
  toJSON(): { source: string | null, edits: EditOp[], sampleRate: number, channels: number, duration: number }

  // ── Structural ops ───────────────────────────────────────────
  crop(opts?: { at?: Time, duration?: Time, d?: Time }): this
  /** crossfade: seconds or '10ms', equal-power fades at both seams */
  insert(other: AudioSource, at?: Time | { at?: Time, crossfade?: Time, xfade?: Time }, crossfade?: Time): this
  /** Copy a range to this instance's clipboard without changing its audio. Undoable. */
  copy(opts?: { at?: Time, duration?: Time, d?: Time }): this
  copy(at: Time, duration?: Time, d?: Time): this
  /** Copy a range to the clipboard and remove it in one undoable edit. */
  cut(opts?: { at?: Time, duration?: Time, d?: Time }): this
  cut(at: Time, duration?: Time, d?: Time): this
  /** Insert the latest copied or cut range; defaults to append. Keeps the clipboard. */
  paste(opts?: { at?: Time }): this
  paste(at: Time): this
  /** Slide a range to `to`, over what is there, silence where it was (a DAW's slip mode); the length kept, or extended
   *  past the end. crossfade: seconds or '10ms', an equal-power crossfade centered on each edge */
  move(opts: { at?: Time, duration?: Time, d?: Time, to: Time, crossfade?: Time, xfade?: Time }): this
  move(at: Time, duration: Time, to: Time, crossfade?: Time): this
  /** crossfade: seconds or '10ms', an equal-power crossfade centered on the splice; length unchanged */
  remove(opts?: { at?: Time, duration?: Time, d?: Time, crossfade?: Time, xfade?: Time }): this
  remove(at: Time, duration?: Time, d?: Time, crossfade?: Time): this
  repeat(times: number, opts?: { at?: Time, duration?: Time, d?: Time }): this
  pad(before: number, after?: number): this
  speed(rate: number): this
  /** Time-stretch preserving pitch. Factor may be a fn or curve of source-time seconds — sliding stretch (continuous tempo envelope), duration = ∫factor dt. `voice`: for one voice, its pulse shape kept: WSOLA shortening, the vocoder reset to the waveform (PVSOLA) slowing */
  stretch(factor: number | ((t: number) => number) | { t: number[], v: number[] }, opts?: { at?: Time, duration?: Time, d?: Time, voice?: boolean }): this
  /** Move moments in time: [from, to] pairs in seconds. Between neighbouring markers the audio stretches to fit, pitch kept; start and end stay (a marker at the end moves it). */
  warp(markers: [number, number][]): this
  /** Shift pitch, keep duration. Semitones: a number, a curve { t, v } (seconds → semitones, straight between points,
   *  flat past the ends) or t => semitones; where it is zero the audio stays as it was. voice: a voice's own glottal
   *  cycles re-spaced (TD-PSOLA, optional @audio/tune-curve): formants and consonants kept, one voice. */
  pitch(semitones: number | ((t: number) => number) | { t: number[], v: number[] }, opts?: { at?: Time, duration?: Time, d?: Time, channel?: number | number[], voice?: boolean }): this
  /** A voice's rises and falls made wider or flatter about its median pitch: 1 as it was, 0 a monotone, 2 twice as
   *  wide, below 0 rises turned to falls. Its own glottal cycles re-spaced (optional @audio/tune-curve): timing,
   *  formants and consonants kept, one voice. */
  intonation(factor: number, opts?: { at?: Time, duration?: Time, d?: Time, mix?: Mix, channel?: number | number[] }): this
  /** Move the formants (the spectral envelope: a voice's vowels, the size of its head), keep the pitch. Semitones: a
   *  number, a curve { t, v } (seconds → semitones) or t => semitones; where it is zero the audio stays as it was. */
  formant(semitones: number | ((t: number) => number) | { t: number[], v: number[] }, opts?: { at?: Time, duration?: Time, d?: Time, mix?: Mix, channel?: number | number[] }): this

  // ── Sample ops ──────────────────────────────────────────────
  gain(value: number | ((t: number) => number), opts?: { at?: Time, duration?: Time, d?: Time, mix?: Mix, channel?: number | number[], unit?: 'db' | 'linear' }): this
  /** Fade in (positive) / out (negative). Adjustable: start/end gain levels (0..1) and mid — position of the half-amplitude point within the fade */
  fade(duration: Time, curve?: 'linear' | 'exp' | 'log' | 'cos', opts?: { at?: Time, start?: number, end?: number, mid?: number }): this
  fade(fadeIn: Time, fadeOut: Time, curve?: 'linear' | 'exp' | 'log' | 'cos'): this
  reverse(opts?: { at?: Time, duration?: Time, d?: Time }): this
  /** Mix another source in at `at`, `gain` dB (FFmpeg amix weights) */
  mix(other: AudioSource, opts?: { at?: Time, duration?: Time, d?: Time, gain?: number }): this
  mix(other: AudioSource, at?: Time, gain?: number, opts?: { duration?: Time, d?: Time }): this
  crossfade(other: AudioSource, duration?: Time, d?: Time, curve?: 'linear' | 'exp' | 'log' | 'cos' | 'equal'): this
  /** No source: crossfade across the range, the audio before it fading into the audio after it; the range goes */
  crossfade(range: { at: Time, duration?: Time, d?: Time }): this
  /** Overwrite from `at` with samples or another sound; what runs past the end extends it */
  write(data: Float32Array[] | Float32Array | AudioInstance | AudioBuffer, opts?: { at?: Time, duration?: Time, d?: Time }): this
  remix(channels: number | (number | null)[]): this
  pan(value: number | ((t: number) => number), opts?: { at?: Time, duration?: Time, d?: Time, mix?: Mix, channel?: number | number[] }): this

  // ── Filters ──────────────────────────────────────────────────
  filter(type: FilterType, ...params: number[]): this
  filter(fn: (data: Float32Array, params: Record<string, unknown>) => void, opts?: Record<string, unknown>): this
  /** Even integer Butterworth order >= 2: 2 (12 dB/oct, default), 4 (24), 6, 8, … Other orders are rejected. */
  highpass(freq: number, order?: number): this
  lowpass(freq: number, order?: number): this
  bandpass(freq: number, Q?: number): this
  notch(freq: number, Q?: number): this
  eq(freq: number, gain?: number, Q?: number): this
  lowshelf(freq: number, gain?: number, Q?: number): this
  highshelf(freq: number, gain?: number, Q?: number): this
  allpass(freq: number, Q?: number): this

  // ── Effects ─────────────────────────────────────────────────
  /** Mid/side by default. `model` separates with @audio/neural-separate (optional package): the whole input once,
   *  before rendering; weights from the package's export scripts (~/.cache/audiojs/neural) or `weights` (URL or directory) */
  vocals(mode?: 'isolate' | 'remove', opts?: VocalsModel): this
  vocals(opts: VocalsModel & { mode?: 'isolate' | 'remove' }): this
  dither(bits?: number, opts?: { shape?: boolean }): this
  crossfeed(freq?: number, level?: number): this
  /** Band-splitting crossover (LR4, allpass-aligned flat sum) — N split freqs → N+1 bands × channels, band-major */
  crossover(...freqs: (number | number[])[]): this
  /** Match EQ: fit up to `bands` (8) parametric bands so this source's tonal balance follows `reference`; `amount` 0..1.
   *  Streams `lookahead` seconds (10) behind the input, refitting as the analyzed length doubles. */
  /** Match EQ toward a reference; `midside`: a stereo pair's mid and side apart, the side to the reference's width */
  match(reference: AudioSource, amount?: number, opts?: { bands?: number, lookahead?: number, midside?: boolean }): this
  /** Master to a reference track: match in mid and side, then its integrated loudness under a true-peak ceiling (-1 dBTP) */
  master(reference: AudioSource, opts?: { ceiling?: number, amount?: number, bands?: number, lookahead?: number }): this
  /** Fill digital silence (≥ 10 ms under `threshold` dBFS, default -90) with the recording's own room tone */
  roomtone(threshold?: number): this
  /** Spectral edit: gain (dB, default: remove) on `band` [low, high] Hz over the time range */
  spectral(band?: [number, number], gain?: number, opts?: { at?: Time, duration?: Time, d?: Time, mix?: Mix }): this
  /** Spectral repair: rebuild a damaged time range (optionally one band) from its surroundings. `method` 'auto' routes by
   *  length and content: a transplant of the passage that joins seamlessly, searched in the `window` s (10) before the
   *  range; failing that, AR interpolation up to 70 ms and a sinusoidal bridge over a matched noise floor beyond */
  repair(band?: [number, number] | RepairOpts, opts?: RepairOpts): this
  /** Remove a steady noise learned where it plays alone (hiss, hum, a fan, room tone, tape): `noise` is that range of
   *  the op's input (or several, or a print from stat('print')); the noise goes `reduction` dB down (default 12; 0: none)
   *  everywhere, or in the op's own `at`/`duration`. `threshold` raises the print by that many dB (default 0). OM-LSA
   *  on the held noise (@audio/denoise-omlsa); each channel learns its own; streams once the range has arrived */
  denoise(reduction: number, threshold: number, opts: DenoiseOpts): this
  denoise(reduction: number, opts: DenoiseOpts): this
  denoise(opts: DenoiseOpts & { reduction?: number, threshold?: number }): this
  /** Speech enhancement by DeepFilterNet3 through @audio/neural-denoise (optional package; its 8 MB model downloads once,
   *  cached): the whole input, once, before rendering; a live stream waits for its end. `limit`: the most the noise
   *  drops, dB (default 18: room tone stays, the voice keeps its sound; 0: no limit). Held sung notes, which the model
   *  alone takes for noise, are kept. `weights`: URL of an upstream ONNX export */
  deepfilter(limit?: number, opts?: { weights?: string, device?: 'auto' | 'node' | 'wasm' | 'webgpu', at?: Time, duration?: Time, d?: Time, channel?: number | number[] }): this
  deepfilter(opts: { limit?: number, weights?: string, device?: 'auto' | 'node' | 'wasm' | 'webgpu', at?: Time, duration?: Time, d?: Time, channel?: number | number[] }): this
  /** RNNoise speech denoising, streaming, through @audio/neural-denoise (optional package, weights inside): 1439
   *  samples of latency at 48 kHz, compensated; other rates resampled in and out. `limit`: dB (default 20; 0: none) */
  rnnoise(limit?: number, opts?: { at?: Time, duration?: Time, d?: Time, mix?: Mix, channel?: number | number[] }): this
  rnnoise(opts: { limit?: number, at?: Time, duration?: Time, d?: Time, mix?: Mix, channel?: number | number[] }): this
  resample(targetRate: number, opts?: { type?: 'linear' | 'sinc' }): this

  // ── Smart ops ───────────────────────────────────────────────
  /** Strip leading/trailing silence. The automatic threshold reads the whole input: on a live stream it waits for the end; a given one streams. */
  trim(threshold?: number): this
  /** Compress silent pauses to a target gap (seconds, default 0.3) throughout, or within {at, duration} */
  shrink(gap?: number, threshold?: number): this
  shrink(opts: { gap?: number, threshold?: number, at?: Time, duration?: Time, d?: Time }): this
  /** Loudness targets (presets, mode 'lufs') hold a true-peak ceiling, -1 dBTP by default: a lookahead
   *  limiter, then loudness made up to the target. `ceiling`: dBTP, or false for none. */
  normalize(): this
  normalize(preset: 'streaming' | 'podcast' | 'broadcast', opts?: NormalizeOpts): this
  normalize(target: number, mode?: 'peak' | 'lufs' | 'rms', opts?: NormalizeOpts): this
  /** To a reference's integrated loudness (BS.1770) */
  normalize(reference: AudioSource, opts?: NormalizeOpts): this
  normalize(target: number, opts?: NormalizeOpts): this
  normalize(opts: NormalizeOpts & { target?: number | 'streaming' | 'podcast' | 'broadcast' }): this

  // ── Fns (registered via audio.fn) ───────────────────────────
  clip(opts?: { at?: Time, duration?: Time, d?: Time }): AudioInstance
  split(...offsets: Time[]): AudioInstance[]
  undo(n?: number): EditOp | EditOp[] | null
  run(...edits: EditOp[]): this
  transform(fn: (input: Float32Array[], output: Float32Array[], ctx: any) => void): this
  /** Play [at, at + duration) (to the end without a duration); `at` defaults to currentTime (the start once ended).
   *  Playing already, it goes to `at` or the new span without a gap. `from`: take over that instance's playback where it
   *  is (span, loop, volume, rate, pause), crossfaded, no gap; it stops. Renders ahead into an AudioWorklet on
   *  audio.context (Node: @audio/speaker); an edit while playing is heard ~50 ms later where it happens. */
  play(opts?: PlayOpts): this
  /** Each ramps over 5 ms. */
  pause(): this
  resume(): this
  stop(): this
  /** Live stats of what plays, delivered as it is heard. Listener-gated (zero cost when nothing subscribes). Omit cb for pull-style via probe.value. */
  meter(what: string | string[] | MeterOpts, cb?: (value: any) => void): MeterProbe
  /** Encode and write. An MP4/MOV source saved to .mp4/.mov/.m4v keeps its video (audio track swapped). */
  save(target: string | FileSystemWritableFileStream, opts?: EncodeOpts & { format?: string, video?: boolean }): Promise<void>
  encode(format?: string, opts?: EncodeOpts): Promise<Uint8Array>
  /** The edits as clips of the source files (seconds; `rate`: source seconds per output second, negative reversed), or a cut list for a video editor: CMX 3600 EDL, FCPXML 1.9, OpenTimelineIO. encode() and save('cuts.edl') take them too. */
  cuts(opts?: CutOpts): Promise<{ fps: number, clips: { at: number, duration: number, from: number, rate: number, source: string }[] }>
  cuts(format: 'edl' | 'fcpxml' | 'otio', opts?: CutOpts): Promise<string>
  encode(opts?: EncodeOpts): Promise<Uint8Array>
  clone(): AudioInstance
}

export interface AudioStats {
  blockSize: number
  /** samples the blocks cover: the last block can be short */
  length?: number
  min: Float32Array[]
  max: Float32Array[]
  ms: Float32Array[]
  energy: Float32Array[]
  [field: string]: number | Float32Array[]
}

export type EditOp = [type: string, opts?: Record<string, any>]

/** Normalized container tags. Unknown fields kept under `.raw`. Pass `meta: false` to save() to strip. */
export interface Meta {
  title?: string
  artist?: string
  album?: string
  albumartist?: string
  composer?: string
  genre?: string
  year?: string
  track?: string
  disc?: string
  bpm?: string
  key?: string
  comment?: string
  copyright?: string
  isrc?: string
  publisher?: string
  software?: string
  lyrics?: string
  pictures?: Picture[]
  /** Format-specific untouched blocks (WAV bext/iXML, ID3v2 frames, FLAC blocks) */
  raw?: Record<string, any>
  [key: string]: any
}

/** Cover art / picture. `data` is raw image bytes; `.url` lazy-creates a Blob URL (browser) or data URL (Node). */
export interface Picture {
  mime: string
  /** ID3 picture type (3 = cover, 4 = back, ...). Default 3. */
  type?: number
  description?: string
  data: Uint8Array
  /** Lazy getter — Blob URL in browser, data URL in Node. */
  readonly url: string
}

/** Point marker, in output seconds. */
export interface Marker {
  time: number
  label?: string
}

/** Time-span region, in output seconds. */
export interface Region {
  at: number
  duration: number
  label?: string
}

export interface NormalizeOpts {
  mode?: 'peak' | 'lufs' | 'rms'
  /** True-peak ceiling, dBTP (loudness targets default to -1); false disables it */
  ceiling?: number | false
  /** Remove DC offset first (default true) */
  dc?: boolean
  /** Live stream: start at once, the gain following what it has heard, the ceiling guarding what it
   *  hasn't (the target in peak mode). Default: one gain for the whole selection, waiting for its end. */
  adaptive?: boolean
  at?: Time
  duration?: Time, d?: Time
  channel?: number | number[]
}

export interface VocalsModel {
  /** Separation model preset of @audio/neural-separate: 'umxhq' (Open-Unmix), 'htdemucs', 'htdemucs_ft' (Hybrid Transformer Demucs) */
  model?: 'umxhq' | 'htdemucs' | 'htdemucs_ft' | (string & {})
  /** Where the model's files are: a URL, or a directory in Node (default ~/.cache/audiojs/neural) */
  weights?: string
  /** ONNX Runtime backend: 'node' | 'wasm' | 'webgpu' */
  device?: string
}

/** Cut lists (cuts(), encode/save to edl, otio, fcpxml) */
export interface CutOpts {
  /** Frame rate; default: the video track's (MP4/MOV), else 30 */
  fps?: number
  /** Drop-frame timecode (29.97, 59.94); default: as the file's timecode track counts */
  dropFrame?: boolean
  /** List title; default: '<file name> cuts' */
  title?: string
  /** URL written for the source file; names it when the audio came from bytes */
  url?: string
  markers?: Marker[]
  regions?: Region[]
}

export interface EncodeOpts extends CutOpts {
  at?: Time
  duration?: Time, d?: Time
  meta?: Meta | false
  markers?: Marker[]
  regions?: Region[]
  /** Sample depth for lossless formats; default: the source's (16 when unknown) */
  bitDepth?: 16 | 24 | 32
  /** kbps: mp3 (CBR), opus, aac, m4a */
  bitrate?: number
  /** VBR quality: mp3 0–9 (LAME -V), ogg 0–10 */
  quality?: number
  /** m4a/mp4 track codec: 'aac' (browser), 'alac', 'flac' (Node default), 'opus', 'mp3', 'pcm' */
  codec?: string
  /** FLAC compression level 0–8 */
  compression?: number
}


export interface AudioOpts {
  sampleRate?: number
  channels?: number
  /** Where pages go past `budget`: 'persistent' to OPFS (failing without it), 'auto' to OPFS where there is one */
  storage?: 'memory' | 'persistent' | 'auto'
  /** Bytes of pages kept in memory before cold ones go to storage */
  budget?: number
  decode?: 'worker' | 'main'
  /** Host the engine in a Worker (requires `import 'audio/worker'`); pass a Worker instance for a custom entry */
  worker?: boolean | Worker
}

export interface ProgressDelta {
  fromBlock: number
  min: Float32Array[]
  max: Float32Array[]
  energy: Float32Array[]
}

export interface PlayOpts {
  /** Where to start, and the span's start (default currentTime; the start once ended) */
  at?: Time
  /** The span's length (default: to the end) */
  duration?: Time, d?: Time
  /** Repeat the span */
  loop?: boolean
  volume?: number
  rate?: number
  /** Open without sounding; resume() plays */
  paused?: boolean
  /** Another instance (or worker facade) whose playback this one takes over where it is */
  from?: { currentTime: number }
}

export interface MeterProbe {
  /** Last computed value; undefined until first playback block fires. */
  value: any
  /** Unsubscribe. Safe to call multiple times. */
  stop(): void
}

export interface MeterOpts {
  /** Stat name(s) — any registered stat, or 'spectrum' for FFT bins. Omit for all block stats. */
  type?: string | string[]
  /** Channel selector — omit = avg, number = that channel, array = per-channel. */
  channel?: number | number[]
  /** One-pole EMA time constant τ in seconds (per-listener smoothing state). */
  smoothing?: number
  /** Peak-hold decay time constant τ in seconds (classic analyzer look). */
  hold?: number
  /** Spectrum: mel bin count. */
  bins?: number
  /** Spectrum: min frequency (Hz). */
  fMin?: number
  /** Spectrum: max frequency (Hz). */
  fMax?: number
  /** Spectrum: apply A-weighting. */
  weight?: boolean
  /** Spectrum: return dB instead of linear magnitude. */
  db?: boolean
  /** Spectrum: FFT size (power of 2, default 1024). */
  N?: number
}

export interface OpDescriptor {
  params?: string[]
  /** The shapes its `curve` param names, each the level over 0..1 (fade, crossfade) */
  curves?: Record<string, (x: number) => number>
  process?: (input: Float32Array[], output: Float32Array[], ctx: Record<string, any>) => void
  plan?: (segs: any[], ctx: Record<string, any>) => any[]
  resolve?: (ctx: Record<string, any>) => EditOp | EditOp[] | false | null
  ch?: (channels: number, ctx: Record<string, any>) => number
  /** Sample-rate transform (e.g. resample). Return the new rate, or falsy to leave it unchanged. */
  sr?: (sampleRate: number, ctx: Record<string, any>) => number | undefined
  /** Structural output length for whole-render ops (time-stretch class): input frames → output frames */
  frames?: (frames: number, ctx: Record<string, any>, sampleRate: number) => number
  /** Hosted contract plugin (audio.js manifest factory), when this op wraps one */
  plugin?: Function
  /** Pure, monotonic per-sample transform: the engine derives min/max/clipping by probing `process` with block extremes; energy/ms/dc queries re-render. */
  pointwise?: boolean
  /** Lazy module for the op (e.g. `() => import('@audio/x')`), resolved at LOAD onto `mod` before plans compile */
  load?: () => Promise<any>
  mod?: any
  /** Asynchronous work an edit needs before any render (e.g. model inference over its input), awaited per edit at LOAD after `load` */
  prepare?: (a: AudioInstance, index: number) => Promise<void>
  /** Whole-render processing, once over the entire signal (materialized plan so far) */
  whole?: (input: Float32Array[], output: Float32Array[], ctx: Record<string, any>) => void
  /** Algebraic stats update for advanced cases pointwise can't cover (e.g. rms/dc/energy) — mutate `stats` in place, or return `false` to bail to a full recompute. */
  deriveStats?: (stats: AudioStats, opts: Record<string, any>) => void | false
  /** Output delay in samples (delay compensation), or per options */
  latency?: number | ((opts: Record<string, any>, sampleRate: number) => number)
  /** Input needed before an output position: seeks and ranged reads start this much earlier */
  warmup?: number | ((opts: Record<string, any>, sampleRate: number) => number)
  /** Output that depends on a live stream's unknown end: held back this far before the current end */
  holdback?: (opts: Record<string, any>, sampleRate: number, total: number) => number
  hidden?: boolean
}

/** Serialized audio instance (from toJSON) */
export interface AudioDocument {
  source: string | null
  edits: EditOp[]
  sampleRate: number
  channels: number
  duration: number
}

/** No source — returns pushable instance. Use .push() to feed PCM, .record() for mic, .stop() to finalize. */
declare function audio(source?: null, opts?: AudioOpts): AudioInstance & {
  push(data: Float32Array[] | Float32Array | ArrayBufferView, format?: string | { format?: string, channels?: number, sampleRate?: number }): AudioInstance
  record(opts?: Record<string, any>): AudioInstance
  recording: boolean
}
/** Async entry — decode from file/URL/bytes (a byte stream, response or pipe decodes as it arrives), wrap PCM/silence, concat from array, or restore from JSON */
/** Sync entry — returns instance immediately. Thenable: `await audio(src)` waits for full decode. */
declare function audio(source: string | URL | ArrayBuffer | Uint8Array | Response | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array> | AudioBuffer | Float32Array[] | number | AudioDocument | (AudioInstance | string | URL | ArrayBuffer)[], opts?: AudioOpts): AudioInstance & PromiseLike<AudioInstance>

declare namespace audio {
  /** Package version */
  const version: string
  /** The page's AudioContext, which playback uses: made on first use, resumed by the first gesture. Set your own
   *  before playing; connect your own nodes to it. Null in Node. */
  let context: AudioContext | null
  /** Samples per PCM page chunk (default 1024 * BLOCK_SIZE). Set before creating instances. */
  let PAGE_SIZE: number
  /** Samples per stat block (default 1024). Set before creating instances. */
  let BLOCK_SIZE: number
  /** Page budget from navigator.storage.estimate() — quota/4 clamped 64MB..512MB; null when unavailable */
  function detectBudget(): Promise<number | null>
  /** OPFS-backed cache backend for large files (browser only) */
  function opfsCache(dirName?: string): Promise<{
    read(i: number): Promise<Float32Array[]>
    write(i: number, data: Float32Array[]): Promise<void>
    has(i: number): Promise<boolean>
    evict(i: number): Promise<void>
    clear(): Promise<void>
  }>
  /** Sync entry — from PCM data, AudioBuffer, audio instance (structural copy), silence, function source, or typed array with format */
  function from(source: Float32Array[] | AudioBuffer | AudioInstance | number, opts?: AudioOpts): AudioInstance
  function from(fn: (t: number, i: number) => number | number[], opts: AudioOpts & { duration: number }): AudioInstance
  function from(source: Int16Array | Int8Array | Uint8Array | Uint16Array, opts: AudioOpts & { format: string }): AudioInstance
  /** Op registration and query */
  function op(): Record<string, OpDescriptor>
  function op(name: string): OpDescriptor | undefined
  function op(name: string, descriptor: OpDescriptor | Function): void
  /** Stat registration and query */
  interface StatDescriptor {
    /** Per-block computation during decode */
    block?: (chs: Float32Array[], ctx: { sampleRate: number, [k: string]: unknown }) => number | number[]
    /** Reducer for scalar/binned queries; stats includes blockSize and sample length for weighting. */
    reduce?: (blockValues: Float32Array, from: number, to: number, stats: AudioStats) => number
    /** Derived aggregation from block stats */
    query?: (stats: AudioStats, chs: number[], from: number, to: number, sr: number) => any
    /** Block fields the query reads; derived stats lacking one re-render instead */
    fields?: string[]
  }
  function stat(): Record<string, StatDescriptor>
  function stat(name: string): StatDescriptor | undefined
  function stat(name: string, descriptor: StatDescriptor | ((chs: Float32Array[], ctx: { sampleRate: number, [k: string]: unknown }) => number | number[])): void
  /** Plugin registry — name → package specifier (e.g. 'freeverb' → '@audio/reverb-freeverb/audio'), resolved by use(name) via dynamic import */
  const plugins: Record<string, string>
  /** @deprecated ≤2.5 name — alias of `plugins` (same object) */
  const atoms: Record<string, string>
  /** Where what an edit's preparation takes long to make (a model's run over its input: deepfilter(), vocals({ model })) is kept between runs,
   *  by a key naming the model and the input's samples. Unset by default (made each time); the editor keeps them in the browser. */
  let memo: { get(key: string): Promise<Float32Array[] | null>, set(key: string, channels: Float32Array[]): Promise<void> } | null | undefined
  /** Register plugins: contract factories (audio.js manifests with own `params`), `(audio) => {}` plugin functions, or registry names. String names dynamic-import — returns a promise; direct values register synchronously. */
  /** Stat plugin — whole-signal analyzer registered as a.stat(name) */
  interface StatPlugin { stat: string, compute(channels: Float32Array[], opts: { sampleRate: number, [k: string]: unknown }): unknown }
  /** @deprecated ≤2.5 name — alias of StatPlugin */
  type StatAtom = StatPlugin
  /** Codec plugin — extends audio()'s openable formats and save()/encode() targets */
  interface CodecPlugin { codec: string, test?(bytes: Uint8Array): boolean, decode?(bytes: Uint8Array): { channelData: Float32Array[], sampleRate: number } | Promise<{ channelData: Float32Array[], sampleRate: number }>, encode?(opts: { sampleRate: number, channels: number }): ((chunk?: Float32Array[]) => Uint8Array) | Promise<(chunk?: Float32Array[]) => Uint8Array> }
  /** @deprecated ≤2.5 name — alias of CodecPlugin */
  type CodecAtom = CodecPlugin
  /** Registered codec plugins by format name */
  const codecs: Record<string, CodecPlugin>
  function use(...plugins: (string | Function | StatPlugin | CodecPlugin)[]): typeof audio & Promise<typeof audio>
  /** Audio instance prototype — extensible (like $.fn) */
  const fn: Record<string, any>
}

export default audio
