import { oklab, srgb, lightness } from './tint.js'

// VS Code colour themes read into the editor's skin (skin.css), so a sound shows in the colours its code does: the
// picture is a page of the editor, the sound its text. Each of the skin's colours is one of VS Code's, the one for the
// same part of an editor (MAP): the screen its editor's, a menu's row pointed at its menu's selection, a tab its tab's,
// the sidebar its sidebar's, a marked range its range highlight, the waveform its text. A colour a theme leaves out is
// VS Code's own default for it, by the theme's kind, as VS Code's registry makes it (REGISTRY), so a theme of three
// colours comes out as whole as VS Code draws it. The skin's own default is a theme too (themes/screen.json), skin.css
// its colours for the first paint.
// A theme is VS Code's JSON (code.visualstudio.com/api/extension-guides/color-theme): `colors`, the workbench's, by key;
// `tokenColors`, TextMate rules, a scope to a colour; `type` or the extension's uiTheme, its kind. A word it gives no
// rule, the foreground, as VS Code draws it.

// VS Code's defaults for the colours read here and those they are made from: the registerColor calls of VS Code 1.143
// (src/vs/platform/theme/common/colors/*.ts, src/vs/workbench/common/theme.ts), read out of its workbench as they
// are. A colour as #hex, another by its id, a transform of one as its ColorTransform is ([op, ...its arguments]), or
// one by the theme's kind; null, none. Then the editor's own, as an extension contributes colours (contributes.colors):
// what only the skin's default draws, none in a theme, which leaves the slab flat as VS Code's editor is
export const REGISTRY = {
  'titleBar.activeBackground': { dark: '#3C3C3C', light: '#DDDDDD', hcDark: '#000000', hcLight: '#FFFFFF' },
  'titleBar.activeForeground': { dark: '#CCCCCC', light: '#333333', hcDark: '#FFFFFF', hcLight: '#292929' },
  'toolbar.hoverBackground': { dark: '#5a5d5e50', light: '#b8b8b850', hcDark: null, hcLight: null },
  'menubar.selectionBackground': { dark: 'toolbar.hoverBackground', light: 'toolbar.hoverBackground', hcDark: null, hcLight: null },
  'editor.background': { dark: '#1E1E1E', light: '#ffffff', hcDark: '#000000', hcLight: '#FFFFFF' },
  'contrastBorder': { dark: null, light: null, hcDark: '#6FC3DF', hcLight: '#0F4A85' },
  'editorGroup.border': { dark: '#444444', light: '#E7E7E7', hcDark: 'contrastBorder', hcLight: 'contrastBorder' },
  'panel.border': { dark: ['transparent', '#808080', 0.35], light: ['transparent', '#808080', 0.35], hcDark: 'contrastBorder', hcLight: 'contrastBorder' },
  'list.hoverBackground': { dark: '#2A2D2E', light: '#F0F0F0', hcDark: ['transparent', '#FFFFFF', 0.1], hcLight: ['transparent', '#0F4A85', 0.1] },
  'input.background': { dark: '#3C3C3C', light: '#FFFFFF', hcDark: '#000000', hcLight: '#FFFFFF' },
  'strongForeground': { dark: '#FFFFFF', light: '#000000', hcDark: '#FFFFFF', hcLight: '#000000' },
  'foreground': { dark: '#CCCCCC', light: '#616161', hcDark: '#FFFFFF', hcLight: '#292929' },
  'editor.foreground': { dark: '#BBBBBB', light: '#333333', hcDark: '#FFFFFF', hcLight: 'foreground' },
  'descriptionForeground': { dark: ['transparent', 'foreground', 0.7], light: '#717171', hcDark: ['transparent', 'foreground', 0.7], hcLight: ['transparent', 'foreground', 0.7] },
  'focusBorder': { dark: '#007FD4', light: '#0090F1', hcDark: '#F38518', hcLight: '#006BBD' },
  'editorError.foreground': { dark: '#F14C4C', light: '#E51400', hcDark: '#F48771', hcLight: '#B5200D' },
  'dropdown.background': { dark: '#3C3C3C', light: '#FFFFFF', hcDark: '#000000', hcLight: '#FFFFFF' },
  'menu.background': 'dropdown.background',
  'dropdown.foreground': { dark: '#F0F0F0', light: 'foreground', hcDark: '#FFFFFF', hcLight: 'foreground' },
  'menu.foreground': 'dropdown.foreground',
  'list.activeSelectionBackground': { dark: '#04395E', light: '#0060C0', hcDark: null, hcLight: ['transparent', '#0F4A85', 0.1] },
  'menu.selectionBackground': 'list.activeSelectionBackground',
  'list.activeSelectionForeground': { dark: '#FFFFFF', light: '#FFFFFF', hcDark: null, hcLight: null },
  'menu.selectionForeground': 'list.activeSelectionForeground',
  'list.inactiveSelectionBackground': { dark: '#37373D', light: '#E4E6F1', hcDark: null, hcLight: ['transparent', '#0F4A85', 0.1] },
  'sideBar.background': { dark: '#252526', light: '#F3F3F3', hcDark: '#000000', hcLight: '#FFFFFF' },
  'editorGroupHeader.tabsBackground': { dark: '#252526', light: '#F3F3F3', hcDark: null, hcLight: null },
  'tab.activeBackground': 'editor.background',
  'tab.activeForeground': { dark: '#FFFFFF', light: '#333333', hcDark: '#FFFFFF', hcLight: '#292929' },
  'tab.inactiveForeground': { dark: ['transparent', 'tab.activeForeground', 0.5], light: ['transparent', 'tab.activeForeground', 0.7], hcDark: '#FFFFFF', hcLight: '#292929' },
  'button.background': { dark: '#0E639C', light: '#007ACC', hcDark: '#000000', hcLight: '#0F4A85' },
  'button.foreground': '#FFFFFF',
  'button.secondaryBackground': { dark: 'list.hoverBackground', light: 'list.hoverBackground', hcDark: null, hcLight: '#FFFFFF' },
  'inputOption.activeForeground': { dark: '#FFFFFF', light: '#000000', hcDark: 'foreground', hcLight: 'foreground' },
  'radio.activeForeground': 'inputOption.activeForeground',
  'radio.inactiveBorder': { dark: ['transparent', 'radio.activeForeground', 0.2], light: ['transparent', 'radio.activeForeground', 0.2], hcDark: ['transparent', 'radio.activeForeground', 0.4], hcLight: ['transparent', 'radio.activeForeground', 0.2] },
  'radio.inactiveBackground': null,
  'inputOption.activeBackground': { dark: ['transparent', 'focusBorder', 0.4], light: ['transparent', 'focusBorder', 0.2], hcDark: '#00000000', hcLight: '#00000000' },
  'radio.activeBackground': 'inputOption.activeBackground',
  'scrollbarSlider.background': { dark: ['transparent', '#797979', 0.4], light: ['transparent', '#646464', 0.4], hcDark: ['transparent', 'contrastBorder', 0.6], hcLight: ['transparent', 'contrastBorder', 0.4] },
  'editorWidget.background': { dark: '#252526', light: '#F3F3F3', hcDark: '#0C141F', hcLight: '#FFFFFF' },
  'editorHoverWidget.background': 'editorWidget.background',
  'editorCursor.foreground': { dark: '#AEAFAD', light: '#000000', hcDark: '#FFFFFF', hcLight: '#0F4A85' },
  'editor.selectionBackground': { dark: '#264F78', light: '#ADD6FF', hcDark: '#f3f518', hcLight: '#0F4A85' },
  'editor.inactiveSelectionBackground': { dark: ['transparent', 'editor.selectionBackground', 0.5], light: ['transparent', 'editor.selectionBackground', 0.5], hcDark: ['transparent', 'editor.selectionBackground', 0.7], hcLight: ['transparent', 'editor.selectionBackground', 0.5] },
  'editor.rangeHighlightBackground': { dark: '#ffffff0b', light: '#fdff0033', hcDark: null, hcLight: null },
  'editorWhitespace.foreground': { dark: '#e3e4e229', light: '#33333333', hcDark: '#e3e4e229', hcLight: '#CCCCCC' },
  'editor.lineHighlightBackground': null,
  'editorLineNumber.foreground': { dark: '#858585', light: '#237893', hcDark: '#FFFFFF', hcLight: '#292929' },
  'editor.selectionHighlightBackground': { dark: ['lessProminent', 'editor.selectionBackground', 'editor.background', 0.3, 0.6], light: ['lessProminent', 'editor.selectionBackground', 'editor.background', 0.3, 0.6], hcDark: null, hcLight: null },
  // the waveform, the text's colour; a selection on a spectrogram, the selection; the slab's shade at its foot, a key's
  // lit edge and the shadow a key pressed in casts
  'audio.waveform': 'editor.foreground',
  'audio.spectrumSelectionBackground': 'editor.selectionBackground',
  'audio.spectrumInactiveSelectionBackground': 'editor.inactiveSelectionBackground',
  'audio.slabShade': 'editor.background',
  'audio.keyHighlight': '#00000000',
  'audio.keyShadow': '#00000000'
}

// The skin's colours, each the VS Code colour of the same part (its id), or one made of them as the registry makes its
// own (a transform), or a word's colour in the theme's rules (['scope', a word of SYNTAX]). Where two parts of the
// editor are one part of VS Code's, they are one colour: what a theme can't tell apart, the skin doesn't either
export const MAP = {
  // the page round the slab, as VS Code's title bar, the menu bar's: its ground, its words, a menu or button pointed at
  '--color-paper': 'titleBar.activeBackground',
  '--color-ink': 'titleBar.activeForeground',
  '--color-hover': ['oneOf', 'menubar.selectionBackground', 'list.hoverBackground'],
  // the slab, an editor: its ground, shaded to its foot; its rim, an editor group's; the rules between its parts, a
  // panel's border
  '--color-screen': 'editor.background',
  '--color-screen-low': 'audio.slabShade',
  '--color-bezel': 'editorGroup.border',
  '--color-screen-rule': 'panel.border',
  // its words: strong, those pointed at or chosen; the editor's; softer (a panel's own words), a fifth of the way to the
  // ground; a description's (what a control is, an icon at rest, what is not to be pressed)
  '--color-screen-bright': 'strongForeground',
  '--color-screen-ink': 'editor.foreground',
  '--color-screen-soft': ['oklab', 'editor.foreground', 'editor.background', .19],
  '--color-screen-muted': 'descriptionForeground',
  // what an edit draws, its handles and curves, what is on, a focus: the workbench's focus colour; a problem, a clip, a
  // recording, a measure: an error's
  '--color-screen-accent': 'focusBorder',
  '--color-screen-error': 'editorError.foreground',
  // anything pointed at, a row, an icon, a tab: a list's row's; a field: an input's
  '--color-screen-hover': 'list.hoverBackground',
  '--color-screen-well': 'input.background',
  // what floats over the slab, a menu (the menus, the palette, a select's list, the dropdown, the code's completions): a
  // menu's, its row pointed at or the arrows' choice its selection; a tooltip, a hint: a hover's
  '--color-menu': 'menu.background',
  '--color-menu-select': ['oneOf', 'menu.selectionBackground', 'list.hoverBackground'],
  '--color-menu-select-ink': ['oneOf', 'menu.selectionForeground', 'menu.foreground'],
  '--color-tip': 'editorHoverWidget.background',
  // a row chosen in a list (a step of the edits), the list not focused, as it most often is: an inactive selection's
  '--color-list-select': ['oneOf', 'list.inactiveSelectionBackground', 'list.hoverBackground'],
  // the panel, a sidebar's
  '--color-side': 'sideBar.background',
  // the open sounds, tabs: their row, the editor group's header; the one shown, the active tab, its words; the others'
  '--color-tabs': 'editorGroupHeader.tabsBackground',
  '--color-tab': 'tab.activeBackground',
  '--color-tab-ink': 'tab.activeForeground',
  '--color-tab-off-ink': 'tab.inactiveForeground',
  // the act a part is for (Send, Search), a primary button; a lesser one, a card, a bubble, a code's well, secondary
  '--color-button': 'button.background',
  '--color-button-ink': 'button.foreground',
  '--color-quiet': 'button.secondaryBackground',
  // a switch, its choices joined, one on, as VS Code's radio buttons are: their border, a choice's ground, the one on
  // and its words, then the bevel the skin's default gives them
  '--key-bezel': 'radio.inactiveBorder',
  '--key-face': 'radio.inactiveBackground',
  '--key-pressed': 'radio.activeBackground',
  '--key-pressed-ink': 'radio.activeForeground',
  '--key-light': 'audio.keyHighlight',
  '--key-shadow': 'audio.keyShadow',
  // a scrollbar's thumb, the picture's and the page's, a slider's track
  '--color-scroll': 'scrollbarSlider.background',
  // the picture, a page of text: the caret, the cursor's; a selection, the selection's, behind the sound as behind text,
  // the inactive one's while the picture is not focused (a range marked, pointed at, as a press would select it), on a
  // spectrogram the same unless the theme gives one of its own; a
  // range marked, the range highlight (high contrast has none: the selection faint); a marker, a markdown heading, as it
  // names a section of the sound; the grid, the whitespace marks
  '--color-screen-caret': 'editorCursor.foreground',
  '--color-screen-select': 'editor.selectionBackground',
  '--color-screen-select-inactive': 'editor.inactiveSelectionBackground',
  '--color-screen-select-spectrum': 'audio.spectrumSelectionBackground',
  '--color-screen-select-spectrum-inactive': 'audio.spectrumInactiveSelectionBackground',
  '--color-screen-range': ['oneOf', 'editor.rangeHighlightBackground', ['transparent', 'editor.selectionBackground', .25]],
  '--color-screen-mark': ['scope', 'heading'],
  // the sound, the page's text: the text's colour, unless the theme gives the waveform its own
  '--color-screen-wave': 'audio.waveform',
  '--color-screen-grid': 'editorWhitespace.foreground',
  // the script's caret's line; the line numbers, the picture's axes' numbers too; the selection's other matches
  '--color-screen-line': 'editor.lineHighlightBackground',
  '--color-screen-line-number': 'editorLineNumber.foreground',
  '--color-screen-match': 'editor.selectionHighlightBackground',
  // the script's words, as the theme colours them (SYNTAX)
  '--color-screen-storage': ['scope', 'storage'],
  '--color-screen-keyword': ['scope', 'keyword'],
  '--color-screen-function': ['scope', 'function'],
  '--color-screen-variable': ['scope', 'variable'],
  '--color-screen-property': ['scope', 'property'],
  '--color-screen-type': ['scope', 'type'],
  '--color-screen-string': ['scope', 'string'],
  '--color-screen-constant': ['scope', 'constant'],
  '--color-screen-number': ['scope', 'number'],
  '--color-screen-comment': ['scope', 'comment']
}

// The words of a script, each by the scopes VS Code's JavaScript grammar gives it, outermost first; and a markdown
// heading's text, by its grammar's
const js = scope => ['source.js', scope]
export const SYNTAX = {
  number: js('constant.numeric.decimal.js'),
  string: js('string.quoted.single.js'),
  constant: js('constant.language.boolean.true.js'),
  storage: js('storage.type.js'),
  keyword: js('keyword.control.flow.js'),
  function: js('entity.name.function.js'),
  variable: js('variable.other.readwrite.js'),
  property: js('variable.other.property.js'),
  type: js('entity.name.type.js'),
  comment: js('comment.line.double-slash.js'),
  heading: ['text.html.markdown', 'markup.heading.markdown', 'heading.2.markdown', 'entity.name.section.markdown']
}
const CHANNELS = ['number', 'string', 'storage', 'type', 'variable', 'keyword']

// VS Code's own themes, shipped with it (github.com/microsoft/vscode, extensions/theme-*, MIT), here as they are
// (themes/), by their names in its picker and their kinds
export const THEMES = [
  ['Light Modern', 'light_modern.json', 'light'], ['Light+', 'light_plus.json', 'light'], ['Light 2026', '2026-light.json', 'light'],
  ['Visual Studio Light', 'light_vs.json', 'light'], ['Quiet Light', 'quietlight-color-theme.json', 'light'], ['Solarized Light', 'solarized-light-color-theme.json', 'light'],
  ['Dark Modern', 'dark_modern.json', 'dark'], ['Dark+', 'dark_plus.json', 'dark'], ['Dark 2026', '2026-dark.json', 'dark'],
  ['Visual Studio Dark', 'dark_vs.json', 'dark'], ['Abyss', 'abyss-color-theme.json', 'dark'], ['Kimbie Dark', 'kimbie-dark-color-theme.json', 'dark'],
  ['Monokai', 'monokai-color-theme.json', 'dark'], ['Monokai Dimmed', 'dimmed-monokai-color-theme.json', 'dark'], ['Red', 'Red-color-theme.json', 'dark'],
  ['Solarized Dark', 'solarized-dark-color-theme.json', 'dark'], ['Tomorrow Night Blue', 'tomorrow-night-blue-color-theme.json', 'dark'],
  ['Default High Contrast', 'hc_black.json', 'hcDark'], ['Default High Contrast Light', 'hc_light.json', 'hcLight']
].map(([name, file, kind]) => ({ name, file, kind }))

// A theme's JSON as VS Code reads it, comments and trailing commas allowed
export const parse = text => JSON.parse(text
  .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? '')
  .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (m, s, end) => s ?? end))

// A theme and those it includes, under it, each fetched beside the one including it (`get`, a URL to its text):
// { name, kind, colors, tokenColors }. One handed in as an object includes from `url`, if any. A tmTheme's rules
// (tokenColors as a path to a plist) are not read: its words take the foreground
export async function load(url, { kind = null, get = u => fetch(u).then(r => r.text()), theme = null } = {}) {
  const own = theme ?? parse(await get(url))
  const under = own.include && url ? await load(new URL(own.include, url).href, { get }) : { colors: {}, tokenColors: [] }
  return {
    name: own.name ?? under.name,
    kind: kindOf(own.type) ?? kind ?? under.kind,
    colors: { ...under.colors, ...own.colors },
    tokenColors: [...under.tokenColors, ...Array.isArray(own.tokenColors) ? own.tokenColors : []]
  }
}
// a theme's kind from its type, or from an extension's uiTheme
const kindOf = type => ({ dark: 'dark', 'vs-dark': 'dark', light: 'light', vs: 'light', hc: 'hcDark', hcDark: 'hcDark', 'hc-black': 'hcDark', hcLight: 'hcLight', 'hc-light': 'hcLight' })[type] ?? null

// Inside a VS Code webview, the workbench colours of the theme in use, as VS Code sets them on the page (--vscode-*,
// a key's dots as dashes), and its kind (the body's class): { kind, colors }. A colour opaque is #rrggbb there, one
// see-through rgba(r, g, b, a) (Color.Format.CSS.format, src/vs/base/common/color.ts), read back to #rrggbbaa. Its
// token colours VS Code keeps to itself; the extension reads its theme's file and hands them in
export function webview(doc = document) {
  const style = getComputedStyle(doc.documentElement), cls = doc.body.classList
  if (!style.getPropertyValue('--vscode-editor-background')) return null
  const keys = Object.keys(REGISTRY).filter(k => !k.startsWith('audio.'))
  const two = v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  const read = v => { const m = /^rgba\((\d+), *(\d+), *(\d+), *([\d.]+)\)$/.exec(v); return m ? '#' + [m[1], m[2], m[3]].map(c => two(+c)).join('') + two(m[4] * 255) : v }
  const colors = Object.fromEntries(keys.map(k => [k, read(style.getPropertyValue(`--vscode-${k.replace(/\./g, '-')}`).trim())]).filter(([, v]) => v))
  return { kind: cls.contains('vscode-high-contrast-light') ? 'hcLight' : cls.contains('vscode-high-contrast') ? 'hcDark' : cls.contains('vscode-light') ? 'light' : 'dark', colors, tokenColors: [] }
}

// A colour of a theme, #rgb, #rgba, #rrggbb or #rrggbbaa (the forms VS Code takes), as [r, g, b, a] 0..1; null for
// anything else, which VS Code passes over too
export function hex(c) {
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(typeof c === 'string' ? c.trim() : '')
  if (!m) return null
  const h = m[1].length < 5 ? [...m[1]].map(d => d + d).join('') : m[1]
  return [0, 2, 4, 6].map(i => i < h.length ? parseInt(h.slice(i, i + 2), 16) / 255 : 1)
}
// `p` of the way from one opaque colour to another, [r, g, b, a] 0..1, in OKLab (CSS Color 4 §12.3's color-mix default
// space), opaque
const decode = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
const mix = (a, b, p) => { const x = oklab(a.map(decode)), y = oklab(b.map(decode)); return [...srgb(x.map((v, i) => v + p * (y[i] - v))), 1] }

// VS Code's Color (src/vs/base/common/color.ts) as its registry's transforms take one: { r, g, b, a }, r, g, b whole
// 0..255, a to three places; one made from HSL keeping it, `hsl`, as VS Code's keeps the HSLA it was made from
const r3 = v => Math.round(v * 1e3) / 1e3, unit = v => Math.max(Math.min(1, v), 0)
const rgb = (r, g, b, a = 1) => ({ r: Math.min(255, Math.max(0, r)) | 0, g: Math.min(255, Math.max(0, g)) | 0, b: Math.min(255, Math.max(0, b)) | 0, a: r3(unit(a)) })
const hslOf = (h, s, l, a) => ({ h: Math.max(Math.min(360, h), 0) | 0, s: r3(unit(s)), l: r3(unit(l)), a: r3(unit(a)) })
function hsl(c) {
  if (c.hsl) return c.hsl
  const r = c.r / 255, g = c.g / 255, b = c.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (min + max) / 2, d = max - min
  let h = 0, s = 0
  if (d > 0) {
    s = Math.min(l <= .5 ? d / (2 * l) : d / (2 - 2 * l), 1)
    h = Math.round((max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60)
  }
  return hslOf(h, s, l, c.a)
}
const tone = (p, q, t) => { t = t < 0 ? t + 1 : t > 1 ? t - 1 : t; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
function fromHsl(x) {
  const { h, s, l, a } = x, k = h / 360, q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const [r, g, b] = s === 0 ? [l, l, l] : [tone(p, q, k + 1 / 3), tone(p, q, k), tone(p, q, k - 1 / 3)]
  return { ...rgb(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a), hsl: x }
}
const lighten = (c, f) => { const x = hsl(c); return fromHsl(hslOf(x.h, x.s, x.l + x.l * f, x.a)) }
const darken = (c, f) => { const x = hsl(c); return fromHsl(hslOf(x.h, x.s, x.l - x.l * f, x.a)) }
const fade = (c, f) => rgb(c.r, c.g, c.b, c.a * f)
const luminance = c => { const y = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; return Math.round((.2126 * y(c.r) + .7152 * y(c.g) + .0722 * y(c.b)) * 1e4) / 1e4 }
const lighter = (c, of, f) => { if (luminance(c) > luminance(of)) return c; f ||= .5; return lighten(c, f * (luminance(of) - luminance(c)) / luminance(of)) }
const darker = (c, of, f) => { if (luminance(c) < luminance(of)) return c; f ||= .5; return darken(c, f * (luminance(c) - luminance(of)) / luminance(c)) }
// a theme's colour (hex), as VS Code's
const colorOf = c => { const v = hex(c); return v && rgb(...v.slice(0, 3).map(x => Math.round(x * 255)), v[3]) }
// to [r, g, b, a] 0..1 and back; a colour as CSS
const unitOf = c => [c.r / 255, c.g / 255, c.b / 255, c.a], ofUnit = v => rgb(...v.slice(0, 3).map(x => Math.round(x * 255)), v[3] ?? 1)
const css = c => c ? `rgb(${c.r} ${c.g} ${c.b}${c.a < 1 ? ` / ${c.a}` : ''})` : 'transparent'
// a colour over another, opaque
const over = (c, bg) => c.a === 1 || bg.a !== 1 ? c : rgb(bg.r - c.a * (bg.r - c.r), bg.g - c.a * (bg.g - c.g), bg.b - c.a * (bg.b - c.b), 1)

// A theme's colours as VS Code resolves them (colorRegistry.ts resolveColorValue, executeTransform): an id its theme's
// own, else its default for the theme's kind (`registry`, REGISTRY or all of VS Code's: themes/vscode-colors.json); a
// transform made of those; a word's colour, the rules'. `colors`, the theme's by id; undefined where there is none
export function resolver({ kind, colors = {}, tokenColors = [] }, registry = REGISTRY) {
  const words = colourer(tokenColors), memo = new Map()
  const color = id => {
    if (!memo.has(id)) { memo.set(id, undefined); memo.set(id, colorOf(colors[id]) ?? value(registry[id])) }
    return memo.get(id)
  }
  const value = v => {
    if (v == null) return undefined
    if (typeof v === 'string') return v[0] === '#' ? colorOf(v) : color(v)
    if (!Array.isArray(v)) return value(v[kind])
    const [op, x, y, f, t] = v
    switch (op) {
      case 'transparent': { const c = value(x); return c && fade(c, y) }
      case 'lighten': { const c = value(x); return c && lighten(c, y) }
      case 'darken': { const c = value(x); return c && darken(c, y) }
      case 'opaque': { const c = value(x), bg = value(y); return c && bg ? over(c, bg) : c }
      case 'oneOf': return v.slice(1).reduce((c, w) => c ?? value(w), undefined)
      case 'mix': { const a = value(x) ?? rgb(0, 0, 0, 0), b = value(y) ?? rgb(0, 0, 0, 0), p = unit(f); return rgb(a.r + (b.r - a.r) * p, a.g + (b.g - a.g) * p, a.b + (b.b - a.b) * p, a.a + (b.a - a.a) * p) }
      case 'lessProminent': {
        const c = value(x), bg = value(y)
        return !c ? undefined : !bg ? fade(c, f * t) : fade(luminance(c) < luminance(bg) ? lighter(c, bg, f) : darker(c, bg, f), t)
      }
      // the skin's own: `f` of the way from one to the other in OKLab, each opaque over the screen; a word's colour, the
      // foreground's where no rule colours it, opaque over the screen, as text is drawn
      case 'oklab': { const bg = screen(), a = value(x), b = value(y); return a && b ? ofUnit(mix(unitOf(over(a, bg)), unitOf(over(b, bg)), f)) : a ?? b }
      case 'scope': { const c = words(SYNTAX[x]); return over(c ? ofUnit(c) : color('editor.foreground'), screen()) }
    }
    throw new Error(`no colour transform ${op}`)
  }
  const screen = () => over(color('editor.background'), rgb(0, 0, 0))
  return value
}

// The rules' colour for a scope: of the selectors matching it (a selector matches the scope it names and those under
// it, `keyword` matches `keyword.control.js`), the one naming the most of it, the later of two alike, as TextMate
// themes go; one with ancestors only where they are among the scope's (`ancestors`); null where none match
export function scoper(rules) {
  const list = []
  rules.forEach(r => {
    const fg = hex(r?.settings?.foreground)
    if (!fg || r.scope == null) return
    for (const sel of Array.isArray(r.scope) ? r.scope : String(r.scope).split(',')) {
      const parts = String(sel).trim().split(/\s+/)
      if (parts[0] && parts.every(p => /^[\w.-]+$/.test(p))) list.push({ last: parts.at(-1), parents: parts.slice(0, -1), fg })
    }
  })
  const under = (sel, scope) => scope === sel || scope.startsWith(sel + '.')
  return (scope, ancestors = []) => {
    let best = null, depth = -1
    for (const s of list) {
      if (!under(s.last, scope) || !s.parents.every(p => ancestors.some(a => under(p, a)))) continue
      const d = s.last.split('.').length * 10 + s.parents.length
      if (d >= depth) { best = s.fg; depth = d }
    }
    return best
  }
}
// A word's colour by its scopes, outermost first: its own scope's, or where no rule takes that, the nearest enclosing
// one's, as VS Code lays a scope's style over its parent's (vscode-textmate); null where none is coloured
export function colourer(rules) {
  const rule = scoper(rules)
  return stack => { for (let i = stack.length - 1; i >= 0; i--) { const c = rule(stack[i], stack.slice(0, i)); if (c) return c } return null }
}

// The skin's colours (skin.css's tokens, CSS colours) from a theme: { '--color-screen': …, … }, each its part's (MAP,
// or `map` in its place, read by `registry`), then the channels' hues. The rules without a scope set the foreground and background where
// the colours don't, as a tmTheme's first does; a theme of no kind, light or dark by its background
export function skin({ kind = null, colors = {}, tokenColors = [] }, map = MAP, registry = REGISTRY) {
  const global = tokenColors.find(r => r && r.scope == null)?.settings ?? {}
  colors = { ...hex(global.background) && { 'editor.background': global.background }, ...hex(global.foreground) && { 'editor.foreground': global.foreground }, ...colors }
  const bg0 = hex(colors['editor.background'])
  kind ??= bg0 ? (lightness(bg0) > .5 ? 'light' : 'dark') : 'dark'
  const value = resolver({ kind, colors, tokenColors }, registry), bg = unitOf(value(['opaque', 'editor.background', '#000000']))
  // the channels' hues: the text's, then the words' where they are hues (a grey is none: a theme of greys leaves the
  // channels the even round), each apart from those before it and from the screen
  const lab = c => oklab(c.map(decode)), apart = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i])) > .08, hued = c => Math.hypot(...lab(c).slice(1)) > .04
  const hues = []
  for (const c of [['opaque', 'editor.foreground', ['opaque', 'editor.background', '#000000']], ...CHANNELS.map(k => ['scope', k])].map(w => unitOf(value(w)))) if ((!hues.length || hued(c)) && apart(c, bg) && hues.every(h => apart(c, h))) hues.push(c)
  return {
    ...Object.fromEntries(Object.entries(map).map(([k, v]) => [k, css(value(v))])),
    ...Object.fromEntries(hues.map((c, i) => [`--color-screen-channel-${i + 1}`, css(ofUnit(c))]))
  }
}

// VS Code's fonts, a setting's, not a theme's (a theme has none): the editor's, for what an editor sets in it (the
// script, the picture's numbers, as its line numbers are, at its size), the workbench's for the rest. `editor`, `size`
// and `ui` as VS Code has them set; unset, its defaults for the platform: the editor's EDITOR_FONT_DEFAULTS
// (src/vs/editor/common/config/fontInfo.ts), the workbench's its style.css's .mac, .windows, .linux
export function fonts({ editor, size, ui } = {}, platform = globalThis.navigator?.platform ?? '') {
  const os = /Mac|iPhone|iPad/.test(platform) ? 'mac' : /Win/.test(platform) ? 'windows' : 'linux'
  const own = { mac: ["Menlo, Monaco, 'Courier New', monospace", 12, '-apple-system, BlinkMacSystemFont, sans-serif'], windows: ["Consolas, 'Courier New', monospace", 14, "'Segoe WPC', 'Segoe UI', sans-serif"], linux: ["'Droid Sans Mono', monospace", 14, "system-ui, Ubuntu, 'Droid Sans', sans-serif"] }[os]
  const px = `${parseFloat(size) || own[1]}px`
  return { '--font-mono': editor || own[0], '--font-body': ui || own[2], '--font-size-code': px, '--font-size-label': px }
}
// Inside a VS Code webview, the fonts VS Code has set, as it sets them on the page
export const webviewFonts = (doc = document) => {
  const style = getComputedStyle(doc.documentElement), v = k => style.getPropertyValue(`--vscode-${k}`).trim()
  return fonts({ editor: v('editor-font-family'), size: v('editor-font-size'), ui: v('font-family') })
}

// A skin worn: its colours set on the page over skin.css's, those of the one before gone; none, skin.css's own
let worn = []
export function wear(tokens, el = document.documentElement) {
  for (const k of worn) el.style.removeProperty(k)
  worn = Object.keys(tokens ?? {})
  for (const k of worn) el.style.setProperty(k, tokens[k])
}
