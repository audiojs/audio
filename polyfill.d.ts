/** HTMLAudioElement where there is none: `import 'audio/polyfill'` sets globalThis.Audio when the runtime lacks it. */

export class MediaError {
  static readonly MEDIA_ERR_ABORTED: 1
  static readonly MEDIA_ERR_NETWORK: 2
  static readonly MEDIA_ERR_DECODE: 3
  static readonly MEDIA_ERR_SRC_NOT_SUPPORTED: 4
  readonly code: 1 | 2 | 3 | 4
  readonly message: string
}

export class TimeRanges {
  readonly length: number
  start(index: number): number
  end(index: number): number
}

type MediaEvent = 'abort' | 'canplay' | 'canplaythrough' | 'durationchange' | 'emptied' | 'ended' | 'error' | 'loadeddata'
  | 'loadedmetadata' | 'loadstart' | 'pause' | 'play' | 'playing' | 'progress' | 'ratechange' | 'seeked' | 'seeking'
  | 'stalled' | 'suspend' | 'timeupdate' | 'volumechange' | 'waiting'

export class Audio extends EventTarget {
  static readonly HAVE_NOTHING: 0
  static readonly HAVE_METADATA: 1
  static readonly HAVE_CURRENT_DATA: 2
  static readonly HAVE_FUTURE_DATA: 3
  static readonly HAVE_ENOUGH_DATA: 4
  static readonly NETWORK_EMPTY: 0
  static readonly NETWORK_IDLE: 1
  static readonly NETWORK_LOADING: 2
  static readonly NETWORK_NO_SOURCE: 3
  readonly HAVE_NOTHING: 0
  readonly HAVE_METADATA: 1
  readonly HAVE_CURRENT_DATA: 2
  readonly HAVE_FUTURE_DATA: 3
  readonly HAVE_ENOUGH_DATA: 4
  readonly NETWORK_EMPTY: 0
  readonly NETWORK_IDLE: 1
  readonly NETWORK_LOADING: 2
  readonly NETWORK_NO_SOURCE: 3

  /** A path, a URL, bytes or a Blob: whatever audio() opens */
  constructor(src?: string | URL | ArrayBuffer | Uint8Array | Blob)
  src: string | URL | ArrayBuffer | Uint8Array | Blob
  readonly currentSrc: string
  readonly readyState: 0 | 1 | 2 | 3 | 4
  readonly networkState: 0 | 1 | 2 | 3
  readonly error: MediaError | null
  readonly paused: boolean
  readonly ended: boolean
  readonly seeking: boolean
  readonly duration: number
  readonly buffered: TimeRanges
  readonly seekable: TimeRanges
  readonly played: TimeRanges
  currentTime: number
  volume: number
  muted: boolean
  defaultMuted: boolean
  playbackRate: number
  defaultPlaybackRate: number
  preservesPitch: boolean
  loop: boolean
  autoplay: boolean
  preload: '' | 'none' | 'metadata' | 'auto'
  controls: boolean
  crossOrigin: string | null

  load(): void
  play(): Promise<void>
  pause(): void
  fastSeek(time: number): void
  canPlayType(type: string): '' | 'maybe' | 'probably'

  onabort: ((ev: Event) => any) | null
  oncanplay: ((ev: Event) => any) | null
  oncanplaythrough: ((ev: Event) => any) | null
  ondurationchange: ((ev: Event) => any) | null
  onemptied: ((ev: Event) => any) | null
  onended: ((ev: Event) => any) | null
  onerror: ((ev: Event) => any) | null
  onloadeddata: ((ev: Event) => any) | null
  onloadedmetadata: ((ev: Event) => any) | null
  onloadstart: ((ev: Event) => any) | null
  onpause: ((ev: Event) => any) | null
  onplay: ((ev: Event) => any) | null
  onplaying: ((ev: Event) => any) | null
  onprogress: ((ev: Event) => any) | null
  onratechange: ((ev: Event) => any) | null
  onseeked: ((ev: Event) => any) | null
  onseeking: ((ev: Event) => any) | null
  onstalled: ((ev: Event) => any) | null
  onsuspend: ((ev: Event) => any) | null
  ontimeupdate: ((ev: Event) => any) | null
  onvolumechange: ((ev: Event) => any) | null
  onwaiting: ((ev: Event) => any) | null
  addEventListener(type: MediaEvent, listener: (ev: Event) => any, options?: boolean | AddEventListenerOptions): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void
}

export default Audio
