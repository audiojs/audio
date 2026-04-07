/**
 * audio — paged audio instance with declarative ops.
 */

/** Core audio instance — properties and I/O. Ops, stats, and fns extend this via registration. */
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
  /** Whether source is fully decoded */
  decoded: boolean
  /** Edit list (inspectable) */
  edits: EditOp[]
  /** Monotonic counter, increments on edit/undo */
  version: number
  /** Callback fired on edit/undo */
  onchange: (() => void) | null
  /** Playback hint — preloads nearby pages */
  cursor: number

  // ── Core I/O ────────────────────────────────────────────────
  /** Read audio data. Channel option returns single Float32Array. */
  read(opts?: { at?: number, duration?: number, channel?: number, format?: string, meta?: Record<string, any> }): Promise<Float32Array[] | Float32Array | Int16Array[] | Uint8Array[] | Uint8Array>
  /** Async iterator over materialized blocks */
  stream(opts?: { at?: number, duration?: number }): AsyncGenerator<Float32Array[], void, unknown>
  /** Ensure stats are fresh, return stats + block range */
  stat(name: 'db' | 'rms' | 'loudness', opts?: { at?: number, duration?: number }): Promise<number>
  stat(name: 'clip', opts?: { at?: number, duration?: number }): Promise<number>
  stat(name: 'dc', opts?: { at?: number, duration?: number }): Promise<number>
  stat(name: 'min' | 'max', opts?: { at?: number, duration?: number }): Promise<number>
  stat(name: 'min' | 'max', opts: { bins: number, at?: number, duration?: number, channel?: number }): Promise<Float32Array>
  stat(name: 'min' | 'max', opts: { bins: number, at?: number, duration?: number, channel: number[] }): Promise<Float32Array[]>
  stat(name: 'spectrum', opts?: { bins?: number, at?: number, duration?: number, fMin?: number, fMax?: number, weight?: boolean }): Promise<Float32Array>
  stat(name: 'cepstrum', opts?: { bins?: number, at?: number, duration?: number }): Promise<Float32Array>
  stat(name: string, opts?: { at?: number, duration?: number, bins?: number, channel?: number | number[] }): Promise<number | Float32Array | Float32Array[]>
  spectrum(opts?: { bins?: number, at?: number, duration?: number, fMin?: number, fMax?: number, weight?: boolean }): Promise<Float32Array>
  cepstrum(opts?: { bins?: number, at?: number, duration?: number }): Promise<Float32Array>
  /** Serialize to JSON */
  toJSON(): { source: string | null, edits: EditOp[], sampleRate: number, channels: number, duration: number }

  type OpOpts = { at?: number, duration?: number, channel?: number | number[] }

  // ── Structural ops ───────────────────────────────────────────
  crop(opts?: { at?: number, duration?: number }): this
  insert(other: AudioInstance, opts?: { at?: number }): this
  remove(opts?: { at?: number, duration?: number }): this
  repeat(times: number, opts?: { at?: number, duration?: number }): this
  pad(before: number, after?: number): this

  // ── Sample ops ──────────────────────────────────────────────
  gain(db: number | ((t: number) => number), opts?: OpOpts): this
  fade(duration: number, curve?: 'linear' | 'exp' | 'log' | 'cos', opts?: { at?: number }): this
  reverse(opts?: { at?: number, duration?: number }): this
  mix(other: AudioInstance, opts?: { at?: number, duration?: number }): this
  write(data: Float32Array[] | Float32Array, opts?: { at?: number }): this
  remix(channels: number): this
  pan(value: number | ((t: number) => number), opts?: OpOpts): this

  // ── Filters ──────────────────────────────────────────────────
  filter(type: 'highpass' | 'lowpass' | 'bandpass' | 'notch' | 'eq' | 'lowshelf' | 'highshelf', ...params: number[]): this

  // ── Smart ops ───────────────────────────────────────────────
  trim(threshold?: number): this
  normalize(preset: 'streaming' | 'podcast' | 'broadcast'): this
  normalize(targetDb?: number, opts?: 'lufs' | { mode?: 'peak' | 'lufs' }): this

  // ── Fns (registered via audio.fn) ───────────────────────────
  view(opts?: { at?: number, duration?: number }): AudioInstance
  split(...offsets: number[]): AudioInstance[]
  undo(n?: number): EditOp | EditOp[] | null
  run(...edits: EditOp[]): this
  transform(fn: (channels: Float32Array[], ctx: any) => Float32Array[] | false | null): this
  play(opts?: { at?: number, duration?: number, volume?: number, loop?: boolean }): this
  pause(): void
  resume(): void
  stop(): void
  seek(t: number): void
  save(target: string | FileSystemWritableFileStream, opts?: { format?: string, meta?: Record<string, any> }): Promise<void>
  encode(format?: string, opts?: { at?: number, duration?: number, meta?: Record<string, any> }): Promise<Uint8Array>
  encode(opts?: { at?: number, duration?: number, meta?: Record<string, any> }): Promise<Uint8Array>
  clone(): AudioInstance
  concat(...sources: (AudioInstance | Float32Array[] | number)[]): AudioInstance

  // ── Playback state ──────────────────────────────────────────
  playing: boolean
  paused: boolean
  currentTime: number
  volume: number
  loop: boolean
  block: Float32Array | null
  ontimeupdate: ((time: number) => void) | null
  onended: (() => void) | null
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
  onprogress?: (event: { delta: ProgressDelta, offset: number, total: number }) => void
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

/** Async entry — decode from file/URL/bytes, wrap PCM/silence, concat from array, or restore from JSON */
declare function audio(source: string | URL | ArrayBuffer | Uint8Array | Float32Array[] | number | AudioDocument | (AudioInstance | string | URL | ArrayBuffer)[], opts?: AudioOpts): Promise<AudioInstance>

declare namespace audio {
  /** Package version */
  const version: string
  /** Samples per page */
  const PAGE_SIZE: number
  /** Samples per stat block */
  const BLOCK_SIZE: number
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
  function from(fn: (i: number, sampleRate: number) => number | number[], opts: AudioOpts & { duration: number }): AudioInstance
  function from(source: Int16Array | Int8Array | Uint8Array | Uint16Array, opts: AudioOpts & { format: string }): AudioInstance
  /** Open encoded source for streaming decode. Instance is usable immediately; .loaded resolves when fully decoded. */
  function open(source: string | URL | ArrayBuffer | Uint8Array, opts?: AudioOpts): Promise<AudioInstance & { loaded: Promise<AudioInstance> }>
  /** Create push-based recording instance. Call .push() to feed PCM, .stop() to finalize. */
  function record(opts?: AudioOpts): AudioInstance & {
    push(data: Float32Array | Float32Array[], sampleRate?: number): void
    stop(): AudioInstance
  }
  /** Concatenate multiple sources into one audio instance */
  function concat(...sources: (AudioInstance | Float32Array[] | number)[]): AudioInstance
  /** Op handlers — assign to register + auto-wire instance method */
  const op: Record<string, Function>
  /** Register custom stat */
  function stat(name: string, init: () => (channels: Float32Array[], ctx: { sampleRate: number }) => number | number[]): void
  function stat(name: string, fn: (channels: Float32Array[]) => number | number[]): void
  /** Register a plain method on audio proto */
  function fn(name: string, fn: Function): void
}

export default audio

/** Audio instance prototype — extensible */
export const fn: Record<string, any>
