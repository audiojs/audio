/**
 * audio — indexed, paged audio document with immutable source and declarative ops.
 */

export const PAGE_SIZE: number
export const BLOCK_SIZE: number

/** Audio instance — the paged audio document */
export interface AudioInstance {
  /** Decoded PCM pages */
  pages: Array<{ data: Float32Array[] | null }>
  /** Always-resident index: per-channel, per-block min/max/energy */
  index: AudioIndex
  /** Sample rate in Hz */
  sampleRate: number
  /** Number of channels */
  numberOfChannels: number
  /** Alias for numberOfChannels */
  readonly channels: number
  /** Total samples */
  length: number
  /** Duration in seconds */
  readonly duration: number
  /** Encoded source bytes (for re-decode/paging), null for PCM-backed */
  source: ArrayBuffer | null
  /** Storage mode: 'memory' | 'persistent' | 'auto' */
  storage: string
  /** Edit list (inspectable) */
  edits: EditOp[]
  /** Monotonic counter, increments on edit/undo */
  version: number
  /** Callback fired on edit/undo */
  onchange: (() => void) | null

  // ── Structural ops ───────────────────────────────────────────
  /** Extract sub-range as new audio (shares source pages) */
  slice(offset: number, duration: number): AudioInstance
  /** Insert other audio at position (seconds) */
  insert(other: AudioInstance, offset?: number): this
  /** Delete range */
  remove(offset: number, duration: number): this
  /** Add silence */
  pad(duration: number, opts?: { side?: 'start' | 'end' }): this
  /** Repeat N times */
  repeat(times: number): this

  // ── Sample ops ───────────────────────────────────────────────
  /** Adjust volume in dB, optionally within range */
  gain(db: number, offset?: number, duration?: number): this
  /** Fade in (+seconds) or out (-seconds) */
  fade(duration: number): this
  /** Reverse sample order, optionally within range */
  reverse(offset?: number, duration?: number): this
  /** Overlay other audio */
  mix(other: AudioInstance, offset?: number, duration?: number): this
  /** Overwrite region with data */
  write(data: Float32Array[] | Float32Array, offset?: number): this

  // ── Smart ops ────────────────────────────────────────────────
  /** Remove silence from edges (threshold in dB, default -40) */
  trim(threshold?: number): this
  /** Normalize to target dBFS (default 0) */
  normalize(targetDb?: number): this

  // ── Output ───────────────────────────────────────────────────
  /** Read PCM data. Returns copies. Optional sub-range and format conversion. */
  read(offset?: number, duration?: number, opts?: { format?: 'int16' | 'uint8' }): Promise<Float32Array[] | Int16Array[] | Uint8Array[]>
  /** Encode to format (e.g. 'wav', 'mp3') */
  encode(format: string): Promise<Uint8Array>
  /** Save to file path (Node) or FileSystemFileHandle (browser) */
  save(target: string | FileSystemWritableFileStream): Promise<void>

  // ── Analysis ─────────────────────────────────────────────────
  /** Amplitude range. Instant from index when clean, materializes dirty blocks. */
  limits(offset?: number, duration?: number): Promise<{ min: number, max: number }>
  /** Integrated LUFS loudness (BS.1770). */
  loudness(offset?: number, duration?: number): Promise<number>
  /** Downsampled waveform peaks. Per-channel via { channel }. */
  peaks(count: number, opts?: { channel?: number }): Promise<{ min: Float32Array, max: Float32Array }>

  // ── Playback ─────────────────────────────────────────────────
  /** Start playback. Returns controller. Parallel by default. */
  play(offset?: number, duration?: number): PlaybackController

  // ── Streaming ────────────────────────────────────────────────
  /** Async iterator over materialized blocks (Float32Array[] per page) */
  stream(offset?: number, duration?: number): AsyncGenerator<Float32Array[], void, unknown>

  // ── History ──────────────────────────────────────────────────
  /** Pop last edit. Returns the removed edit, or null if empty. */
  /** Pop last edit. Returns the removed edit, or null if empty. */
  undo(): EditOp | null
  /** Re-apply a previously undone edit */
  redo(edit: EditOp): this
  /** Serialize edits to JSON */
  toJSON(): { edits: EditOp[], sampleRate: number, channels: number, duration: number }
}

export interface AudioIndex {
  blockSize: number
  min: Float32Array[]
  max: Float32Array[]
  energy: Float32Array[]
}

export interface EditOp {
  type: string
  [key: string]: any
}

export interface PlaybackController {
  playing: boolean
  currentTime: number
  ontimeupdate: ((time: number) => void) | null
  onended: (() => void) | null
  pause(): void
  stop(): void
}

export interface DefineOpts {
  /** Number of custom args before offset/duration. 0 = a.name(offset?, duration?). 1 = a.name(arg, offset?, duration?). */
  args?: number
  /** If true, index survives this op (default false = dirty). */
  index?: boolean
}

export interface AudioOpts {
  sampleRate?: number
  channels?: number
  storage?: 'memory' | 'persistent' | 'auto'
  onprogress?: (event: { delta: ProgressDelta, offset: number, total: number }) => void
}

export interface ProgressDelta {
  fromBlock: number
  min: Float32Array[]
  max: Float32Array[]
  energy: Float32Array[]
}

/** Async entry — decode from file/URL/bytes, or wrap PCM/silence */
declare function audio(source: string | URL | ArrayBuffer | Uint8Array | Float32Array[] | number, opts?: AudioOpts): Promise<AudioInstance>

declare namespace audio {
  /** Sync entry — from PCM data, AudioBuffer, or silence */
  function from(source: Float32Array[] | AudioBuffer | number, opts?: AudioOpts): AudioInstance
  /** Register custom sample op */
  function op(name: string, fn: (block: Float32Array[], arg?: any, ctx?: { offset: number, sampleRate: number, blockSize: number }) => Float32Array[]): void
  function op(name: string, opts: DefineOpts, fn: (block: Float32Array[], arg?: any, ctx?: { offset: number, sampleRate: number, blockSize: number }) => Float32Array[]): void
}

export default audio
