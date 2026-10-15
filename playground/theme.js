import { oklab, srgb, lightness } from './tint.js'

// VS Code colour themes read into the editor's skin (skin.css), so a sound shows in the colours its code does: the
// picture is a page of the editor, the sound its text. What each part of the picture takes, and why:
// - the screen, the editor's background; menus and cards over it, its widgets'; the words on it, its foreground
// - the waveform and the spectrogram, its foreground: the sound is the page's text, in the colour text is
// - the slab's edge and the menus', the border round an editor group (high contrast's, its contrast border)
// - a field, an input's; a row of choices, inputs side by side in that border, the one chosen as VS Code shows an
//   input's option on (Match Case): flat, as its controls are, not keys
// - the accent (an edit's handles and curves, the play button's progress), the workbench's: its focus colour, the one
//   a chosen option is tinted with
// - a marker, a markdown heading's: it names a section of the sound, as a heading names one of a text
// - the time row's and the level axes' numbers, the line numbers', in the editor's font at its size; their ticks, the
//   ruler's
// - the grid, the whitespace marks' dots and the indent guides' lines; the caret, the cursor's; a clip, an error's
// - a selection, the selection's, behind the sound as a selection is behind text; the picture not focused, the
//   inactive selection's
// - the script's line the caret is on, the current line's background and border
// - channels in one lane, the text's colour first, as one channel is drawn, then the theme's own syntax hues, each made
//   to read on its background and apart from the others: numbers, strings, keywords, types, variables, control words
// - the script, every word as the theme colours it
// A theme is VS Code's JSON (code.visualstudio.com/api/extension-guides/color-theme): `colors`, the workbench's, by key;
// `tokenColors`, TextMate rules, a scope to a colour; `type` or the extension's uiTheme, its kind. What it leaves out,
// VS Code's own default for that kind (DEFAULTS); a word it gives no rule, the foreground, as VS Code draws it.

// VS Code's defaults for the colours read here, by kind: the registerColor calls of VS Code 1.139
// (src/vs/platform/theme/common/colors/*.ts, src/vs/editor/common/core/editorColorRegistry.ts)
const DEFAULTS = {
  'editor.background': { dark: '#1E1E1E', light: '#FFFFFF', hcDark: '#000000', hcLight: '#FFFFFF' },
  'editor.foreground': { dark: '#BBBBBB', light: '#333333', hcDark: '#FFFFFF', hcLight: '#292929' },
  'editorWidget.background': { dark: '#252526', light: '#F3F3F3', hcDark: '#0C141F', hcLight: '#FFFFFF' },
  'editorLineNumber.foreground': { dark: '#858585', light: '#237893', hcDark: '#FFFFFF', hcLight: '#292929' },
  'editorLineNumber.activeForeground': { dark: '#C6C6C6', light: '#0B216F', hcDark: '#F38518', hcLight: '#006BBD' },
  'editorCursor.foreground': { dark: '#AEAFAD', light: '#000000', hcDark: '#FFFFFF', hcLight: '#0F4A85' },
  'editor.selectionBackground': { dark: '#264F78', light: '#ADD6FF', hcDark: '#F3F518', hcLight: '#0F4A85' },
  'editorWhitespace.foreground': { dark: '#E3E4E229', light: '#33333333', hcDark: '#E3E4E229', hcLight: '#CCCCCC' },
  'editorRuler.foreground': { dark: '#5A5A5A', light: '#D3D3D3', hcDark: '#FFFFFF', hcLight: '#292929' },
  'editorError.foreground': { dark: '#F14C4C', light: '#E51400', hcDark: '#F48771', hcLight: '#B5200D' },
  'editorGroup.border': { dark: '#444444', light: '#E7E7E7', hcDark: '#6FC3DF', hcLight: '#0F4A85' },
  'input.background': { dark: '#3C3C3C', light: '#FFFFFF', hcDark: '#000000', hcLight: '#FFFFFF' },
  // a chosen option (Match Case, on): focusBorder at .4 dark and .2 light; high contrast draws it by its border alone,
  // which a choice here has not, so its focus colour at .4
  'inputOption.activeBackground': { dark: '#007FD466', light: '#0090F133', hcDark: '#F3851866', hcLight: '#006BBD66' },
  'inputOption.activeForeground': { dark: '#FFFFFF', light: '#000000', hcDark: '#FFFFFF', hcLight: '#292929' },
  'focusBorder': { dark: '#007FD4', light: '#0090F1', hcDark: '#F38518', hcLight: '#006BBD' },
  'editor.lineHighlightBorder': { dark: '#282828', light: '#EEEEEE', hcDark: '#F38518', hcLight: '#0F4A85' }
}
// The indent guides' colour falls back to the whitespace marks', as VS Code's does
const FALLBACK = { 'editorIndentGuide.background1': 'editorIndentGuide.background', 'editorIndentGuide.background': 'editorWhitespace.foreground', 'editorLineNumber.activeForeground': 'editorActiveLineNumber.foreground' }

// The words of a script, each by the scopes VS Code's JavaScript grammar gives it, outermost first; and a markdown
// heading's text, by its grammar's
const js = scope => ['source.js', scope]
export const SYNTAX = {
  number: js('constant.numeric.decimal.js'),
  string: js('string.quoted.single.js'),
  regexp: js('string.regexp.js'),
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
  const keys = [...Object.keys(DEFAULTS), ...Object.keys(FALLBACK), 'editor.lineHighlightBackground', 'editor.inactiveSelectionBackground', 'editor.selectionHighlightBackground', 'editorBracketMatch.background', 'input.placeholderForeground']
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
const css = ([r, g, b, a = 1]) => `rgb(${[r, g, b].map(v => Math.round(v * 255)).join(' ')}${a < 1 ? ` / ${+a.toFixed(3)}` : ''})`
// `p` of the way from one opaque colour to another, in OKLab (CSS Color 4 §12.3's color-mix default space), opaque
const decode = v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4
const mix = (a, b, p) => { const x = oklab(a.map(decode)), y = oklab(b.map(decode)); return [...srgb(x.map((v, i) => v + p * (y[i] - v))), 1] }
// a colour's own, at most `a` opaque
const clear = (c, a) => [c[0], c[1], c[2], Math.min(c[3], a)]
// a colour over the screen, opaque
const over = (c, bg) => [...c.slice(0, 3).map((v, i) => bg[i] + c[3] * (v - bg[i])), 1]

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

// The skin's colours (skin.css's tokens, CSS colours) from a theme: { '--color-screen': …, … }
export function skin({ kind = null, colors = {}, tokenColors = [] }) {
  // the rules without a scope set the foreground and background, as a tmTheme's first does
  const global = tokenColors.find(r => r && r.scope == null)?.settings ?? {}
  const own = key => hex(colors[key]) ?? (FALLBACK[key] ? own(FALLBACK[key]) : null)
  const bg0 = hex(colors['editor.background']) ?? hex(global.background)
  kind ??= bg0 ? (lightness(bg0) > .5 ? 'light' : 'dark') : 'dark'
  const get = key => own(key) ?? hex(DEFAULTS[key]?.[kind]) ?? (FALLBACK[key] && get(FALLBACK[key]))
  const bg = over(bg0 ?? get('editor.background'), [0, 0, 0]), fg = over(hex(colors['editor.foreground']) ?? hex(global.foreground) ?? get('editor.foreground'), bg)
  const far = lightness(bg) < .5 ? [1, 1, 1, 1] : [0, 0, 0, 1]
  const colour = colourer(tokenColors), word = Object.fromEntries(Object.entries(SYNTAX).map(([k, stack]) => [k, colour(stack) ?? fg]))
  // in high contrast a group's border is the theme's contrast border, as VS Code's is
  const bezel = over(own('editorGroup.border') ?? (kind.startsWith('hc') ? own('contrastBorder') : null) ?? get('editorGroup.border'), bg), input = over(get('input.background'), bg)
  const step = p => css(mix(fg, bg, p)), space = get('editorWhitespace.foreground')
  // the selections, as VS Code draws them behind text, over the screen; the inactive one, where a theme gives none, the
  // active at half, as VS Code's default is (at .7 in high contrast dark)
  const active = get('editor.selectionBackground'), select = over(active, bg)
  const idle = over(own('editor.inactiveSelectionBackground') ?? clear(active, active[3] * (kind === 'hcDark' ? .7 : .5)), bg)
  // the channels' hues: the words' colours, each apart from those before it and from the screen
  const apart = (a, b) => { const x = oklab(a.map(decode)), y = oklab(b.map(decode)); return Math.hypot(...x.map((v, i) => v - y[i])) > .08 }
  const hues = []
  for (const c of [fg, ...CHANNELS.map(k => over(word[k], bg))]) if (apart(c, bg) && hues.every(h => apart(c, h))) hues.push(c)
  return {
    '--color-screen': css(bg), '--color-screen-low': css(bg), '--color-scanline': 'transparent',
    '--color-screen-raised': css(over(get('editorWidget.background'), bg)),
    '--color-screen-pill': css(bg), '--color-screen-pill-hover': css(over(get('editorWidget.background'), bg)),
    '--color-screen-pill-active': step(.82), '--color-screen-hover': step(.88),
    // what lifts off the screen (skin.css's fills), the foreground, as white lifts off the default's black
    '--color-screen-lift': css(fg), '--color-screen-edge': css(clear(fg, .16)),
    '--color-screen-bright': css(mix(fg, far, .5)), '--color-screen-ink': css(fg),
    '--color-screen-soft': step(.15), '--color-screen-muted': step(.3), '--color-screen-dim': step(.42), '--color-screen-placeholder': step(.5),
    '--color-screen-rule': css(over(get('editorRuler.foreground'), bg)),
    '--color-screen-ruler': css(over(get('editorLineNumber.foreground'), bg)),
    '--color-screen-line-number': css(over(get('editorLineNumber.foreground'), bg)),
    '--color-screen-line-number-active': css(over(get('editorLineNumber.activeForeground'), bg)),
    // the grid's dots twice its crosses' opacity, as the default's are
    '--color-screen-grid': css(space), '--color-screen-grid-dot': css([...space.slice(0, 3), Math.min(1, space[3] * 2)]),
    '--color-screen-grid-line': css(get('editorIndentGuide.background1')),
    '--color-screen-caret': css(get('editorCursor.foreground')),
    '--color-screen-select': css(select), '--color-screen-select-spectrum': css(select),
    '--color-screen-select-inactive': css(idle), '--color-screen-select-spectrum-inactive': css(idle),
    '--color-screen-error': css(over(get('editorError.foreground'), bg)), '--color-screen-record': css(over(get('editorError.foreground'), bg)),
    '--color-screen-wave': css(fg), '--color-screen-spectrum': css(fg),
    '--color-bezel': css(bezel),
    '--color-screen-accent': css(over(get('focusBorder'), bg)),
    '--color-screen-mark': css(over(word.heading, bg)), '--color-screen-mark-name': css(over(word.heading, bg)),
    '--color-notch': css(bg), '--color-screen-text': css(fg),
    '--color-screen-well': css(input), '--key-face': css(input), '--key-bezel': css(bezel), '--key-seam': css(bezel),
    '--key-pressed': css(over(get('inputOption.activeBackground'), input)), '--key-pressed-ink': css(over(get('inputOption.activeForeground'), input)),
    '--key-light': 'transparent', '--key-bezel-light': 'transparent', '--key-pressed-shadow': 'transparent',
    '--color-screen-line': css(hex(colors['editor.lineHighlightBackground']) ?? [0, 0, 0, 0]),
    '--color-screen-line-border': css(get('editor.lineHighlightBorder')),
    '--color-screen-selection': css(select), '--color-screen-selection-inactive': css(idle),
    '--color-screen-match': css(hex(colors['editor.selectionHighlightBackground']) ?? clear(select, .5)),
    '--color-screen-bracket': css(hex(colors['editorBracketMatch.background']) ?? clear(fg, .1)),
    ...Object.fromEntries(Object.entries(word).map(([k, c]) => [`--color-screen-${k}`, css(over(c, bg))])),
    ...Object.fromEntries(hues.map((c, i) => [`--color-screen-channel-${i + 1}`, css(c)]))
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
