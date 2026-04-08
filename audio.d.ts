/**
 * audio — paged audio instance with declarative ops.
 */

/** Time value: seconds as number, or parseable string ('1.5s', '500ms', '1:30') */
type Time = number | string

type AudioSource = AudioInstance | AudioBuffer | Float32Array[] | number
type FilterType = 'highpass' | 'lowpass' | 'bandpass' | 'notch' | 'eq' | 'lowshelf' | 'highshelf'

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
  /** Current position in seconds (read/write, or use seek()) */
  currentTime: number
  /** True when playing */
  playing: boolean
  /** True when paused */
  paused: boolean
  /** Playback volume in dB (0 = unity) */
  volume: number
  /** Whether playback loops */
  loop: boolean
  /** Current playback block for visualization */
  block: Float32Array | null

  // ── Events ──────────────────────────────────────────────────────
  /** Subscribe to instance event */
  on(event: 'change', fn: () => void): this
  on(event: 'progress', fn: (event: { delta: ProgressDelta, offset: number, sampleRate: number, channels: number }) => void): this
  on(event: 'timeupdate', fn: (time: number) => void): this
  on(event: 'ended', fn: () => void): this
  on(event: string, fn: (...args: any[]) => void): this
  /** Unsubscribe from instance event */
  off(event: string, fn: (...args: any[]) => void): this
  /** Dispose — stop playback/recording, clear listeners, release caches */
  dispose(): void

  // ── Core I/O ────────────────────────────────────────────────────
  /** Move playhead — preloads nearby pages, triggers seek if playing */
  seek(t: number): this
  /** Read audio data. Channel option returns single Float32Array. */
  read(opts?: { at?: Time, duration?: Time, channel?: number, format?: string, meta?: Record<string, any> }): Promise<Float32Array[] | Float32Array | Int16Array[] | Uint8Array[] | Uint8Array>
  /** Async iterator over materialized blocks */
  stream(opts?: { at?: Time, duration?: Time }): AsyncGenerator<Float32Array[], void, unknown>
  /** Ensure stats are fresh, return stats + block range */
  stat(name: 'db' | 'rms' | 'loudness', opts?: { at?: Time, duration?: Time }): Promise<number>
  stat(name: 'clip', opts?: { at?: Time, duration?: Time }): Promise<Float32Array>
  stat(name: 'clip', opts: { bins: number, at?: Time, duration?: Time }): Promise<Float32Array>
  stat(name: 'dc', opts?: { at?: Time, duration?: Time }): Promise<number>
  stat(name: 'min' | 'max', opts?: { at?: Time, duration?: Time }): Promise<number>
  stat(name: 'min' | 'max', opts: { bins: number, at?: Time, duration?: Time, channel?: number }): Promise<Float32Array>
  stat(name: 'min' | 'max', opts: { bins: number, at?: Time, duration?: Time, channel: number[] }): Promise<Float32Array[]>
  stat(name: 'spectrum', opts?: { bins?: number, at?: Time, duration?: Time, fMin?: number, fMax?: number, weight?: boolean }): Promise<Float32Array>
  stat(name: 'cepstrum', opts?: { bins?: number, at?: Time, duration?: Time }): Promise<Float32Array>
  stat(name: 'silence', opts?: { threshold?: number, minDuration?: number, at?: Time, duration?: Time }): Promise<{ at: number, duration: number }[]>
  stat<T extends string[]>(name: T, opts?: { at?: Time, duration?: Time, bins?: number, channel?: number | number[] }): Promise<{ [K in keyof T]: number | Float32Array | Float32Array[] }>
  stat(name: string, opts?: { at?: Time, duration?: Time, bins?: number, channel?: number | number[] }): Promise<number | Float32Array | Float32Array[]>
  spectrum(opts?: { bins?: number, at?: Time, duration?: Time, fMin?: number, fMax?: number, weight?: boolean }): Promise<Float32Array>
  cepstrum(opts?: { bins?: number, at?: Time, duration?: Time }): Promise<Float32Array>
  silence(opts?: { threshold?: number, minDuration?: number, at?: Time, duration?: Time }): Promise<{ at: number, duration: number }[]>
  /** Serialize to JSON */
  toJSON(): { source: string | null, edits: EditOp[], sampleRate: number, channels: number, duration: number }

  // ── Structural ops ───────────────────────────────────────────
  crop(opts?: { at?: Time, duration?: Time }): this
  insert(other: AudioSource, opts?: { at?: Time }): this
  remove(opts?: { at?: Time, duration?: Time }): this
  repeat(times: number, opts?: { at?: Time, duration?: Time }): this
  pad(before: number, after?: number): this
  speed(rate: number): this

  // ── Sample ops ──────────────────────────────────────────────
  gain(value: number | ((t: number) => number), opts?: { at?: Time, duration?: Time, channel?: number | number[], unit?: 'db' | 'linear' }): this
  fade(duration: Time, curve?: 'linear' | 'exp' | 'log' | 'cos', opts?: { at?: Time }): this
  reverse(opts?: { at?: Time, duration?: Time }): this
  mix(other: AudioSource, opts?: { at?: Time, duration?: Time }): this
  write(data: Float32Array[] | Float32Array, opts?: { at?: Time }): this
  remix(channels: number): this
  pan(value: number | ((t: number) => number), opts?: { at?: Time, duration?: Time, channel?: number | number[] }): this

  // ── Filters ──────────────────────────────────────────────────
  filter(type: FilterType, ...params: number[]): this
  filter(fn: (data: Float32Array, params: Record<string, unknown>) => Float32Array, opts?: Record<string, unknown>): this
  highpass(freq: number): this
  lowpass(freq: number): this
  bandpass(freq: number, Q?: number): this
  notch(freq: number, Q?: number): this
  eq(freq: number, gain?: number, Q?: number): this
  lowshelf(freq: number, gain?: number, Q?: number): this
  highshelf(freq: number, gain?: number, Q?: number): this

  // ── Smart ops ───────────────────────────────────────────────
  trim(threshold?: number): this
  normalize(): this
  normalize(preset: 'streaming' | 'podcast' | 'broadcast'): this
  normalize(targetDb: number, opts?: 'lufs' | { mode?: 'peak' | 'lufs' | 'rms', at?: Time, duration?: Time, channel?: number | number[] }): this
  normalize(opts: { target?: number, mode?: 'peak' | 'lufs' | 'rms', at?: Time, duration?: Time, channel?: number | number[], dc?: boolean, ceiling?: number }): this

  // ── Fns (registered via audio.fn) ───────────────────────────
  view(opts?: { at?: Time, duration?: Time }): AudioInstance
  split(...offsets: Time[]): AudioInstance[]
  undo(n?: number): EditOp | EditOp[] | null
  run(...edits: EditOp[]): this
  transform(fn: (channels: Float32Array[], ctx: any) => Float32Array[] | false | null): this
  play(opts?: { at?: Time, duration?: Time, volume?: number, loop?: boolean }): this
  pause(): void
  resume(): void
  stop(): this
  save(target: string | FileSystemWritableFileStream, opts?: { format?: string, at?: Time, duration?: Time, meta?: Record<string, any> }): Promise<void>
  encode(format?: string, opts?: { at?: Time, duration?: Time, meta?: Record<string, any> }): Promise<Uint8Array>
  encode(opts?: { at?: Time, duration?: Time, meta?: Record<string, any> }): Promise<Uint8Array>
  clone(): AudioInstance
  concat(...sources: AudioSource[]): AudioInstance
}

export interface AudioStats {
  blockSize: number
  min: Float32Array[]
  max: Float32Array[]
  energy: Float32Array[]
  [field: string]: number | Float32Array[]
}

export interface EditOp {
  type: string
  [key: string]: any
}


export interface AudioOpts {
  sampleRate?: number
  channels?: number
  storage?: 'memory' | 'persistent' | 'auto'
  decode?: 'worker' | 'main'
}

export interface ProgressDelta {
  fromBlock: number
  min: Float32Array[]
  max: Float32Array[]
  energy: Float32Array[]
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
/** Async entry — decode from file/URL/bytes, wrap PCM/silence, concat from array, or restore from JSON */
/** Sync entry — returns instance immediately. Thenable: `await audio(src)` waits for full decode. */
declare function audio(source: string | URL | ArrayBuffer | Uint8Array | AudioBuffer | Float32Array[] | number | AudioDocument | (AudioInstance | string | URL | ArrayBuffer)[], opts?: AudioOpts): AudioInstance & PromiseLike<AudioInstance>

declare namespace audio {
  /** Package version */
  const version: string
  /** Samples per PCM page chunk (default 65536). Set before creating instances. */
  let PAGE_SIZE: number
  /** Samples per stat block (default 1024). Set before creating instances. */
  let BLOCK_SIZE: number
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
  function op(name: string): { process: Function, plan?: Function, resolve?: Function, ch?: Function, overlap?: number, help?: { usage: string, desc: string, examples: string[] } } | undefined
  function op(name: string, process: Function, plan?: Function, opts?: { resolve?: Function, ch?: Function, overlap?: number, help?: { usage: string, desc: string, examples: string[] } }): void
  function op(name: string, process: Function, opts?: { resolve?: Function, ch?: Function, overlap?: number, help?: { usage: string, desc: string, examples: string[] } }): void
  /** Register lifecycle callback */
  function on(event: 'create', fn: (instance: AudioInstance) => void): void
  /** Register custom stat */
  const stat: Record<string, (chs: Float32Array[], ctx: { sampleRate: number, state: Record<string, unknown> }) => number | number[]>
  /** Audio instance prototype — extensible (like $.fn) */
  const fn: Record<string, any>
}

export default audio

/** Audio instance prototype — extensible */
export const fn: Record<string, any>
