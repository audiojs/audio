// The curves a fade and a crossfade go by, each by its name: the gain over progress x ∈ [0, 1] (fn/fade.js,
// fn/crossfade.js, which say what each is for). A module with no imports, so a page draws them without the library
export const FADES = {
  linear: t => t,
  exp: t => t * t,
  log: t => Math.sqrt(t),
  cos: t => (1 - Math.cos(t * Math.PI)) / 2
}
export const CROSSFADES = { ...FADES, equal: x => Math.sin(x * Math.PI / 2) }
