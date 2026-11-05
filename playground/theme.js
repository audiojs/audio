import { oklab, srgb, lightness } from './tint.js'
import { WORDS, MEANINGS } from './syntax.js'

// VS Code colour themes read into the editor's skin (skin.css), so a sound shows in the colours its code does: the
// picture is a page of the editor, the sound its text. Each of the skin's colours is one of VS Code's, the one for the
// same part of an editor (MAP): the screen its editor's, a menu's row pointed at its menu's selection, a tab its tab's,
// the sidebar its sidebar's, a marked range its range highlight, the waveform its text. A colour a theme leaves out is
// VS Code's own default for it, by the theme's kind, as VS Code's registry makes it (REGISTRY), so a theme of three
// colours comes out as whole as VS Code draws it. The skin's own default is a theme too (themes/screen.json), skin.css
// its colours for the first paint.
// A theme is VS Code's JSON (code.visualstudio.com/api/extension-guides/color-theme): `colors`, the workbench's, by key;
// `tokenColors`, TextMate rules, a scope to a colour and a font style; `semanticHighlighting` and `semanticTokenColors`,
// the semantic tokens over them; `type` or the extension's uiTheme, its kind. The script's words take the rules as VS
// Code's editor does (styler, semantics; the words syntax.js), a word no rule colours the foreground.

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
  '--color-screen-match': 'editor.selectionHighlightBackground'
  // (the script's words, after these: skin, styles)
}

// A word of each kind, by the scopes VS Code's JavaScript grammar gives it, outermost first, whose colours the
// channels' hues are taken from; and a markdown heading's text, by its grammar's
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
// { name, kind, colors, tokenColors, semanticHighlighting, semanticTokenColors }, semantic highlighting on where any
// of them turns it on, as VS Code reads an include chain (colorThemeData.ts _loadColorTheme). One handed in as an
// object includes from `url`, if any. A tmTheme's rules (tokenColors as a path to a plist) are not read: its words
// take the foreground
export async function load(url, { kind = null, get = u => fetch(u).then(r => r.text()), theme = null } = {}) {
  const own = theme ?? parse(await get(url))
  const under = own.include && url ? await load(new URL(own.include, url).href, { get }) : { colors: {}, tokenColors: [], semanticHighlighting: false, semanticTokenColors: {} }
  return {
    name: own.name ?? under.name,
    kind: kindOf(own.type) ?? kind ?? under.kind,
    colors: { ...under.colors, ...own.colors },
    tokenColors: [...under.tokenColors, ...Array.isArray(own.tokenColors) ? own.tokenColors : []],
    semanticHighlighting: under.semanticHighlighting || !!own.semanticHighlighting,
    semanticTokenColors: { ...under.semanticTokenColors, ...own.semanticTokenColors?.constructor === Object && own.semanticTokenColors }
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
  const words = styler(tokenColors), memo = new Map()
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
      case 'scope': { const c = words(SYNTAX[x]).fg; return over(c ? ofUnit(c) : color('editor.foreground'), screen()) }
    }
    throw new Error(`no colour transform ${op}`)
  }
  const screen = () => over(color('editor.background'), rgb(0, 0, 0))
  return value
}

// The rule for a scope, as VS Code's TextMate engine matches a theme's (vscode-textmate src/theme.ts: parseTheme,
// resolveParsedThemeRules, ThemeTrieElement, Theme.match): each selector a scope and the ancestors before it, sorted by
// scope, then ancestors, then place, and laid into a tree by the scope's parts, each part taking what the shorter one
// above it sets and it leaves unset; a scope matched at the longest of its parts the tree has, by the most specific of
// the rules there (the deepest, then the longer ancestor names, then the more of them) whose ancestors are the scope's,
// nearest first, in order (`>` one its parent). { fg, font }: a colour [r, g, b, a] 0..1 or null, the font style's
// bits (FONT) or -1, either unset where no rule sets it; null where no rule is there at all. A rule without a scope or
// without settings is passed over, as VS Code passes it over (colorThemeData.ts tokenColors), the default the editor's
export const FONT = { italic: 1, bold: 2, underline: 4, strikethrough: 8 }
export function scoper(rules) {
  const parsed = []
  rules.forEach((r, index) => {
    const s = r?.settings, scopes = typeof r?.scope === 'string' ? r.scope.replace(/^,+|,+$/g, '').split(',') : Array.isArray(r?.scope) ? r.scope : null
    if (!s || !scopes?.length || !r.scope.length) return
    const font = typeof s.fontStyle === 'string' ? s.fontStyle.split(' ').reduce((f, w) => f | (FONT[w] ?? 0), 0) : -1, fg = hex(s.foreground)
    for (const sel of scopes) if (typeof sel === 'string') {
      const parts = sel.trim().split(' ')
      if (parts.at(-1)) parsed.push({ scope: parts.at(-1), parents: parts.length > 1 ? parts.slice(0, -1).reverse() : null, index, font, fg })
    }
  })
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0
  const arrCmp = (a, b) => !a && !b ? 0 : !a ? -1 : !b ? 1 : a.length !== b.length ? a.length - b.length : a.reduce((r, x, i) => r || cmp(x, b[i]), 0)
  parsed.sort((a, b) => cmp(a.scope, b.scope) || arrCmp(a.parents, b.parents) || a.index - b.index)
  const node = (main, withParents = []) => ({ main, withParents, children: new Map() })
  const root = node({ depth: 0, parents: [], font: -1, fg: null })
  const accept = (r, depth, font, fg) => { r.depth = Math.max(r.depth, depth); if (font !== -1) r.font = font; if (fg) r.fg = fg }
  const insert = (n, depth, scope, parents, font, fg) => {
    if (scope === '') {
      if (!parents) return accept(n.main, depth, font, fg)
      const same = n.withParents.find(r => arrCmp(r.parents, parents) === 0)
      return same ? accept(same, depth, font, fg) : void n.withParents.push({ depth, parents, font: font === -1 ? n.main.font : font, fg: fg ?? n.main.fg })
    }
    const dot = scope.indexOf('.'), head = dot < 0 ? scope : scope.slice(0, dot)
    if (!n.children.has(head)) n.children.set(head, node({ ...n.main }, n.withParents.map(r => ({ ...r }))))
    insert(n.children.get(head), depth + 1, dot < 0 ? '' : scope.slice(dot + 1), parents, font, fg)
  }
  for (const r of parsed) insert(root, 0, r.scope, r.parents, r.font, r.fg)
  const specific = (a, b) => {
    if (a.depth !== b.depth) return b.depth - a.depth
    for (let i = 0, j = 0; ; i++, j++) {
      if (a.parents[i] === '>') i++
      if (b.parents[j] === '>') j++
      if (i >= a.parents.length || j >= b.parents.length) break
      const d = b.parents[j].length - a.parents[i].length
      if (d) return d
    }
    return b.parents.length - a.parents.length
  }
  const memo = new Map()
  const rulesOf = scope => {
    if (memo.has(scope)) return memo.get(scope)
    let n = root
    for (const part of scope.split('.')) { if (!n.children.has(part)) break; n = n.children.get(part) }
    const list = [...n.withParents, n.main].sort(specific)
    memo.set(scope, list)
    return list
  }
  const under = (scope, sel) => scope === sel || scope.startsWith(sel) && scope[sel.length] === '.'
  // the rule's ancestors (nearest first) among the scope's (outermost first), each further out than the one before
  const among = (ancestors, parents) => {
    let i = ancestors.length - 1
    for (let n = 0; n < parents.length; n++) {
      let sel = parents[n], child = false
      if (sel === '>') { if (n === parents.length - 1) return false; sel = parents[++n]; child = true }
      while (i >= 0 && !under(ancestors[i], sel)) { if (child) return false; i-- }
      if (i < 0) return false
      i--
    }
    return true
  }
  return (scope, ancestors = []) => {
    const r = rulesOf(scope).find(r => among(ancestors, r.parents))
    return r ? { fg: r.fg, font: r.font } : null
  }
}
// A word's style by its scopes, outermost first, as VS Code's TextMate engine lays each scope's rule over its parent's
// (vscode-textmate AttributedScopeStack.mergeAttributes): of its last `own` scopes, what each sets over the one before,
// the rest its ancestors, which a rule's ancestors are matched against. { fg, font }, unset (null, -1) where none of its
// own sets it: there it takes its part's
export function styler(rules) {
  const match = scoper(rules)
  return (stack, own = stack.length) => {
    let fg = null, font = -1
    for (let i = stack.length - own; i < stack.length; i++) {
      const r = match(stack[i], stack.slice(0, i))
      if (r?.fg) fg = r.fg
      if (r && r.font !== -1) font = r.font
    }
    return { fg, font }
  }
}

// The scopes VS Code probes a theme's TextMate rules for, for a semantic token the theme's semanticTokenColors leave
// unset, by the token's type and modifiers: its registry's, as VS Code 1.143 registers them
// (src/vs/platform/theme/common/tokenClassificationRegistry.ts registerDefaultClassifications), then the JavaScript
// extension's (extensions/javascript/package.json, contributes.semanticTokenScopes)
export const PROBES = [
  ['comment', 'comment'], ['string', 'string'], ['keyword', 'keyword.control'], ['number', 'constant.numeric'], ['regexp', 'constant.regexp'],
  ['operator', 'keyword.operator'], ['namespace', 'entity.name.namespace'], ['type', 'entity.name.type support.type'], ['struct', 'entity.name.type.struct'],
  ['class', 'entity.name.type.class support.class'], ['interface', 'entity.name.type.interface'], ['enum', 'entity.name.type.enum'],
  ['typeParameter', 'entity.name.type.parameter'], ['function', 'entity.name.function support.function'], ['member', ''],
  ['method', 'entity.name.function.member support.function'], ['macro', 'entity.name.function.preprocessor'],
  ['variable', 'variable.other.readwrite entity.name.variable'], ['parameter', 'variable.parameter'], ['property', 'variable.other.property'],
  ['enumMember', 'variable.other.enummember'], ['event', 'variable.other.event'], ['decorator', 'entity.name.decorator entity.name.function'],
  ['variable.readonly', 'variable.other.constant'], ['property.readonly', 'variable.other.constant.property'], ['type.defaultLibrary', 'support.type'],
  ['class.defaultLibrary', 'support.class'], ['interface.defaultLibrary', 'support.class'], ['variable.defaultLibrary', 'support.variable support.other.variable'],
  ['variable.defaultLibrary.readonly', 'support.constant'], ['property.defaultLibrary', 'support.variable.property'],
  ['property.defaultLibrary.readonly', 'support.constant.property'], ['function.defaultLibrary', 'support.function'], ['member.defaultLibrary', 'support.function'],
  ['property:javascript', 'variable.other.property.js'], ['property.readonly:javascript', 'variable.other.constant.property.js'],
  ['variable:javascript', 'variable.other.readwrite.js'], ['variable.readonly:javascript', 'variable.other.constant.object.js'],
  ['function:javascript', 'entity.name.function.js'], ['namespace:javascript', 'entity.name.type.module.js'],
  ['variable.defaultLibrary:javascript', 'support.variable.js'], ['function.defaultLibrary:javascript', 'support.function.js']
]
// VS Code's semantic tokens drawn over the grammar's (src/vs/workbench/services/themes/common/colorThemeData.ts
// getTokenStyle, resolveScopes): a token, its type and modifiers (`variable.declaration.readonly`), takes each of its
// colour, bold, italic, underline and strikethrough from the theme's semanticTokenColors rule that matches it best, and
// what none sets from the TextMate rules for the scopes probed for it (PROBES), by the selector that matches it best,
// of its probes the first a rule takes. A selector (`type.modifier:language`, `*` any type) matches a token of its type
// (100) with each of its modifiers (100 each), in its language (10); the later of two alike. A probed scope takes the
// rule whose selector names the most of it, by the selector's length, as VS Code scores a scope (nameMatcher). What the
// token leaves unset the grammar's word keeps (SemanticTokensProviderStyling, sparseTokensStore.ts). { fg, bold,
// italic, underline, strikethrough }, each undefined where unset; none at all where the theme turns semantic
// highlighting off
export function semantics({ tokenColors = [], semanticHighlighting = false, semanticTokenColors = {} }) {
  if (!semanticHighlighting) return () => ({})
  // a selector parsed from its end (tokenClassificationRegistry.ts parseClassifierString), and its score for a token
  const selector = s => { const out = { modifiers: [], language: undefined }; let end = s.length; for (let i = s.length - 1; i >= 0; i--) if (s[i] === ':' || s[i] === '.') { const part = s.slice(i + 1, end); end = i; s[i] === ':' ? out.language = part : out.modifiers.push(part) } return { ...out, type: s.slice(0, end) } }
  const score = (sel, type, mods) => !sel.type || sel.language !== undefined && sel.language !== 'javascript' || sel.type !== '*' && sel.type !== type || sel.modifiers.some(m => !mods.includes(m)) ? -1 : (sel.language !== undefined ? 10 : 0) + (sel.type !== '*' ? 100 : 0) + 100 * sel.modifiers.length
  // a style from a colour and a font style, the four of it all set where a font style is given (TokenStyle.fromSettings)
  const settle = (fg, fontStyle, more = {}) => typeof fontStyle === 'string'
    ? { fg, ...Object.fromEntries(['bold', 'italic', 'underline', 'strikethrough'].map(k => [k, fontStyle.includes(k)])) }
    : { fg, ...Object.fromEntries(['bold', 'italic', 'underline', 'strikethrough'].map(k => [k, typeof more[k] === 'boolean' ? more[k] : undefined])) }
  const rules = Object.entries(semanticTokenColors).map(([k, v]) => [selector(k), typeof v === 'string' ? settle(hex(v), undefined) : v && typeof v === 'object' ? settle(hex(v.foreground), v.fontStyle, v) : null]).filter(r => r[1])
  const defaults = PROBES.map(([k, probes]) => [selector(k), probes ? probes.split(' ') : []])
  const matchers = tokenColors.map(r => matcherOf(r))
  // the rules for one scope probed: the best colour and the best font style, either from any rule, or none
  const probe = scopes => {
    for (const p of scopes) {
      let fg, fontStyle, fs = -1, ss = -1
      tokenColors.forEach((r, i) => {
        const v = matchers[i](p)
        if (v < 0) return
        if (v >= fs && r.settings.foreground) { fg = r.settings.foreground; fs = v }
        if (v >= ss && typeof r.settings.fontStyle === 'string') { fontStyle = r.settings.fontStyle; ss = v }
      })
      if (fg !== undefined || fontStyle !== undefined) return settle(fg !== undefined ? hex(fg) : undefined, fontStyle)
    }
    return null
  }
  const memo = new Map()
  return token => {
    if (memo.has(token)) return memo.get(token)
    const [type, ...mods] = token.split('.'), out = {}, best = {}
    const take = (s, style) => { for (const k of ['fg', 'bold', 'italic', 'underline', 'strikethrough']) if ((k === 'fg' ? style.fg : style[k] !== undefined) && (best[k] ?? -1) <= s) { best[k] = s; out[k] = style[k] } }
    for (const [sel, style] of rules) { const s = score(sel, type, mods); if (s >= 0) take(s, style) }
    for (const k in best) best[k] = Infinity
    for (const [sel, probes] of defaults) { const s = score(sel, type, mods), style = s >= 0 && probe(probes); if (style) take(s, style) }
    memo.set(token, out)
    return out
  }
}
// A TextMate rule's selectors matched against one scope as VS Code matches a probe (colorThemeData.ts getScopeMatcher,
// nameMatcher; textMateScopeMatcher.ts createMatchers): each selector the names it lists all among the scopes, its
// score where it does the last one's place and the name's length, `-` none, `,` and `|` the best of either; -1 none
function matcherOf(rule) {
  const sels = !rule?.scope || !rule.settings ? [] : Array.isArray(rule.scope) ? rule.scope : [rule.scope]
  const scopesMatch = (s, id) => !!s && (s === id || s.length > id.length && s.startsWith(id) && s[id.length] === '.')
  const name = (ids, scopes) => { if (scopes.length < ids.length) return -1; let score; return ids.every(id => { for (let i = scopes.length - 1; i >= 0; i--) if (scopesMatch(scopes[i], id)) { score = (i + 1) * 0x10000 + id.length; return true } return false }) && score !== undefined ? score : -1 }
  const all = []
  for (const sel of sels) {
    if (typeof sel !== 'string') continue
    const re = /([LR]:|[\w.:][\w.:-]*|[,|\-()])/g, next = () => re.exec(sel)?.[0] ?? null, ident = t => !!t && /[\w.:]+/.test(t)
    let t = next()
    const operand = () => {
      if (t === '-') { t = next(); const m = operand(); return m && (x => m(x) < 0 ? 0 : -1) }
      if (t === '(') { t = next(); const m = inner(); if (t === ')') t = next(); return m }
      if (ident(t)) { const ids = []; do { ids.push(t); t = next() } while (ident(t)); return x => name(ids, x) }
      return null
    }
    const conjunction = () => { const ms = []; for (let m = operand(); m; m = operand()) ms.push(m); return ms.length ? x => { let v = ms[0](x); for (let i = 1; v >= 0 && i < ms.length; i++) v = Math.min(v, ms[i](x)); return v } : null }
    const inner = () => {
      const ms = []
      for (let m = conjunction(); m; m = conjunction()) { ms.push(m); if (t !== '|' && t !== ',') break; do t = next(); while (t === '|' || t === ',') }
      return ms.length ? x => Math.max(...ms.map(m => m(x))) : null
    }
    while (t !== null) {
      if (t.length === 2 && t[1] === ':') t = next()
      const m = conjunction()
      if (m) all.push(m)
      if (t !== ',') break
      t = next()
    }
  }
  return scope => all.length ? Math.max(...all.map(m => m([scope]))) : -1
}

// The skin's colours (skin.css's tokens, CSS colours) from a theme: { '--color-screen': …, … }, each its part's (MAP,
// or `map` in its place, read by `registry`), then the channels' hues, then the script's words. The rules without a
// scope set the foreground and background where the colours don't, as a tmTheme's first does; a theme of no kind,
// light or dark by its background
export function skin(theme, map = MAP, registry = REGISTRY) {
  let { kind = null, colors = {}, tokenColors = [] } = theme
  const global = tokenColors.find(r => r && r.scope == null)?.settings ?? {}
  colors = { ...hex(global.background) && { 'editor.background': global.background }, ...hex(global.foreground) && { 'editor.foreground': global.foreground }, ...colors }
  const bg0 = hex(colors['editor.background'])
  kind ??= bg0 ? (lightness(bg0) > .5 ? 'light' : 'dark') : 'dark'
  const value = resolver({ kind, colors, tokenColors }, registry), screen = value(['opaque', 'editor.background', '#000000']), bg = unitOf(screen)
  // the channels' hues: the text's, then the words' where they are hues (a grey is none: a theme of greys leaves the
  // channels the even round), each apart from those before it and from the screen
  const lab = c => oklab(c.map(decode)), apart = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i])) > .08, hued = c => Math.hypot(...lab(c).slice(1)) > .04
  const hues = []
  for (const c of [['opaque', 'editor.foreground', ['opaque', 'editor.background', '#000000']], ...CHANNELS.map(k => ['scope', k])].map(w => unitOf(value(w)))) if ((!hues.length || hued(c)) && apart(c, bg) && hues.every(h => apart(c, h))) hues.push(c)
  return {
    ...Object.fromEntries(Object.entries(map).map(([k, v]) => [k, css(value(v))])),
    ...Object.fromEntries(hues.map((c, i) => [`--color-screen-channel-${i + 1}`, css(ofUnit(c))])),
    ...styles({ ...theme, tokenColors }, screen)
  }
}
// The script's words' colours and font styles (script.js draws them): each word's own (syntax.js WORDS) as VS Code's
// TextMate engine gives them, --color-syntax-<word> and, where its rules give it a font style, --italic-, --bold- and
// --line-syntax-<word>, none where its own scopes set none (it shows its part's then); each semantic token's
// (MEANINGS) as --color-semantic-<type-modifiers> and the rest, only what the theme's semantic highlighting sets (the
// word's own shows through the rest). Colours opaque over the screen, as text is drawn
function styles(theme, screen) {
  const style = styler(theme.tokenColors ?? []), meaning = semantics(theme), out = {}
  const colour = c => c && css(over(ofUnit(c), screen))
  const put = (k, name, { fg, italic, bold, line }) => {
    if (fg) out[`--color-${k}-${name}`] = colour(fg)
    if (italic !== undefined) out[`--italic-${k}-${name}`] = italic ? 'italic' : 'normal'
    if (bold !== undefined) out[`--bold-${k}-${name}`] = bold ? 'bold' : 'normal'
    if (line !== undefined) out[`--line-${k}-${name}`] = line || 'none'
  }
  for (const [w, scopes] of Object.entries(WORDS)) {
    const [under, own] = scopes.includes(' / ') ? scopes.split(' / ').map(s => s.split(' ')) : [[], scopes ? scopes.split(' ') : []]
    const { fg, font } = style(w === 'source' ? own : ['source.js', ...under, ...own], own.length)
    put('syntax', w, font === -1 ? { fg } : { fg, italic: !!(font & FONT.italic), bold: !!(font & FONT.bold), line: lines(font & FONT.underline, font & FONT.strikethrough) })
  }
  for (const m of MEANINGS) {
    const s = meaning(m)
    put('semantic', m.replaceAll('.', '-'), { fg: s.fg, italic: s.italic, bold: s.bold, line: s.underline === undefined && s.strikethrough === undefined ? undefined : lines(s.underline, s.strikethrough) })
  }
  return out
}
const lines = (under, through) => [under && 'underline', through && 'line-through'].filter(Boolean).join(' ')

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

// A skin worn: its colours set on the page over skin.css's, those of the one before gone, the page marked worn
// (data-worn), so the screen's own words (skin.css, for a page wearing none) leave what a theme's words leave unset
// unset; none, skin.css's own
let worn = []
export function wear(tokens, el = document.documentElement) {
  for (const k of worn) el.style.removeProperty(k)
  worn = Object.keys(tokens ?? {})
  for (const k of worn) el.style.setProperty(k, tokens[k])
  el.toggleAttribute('data-worn', !!tokens)
}
