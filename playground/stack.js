import { ops, methods, format, fromManifest, reshapes, icons } from './ops.js'
import opIcons from './icons.js'
import { chain, setArg, number, offCalls, turnOff, turnOn, groups, steps as stepsOf, moveStep, moveLines, group as groupSteps, ungroup, renameGroup } from './code.js'
import { help, layout } from './help.js'

// The edits: the chain's steps as cards, in order, as Luminar's edits or a history panel; the same chain as the code,
// as controls, a rack of cards as mel's modules. The sound it starts from is the first card (the file opened, or
// audio.from() making one). A card names its step and what it is set to. A press on one chooses it: it opens to its settings, a
// slider (or a choice) each, and the output shows as it is up to that step, the steps after it dimmed; a press again,
// or Escape, shows the whole chain again. A slider rewrites its argument in place, a whole drag one undo step. Pointed
// at, each says what it does and which way to move it (help.js); the engine's own, which few touch, wait under Advanced.
// The card under the pointer draws what it sets over the output (`oncall`). Two acts on it, over its right end where the pointer
// is, its settings running under them to the card's edge: its power switch bypasses the step, and turns it back on (the call commented out
// where it stands, so the code says it too); its × removes it. Bypassed, it still opens: its settings go into its comment,
// nothing renders, and what it sets is drawn over the output as it is. Dragged up or down, a card takes its step there in the
// chain. Going back to a card is choosing it: an edit made then goes in right after it, the steps after it kept, as a
// new layer goes over the one selected (at()). Open, a card's Δ plays and draws what its step takes out (the output before
// it less the output after it). Steps grouped in the code (code.js groups: a recipe's, under its name) are one card,
// folded: a press unfolds it to its steps, its switch bypasses them all and turns them back on, its × removes them all. What the output
// shows, when it is not the whole chain, goes to `onview({ delta, back })`: `delta` the index of the live step whose
// difference plays, `back` how many live steps are kept.
export default function stack(root, { ed, describe = async () => null, duration = () => 1, source = () => null, oncall = () => {}, onview = () => {}, onpreview = () => {}, oncontext = () => {}, onflatten = () => {}, keys = k => k }) {
  // the cards first, what adds to them after
  const list = root.insertBefore(document.createElement('ol'), root.firstChild)
  list.className = 'steps-list'
  // the card chosen, known by where its call's "(" is, carried through every edit ('source' for the sound it starts
  // from); what the output shows: the difference a live step makes, or the chain kept to its first `back` live steps;
  // the card under the pointer
  let chosen = null, cards = [], shape = '', delta = null, back = null, hovered = null
  // the groups, a card each over its steps' cards; those unfolded, by name and place among those of that name
  let folds = [], unfolded = new Set()

  // Every change to the code, and once at the start; a move of its caret alone changes nothing here
  function refresh(update) {
    if (update && !update.docChanged) return
    if (update && typeof chosen === 'number') chosen = update.changes.mapPos(chosen)
    const code = ed.code, c = chain(code), calls = c?.calls || []
    // audio.from(…) makes the sound: its call is where the chain starts, not a step on it
    const made = c?.root.name === 'VariableName' && code.slice(c.root.from, c.root.to) === 'audio' && !!calls[0]
    // a step bypassed, its call commented out, known as it was by where its "(" is, so it stays the card chosen
    const steps = [...calls.map((k, i) => i || !made ? k : { ...k, origin: true }), ...offCalls(code).map(o => ({ ...o, dot: o.from, off: true }))].sort((p, q) => p.dot - q.dot)
    const name = !made && source(), rows = name ? [{ name, sound: true }, ...steps] : steps
    const gs = groups(code), groupOf = k => k.sound ? -1 : gs.findIndex(g => k.dot > g.from && k.dot < g.to)
    // cards are built again only when the steps change, never by a slider's own edits nor a step bypassed or turned back
    // on (its card stays as it is, where it is, dimmed while off); then the whole chain shows
    const next = rows.map(k => k.name + '/' + groupOf(k)).join() + gs.map(g => g.name).join()
    if (next !== shape) { build(rows, gs, groupOf); if (shape) { chosen = null; picked = []; view(null, null) } }
    shape = next
    if (opening != null) { const f = folds.find(f => f.group.from === opening); if (f) unfolded.add(f.key); opening = null }
    rows.forEach((call, i) => { cards[i].call = call })
    gs.forEach((g, i) => { if (folds[i]) folds[i].group = g })
    render()
    // a step bypassed or back on, the output up to the card chosen counts its live steps again
    if (chosen != null) { const c = cards[position()], i = c ? live().indexOf(c) : -1; delta != null && i >= 0 ? view(i, null) : view(null, kept()) }
  }

  // a step's switch, as a plugin's bypass: on, power; bypassed, power struck through
  const ON = 'M12 3.5v7.5M6.6 6.9a7.5 7.5 0 1 0 10.8 0'
  // a group's icon, as a layers panel draws one: a square of its corners, what it holds inside; a row's chevron before its
  // icon, turned down while it is open (a group unfolded, a step's settings shown)
  const FOLD = 'M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3'
  const CHEVRON = '<svg class="step-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9.5 7 5 5-5 5"/></svg>'
  // the menu's: moved up or down, made one sound, taken away
  const UP = 'M12 19V5m-6 6 6-6 6 6', DOWN = 'M12 5v14m-6-6 6 6 6-6', FLAT = 'M4 7h16M4 12h16M4 17h16', AWAY = 'm7 7 10 10M17 7 7 17'
  // a card's icon: the sound's, a file's bars or a generator's wave; a step's own (icons.js), else its kind's
  const iconOf = call => call.sound ? 'M4 10v4m4-8v12m4-15v18m4-14v10m4-6v2' : call.origin ? icons.Generate : opIcons[call.name] ?? icons[ops[call.name]?.group] ?? icons.Effect
  const SHUT = 'M12 3.5v7.5M6.6 6.9a7.5 7.5 0 1 0 10.8 0M4 4l16 16'
  function build(rows, gs = [], groupOf = () => -1) {
    hovered = null
    cards = rows.map(call => {
      const li = document.createElement('li'), head = li.appendChild(document.createElement('div'))
      li.className = call.sound ? 'step sound' : 'step'
      head.className = 'step-head'
      head.innerHTML = `<button class="step-toggle" type="button">${CHEVRON}<svg class="step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path/></svg><span class="step-name"></span><span class="step-args"></span></button>`
      const toggle = head.firstChild, card = { li, toggle, args: toggle.lastChild, call, params: null }
      toggle.querySelector('.step-icon path').setAttribute('d', iconOf(call))
      toggle.querySelector('.step-name').textContent = call.sound ? call.name : call.name[0].toUpperCase() + call.name.slice(1)
      // a press leaves the keys where they were: Space still plays, the code keeps its caret
      toggle.addEventListener('mousedown', event => event.preventDefault())
      toggle.addEventListener('click', event => {
        if (dragged) return
        if (event.shiftKey) return pickRange(card)
        if (picked.length) { picked = []; render() }
        anchor = card
        pick(card)
      })
      toggle.addEventListener('pointerdown', event => carry(event, { card }))
      li.addEventListener('contextmenu', event => { event.preventDefault(); oncontext({ x: event.clientX, y: event.clientY, items: menuOf({ card }) }) })
      li.addEventListener('pointerenter', () => { hovered = card; guide() })
      li.addEventListener('pointerleave', () => { if (hovered === card) { hovered = null; guide() } })
      // the sound the chain starts from has nothing to take away, turn off or remove
      if (!call.sound && !call.origin) {
        const acts = head.appendChild(document.createElement('div'))
        acts.className = 'step-acts'
        card.on = button(acts, 'step-on', null, ON, () => onOff(card))
        button(acts, 'step-remove', null, 'm7 7 10 10M17 7 7 17', () => drop(card), `Remove .${call.name}() from the chain`, `Remove ${call.name}`)
      }
      card.fold = groupOf(call)
      return card
    })
    // a group's card, before its steps' cards, named by its comment, folded
    const seen = {}
    folds = gs.map(group => {
      const key = `${group.name}#${seen[group.name] = (seen[group.name] ?? -1) + 1}`
      const li = document.createElement('li'), head = li.appendChild(document.createElement('div'))
      li.className = 'step step-group'
      head.className = 'step-head'
      head.innerHTML = `<button class="step-toggle" type="button" aria-expanded="false">${CHEVRON}<svg class="step-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${FOLD}"/></svg><span class="step-name"></span><span class="step-args"></span></button>`
      const toggle = head.firstChild, fold = { li, toggle, key, group }
      toggle.querySelector('.step-name').textContent = group.name
      toggle.addEventListener('mousedown', event => event.preventDefault())
      toggle.addEventListener('click', () => { if (dragged) return; lastFold = fold; unfolded.has(key) ? unfolded.delete(key) : unfolded.add(key); render() })
      toggle.addEventListener('dblclick', () => nameGroup(fold))
      toggle.addEventListener('pointerdown', event => carry(event, { fold }))
      li.addEventListener('contextmenu', event => { event.preventDefault(); oncontext({ x: event.clientX, y: event.clientY, items: menuOf({ fold }) }) })
      const acts = head.appendChild(document.createElement('div'))
      acts.className = 'step-acts'
      fold.on = button(acts, 'step-on', null, ON, () => switchAll(fold))
      button(acts, 'step-remove', null, 'm7 7 10 10M17 7 7 17', () => dropAll(fold), `Remove ${group.name}: all its steps`, `Remove ${group.name}`)
      return fold
    })
    const items = []
    cards.forEach((c, i) => { if (c.fold >= 0 && cards[i - 1]?.fold !== c.fold) items.push(folds[c.fold].li); items.push(c.li) })
    list.replaceChildren(...items)
  }
  // a group's steps' cards
  const members = fold => cards.filter(c => c.fold === folds.indexOf(fold))
  // A row dragged along the others, a step's card or a group's (its steps with it), is held under the pointer, the others
  // stepping aside as it passes their middles, and goes where it is let go, set in as the row it lands by: a step into a
  // group, out of one or along it, under a group's open card first in it; a group among the rows outside groups (code.js
  // moveLines). A press that stays put is a click; a step bypassed stays put
  let dragged = false
  const span = c => ({ from: c.call.dot, to: c.call.to })
  function carry(event, row) {
    const self = row.card ?? row.fold
    if (event.button || row.card && (row.card.call.off || row.card.call.sound || row.card.call.origin)) return
    if (row.fold) for (const c of members(row.fold)) c.li.hidden = true
    const rows = shownRows(), from = rows.findIndex(r => (r.card ?? r.fold) === self), lis = rows.map(r => (r.card ?? r.fold).li)
    const boxes = lis.map(li => li.getBoundingClientRect()), y0 = event.clientY, mid = b => b.top + b.height / 2
    const step = from + 1 < boxes.length ? boxes[from + 1].top - boxes[from].top : boxes[from].height
    let moved = false, to = from
    const move = e => {
      const dy = e.clientY - y0
      if (!moved && Math.abs(dy) < 4) return
      moved = true
      self.li.classList.add('dragging')
      self.li.style.transform = `translateY(${dy}px)`
      const top = boxes[from].top + dy, bottom = boxes[from].bottom + dy
      to = from
      boxes.forEach((b, i) => { if (i > from && bottom > mid(b)) to = Math.max(to, i); if (i < from && top < mid(b)) to = Math.min(to, i) })
      lis.forEach((li, i) => { if (i !== from) li.style.transform = i >= Math.min(from, to) && i <= Math.max(from, to) ? `translateY(${to > from ? -step : step}px)` : '' })
    }
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up)
      // laid out in the new order at once, nothing sliding back to where it was
      for (const li of lis) { li.style.transition = 'none'; li.style.transform = ''; li.classList.remove('dragging') }
      requestAnimationFrame(() => requestAnimationFrame(() => { for (const li of lis) li.style.transition = '' }))
      if (!moved) return render()
      // the click that ends the drag is the drag's, not a choice (gone with the task it comes in)
      dragged = true
      setTimeout(() => { dragged = false })
      const change = to === from ? null : landing(row, rows[to], to > from)
      if (change) ed.change(change)
      else render()
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', up)
  }
  // the rows shown, in order, the sound the chain starts from not one of them
  const shownRows = () => [...list.children].filter(li => !li.hidden).map(li => cards.find(c => c.li === li) ? { card: cards.find(c => c.li === li) } : { fold: folds.find(f => f.li === li) })
    .filter(r => !r.card?.call.sound && !r.card?.call.origin)
  // a row moved one place up or down among those shown, as a drag would take it
  function shift(row, dir) {
    const rows = shownRows(), i = rows.findIndex(r => (r.card ?? r.fold) === (row.card ?? row.fold)), by = rows[i + dir]
    const change = by && landing(row, by, dir > 0)
    if (change) ed.change(change)
  }
  const nextTo = (row, dir) => { const rows = shownRows(), i = rows.findIndex(r => (r.card ?? r.fold) === (row.card ?? row.fold)); return i >= 0 && !!rows[i + dir] }
  // A row's own menu, right-clicked, as a layers panel's: muted or back on, what it takes out, moved, grouped or not, the
  // chain up to it made one sound (or all of it), taken away; a group's, named anew too
  function menuOf(row) {
    const c = row.card, f = row.fold, all = { label: 'Flatten all', hint: 'The whole chain made one sound', run: () => onflatten(null), icon: FLAT }
    if (c?.call.sound || c?.call.origin) return [{ label: 'Flatten up to here', hint: 'The sound as it starts, one sound', run: () => onflatten(c.call.origin ? c.call.to : chain(ed.code)?.root.to), disabled: !!c.call.sound, icon: FLAT }, all]
    const off = c ? !!c.call.off : members(f).every(x => x.call.off), inGroup = c ? c.fold >= 0 : false
    const mute = { label: off ? 'Unmute' : 'Mute', hint: off ? 'Back in the chain' : 'Bypassed: the output without it', run: () => c ? onOff(c) : switchAll(f), icon: off ? ON : SHUT }
    const moves = [{ label: 'Move up', run: () => shift(row, -1), disabled: c?.call.off || !nextTo(row, -1), icon: UP }, { label: 'Move down', run: () => shift(row, 1), disabled: c?.call.off || !nextTo(row, 1), icon: DOWN }]
    const flat = { label: 'Flatten up to here', hint: 'The chain from the sound to here made one sound, the steps after it going on from it', run: () => onflatten(c ? c.call.to : f.group.to), icon: FLAT }
    if (f) return [mute, { label: 'Rename…', run: () => nameGroup(f) }, '-', ...moves, '-', { label: 'Ungroup', keys: keys('⇧⌘G'), run: () => unmakeGroup(f) }, '-', flat, all, '-', { label: 'Remove', hint: 'The group and its steps', run: () => dropAll(f), icon: AWAY }]
    const group = { label: picked.includes(c) && picked.length > 1 ? `Group the ${picked.length}` : 'Group', keys: keys('⌘G'), run: () => { if (!picked.includes(c)) picked = [c]; makeGroup() }, disabled: inGroup || off }
    const takes = { label: 'What it takes out', hint: 'Heard and drawn: the output before it less the output after it', run: () => choose(c.call.list.from, true), disabled: off || reshapes(c.call.name) }
    return [mute, takes, '-', ...moves, '-', group, { label: 'Ungroup', keys: keys('⇧⌘G'), run: () => unmakeGroup(folds[c.fold]), disabled: !inGroup }, '-', flat, all, '-', { label: 'Remove', run: () => drop(c), icon: AWAY }]
  }
  // The change that takes a row (a step or a group) by another, after it (going down) or before it; none into a group for
  // a group, which goes by the group it lands in
  function landing(row, by, after) {
    const code = ed.code, what = row.card ? span(row.card) : row.fold.group
    if (by.fold) return row.card && after && unfolded.has(by.fold.key) ? moveLines(code, what, by.fold.group, { into: true }) : moveLines(code, what, by.fold.group, { after })
    if (row.fold && by.card.fold >= 0) return moveLines(code, what, folds[by.card.fold].group, { after })
    const lines = moveLines(code, what, span(by.card), { after })
    if (lines || row.fold) return lines
    // a chain on one line: the call moved along it
    const list = stepsOf(code), at = c => list.findIndex(s => s.call.from === c.call.dot)
    return moveStep(code, at(row.card), at(by.card))
  }
  // Rows chosen together for a group: a press with Shift takes the cards from the one chosen last to it (`picked`), each
  // a step outside groups; Mod-G makes them a group (or the card chosen alone), Mod-Shift-G unmakes the group the card
  // chosen is in, or the group pressed last. A group's name, double-clicked, is named anew
  let anchor = null, picked = [], lastFold = null, opening = null
  function pickRange(card) {
    const tops = cards.filter(c => !c.call.sound && !c.call.origin && c.fold < 0 && !c.call.off), a = tops.indexOf(anchor ?? card), b = tops.indexOf(card)
    picked = a < 0 || b < 0 ? [] : tops.slice(Math.min(a, b), Math.max(a, b) + 1)
    render()
  }
  function makeGroup() {
    const list = stepsOf(ed.code), at = c => list.findIndex(s => s.call.from === c.call.dot)
    const chosenCard = cards[position()], range = picked.length ? picked : chosenCard && !chosenCard.call.sound && !chosenCard.call.origin && chosenCard.fold < 0 ? [chosenCard] : []
    if (!range.length) return false
    const change = groupSteps(ed.code, at(range[0]), at(range.at(-1)))
    if (!change) return false
    picked = []
    // the new group open, its steps in sight (refresh)
    opening = change.from + 1
    ed.change(change)
    return true
  }
  function unmakeGroup(fold = null) {
    const chosenCard = cards[position()]
    fold ??= chosenCard && chosenCard.fold >= 0 ? folds[chosenCard.fold] : lastFold && folds.includes(lastFold) ? lastFold : null
    const change = fold && ungroup(ed.code, fold.group)
    if (change) ed.change(change)
    return !!change
  }
  function nameGroup(fold) {
    const name = fold.toggle.querySelector('.step-name'), input = document.createElement('input')
    input.className = 'step-rename'
    input.value = fold.group.name
    input.setAttribute('aria-label', `Name ${fold.group.name}`)
    name.replaceWith(input)
    input.focus()
    input.select()
    let done = false
    const end = keep => {
      if (done) return
      done = true
      const change = keep && input.value.trim() && input.value.trim() !== fold.group.name ? renameGroup(ed.code, fold.group, input.value) : null
      input.replaceWith(name)
      // open as it was, under its new name
      if (change && unfolded.has(fold.key)) opening = fold.group.from
      if (change) ed.change(change)
    }
    input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') end(true); else if (event.key === 'Escape') end(false) })
    input.addEventListener('blur', () => end(true))
    input.addEventListener('click', event => event.stopPropagation())
    input.addEventListener('pointerdown', event => event.stopPropagation())
  }
  // a group's steps all turned off, or all back on when they all are, in one step
  function switchAll(fold) {
    const steps = members(fold), on = steps.every(c => c.call.off), code = ed.code
    const changes = steps.filter(c => !!c.call.off === on).map(c => on ? turnOn(code, c.call) : turnOff(code, c.call))
    if (changes.length && changes.every(Boolean)) ed.change(changes)
  }
  // a group taken out, its name and its steps, with the line it was on
  function dropAll(fold) {
    const { from, to } = fold.group
    ed.change({ from: Math.max(0, from - 1), to, insert: '' })
  }
  function button(head, name, text, path, act, title = '', label = title) {
    const b = head.appendChild(document.createElement('button'))
    b.className = `${name} icon-button`
    b.type = 'button'
    if (text) b.textContent = text
    else b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`
    if (title) b.title = title
    if (label) b.setAttribute('aria-label', label)
    b.addEventListener('mousedown', event => event.preventDefault())
    b.addEventListener('click', act)
    return b
  }

  // Live steps, in order: those the output runs
  const live = () => cards.filter(c => !c.call.off && !c.call.sound)
  // the card chosen, as an index among the cards, or -1
  const position = () => chosen === 'source' ? cards.findIndex(c => c.call.sound) : chosen == null ? -1 : cards.findIndex(c => c.call.list?.from === chosen)
  // the live steps the chosen card keeps: none past the sound it starts from; all of them (null) at the last, none chosen,
  // or one bypassed, set without a render, what it sets drawn over the whole output
  function kept() {
    const c = cards[position()], steps = live()
    const n = !c || c.call.off ? null : c.call.sound ? 0 : steps.filter(k => k.call.dot <= c.call.dot).length
    return n == null || n >= steps.length ? null : n
  }

  function render() {
    const code = ed.code, steps = live(), at = position()
    for (const [n, c] of cards.entries()) {
      const call = c.call, open = n === at && !call.sound, i = steps.indexOf(c)
      c.li.classList.toggle('open', open)
      c.li.classList.toggle('chosen', n === at)
      c.li.classList.toggle('picked', picked.includes(c))
      c.li.classList.toggle('off', !!call.off)
      c.li.classList.toggle('rolled', back != null && n > at)
      c.li.classList.toggle('delta', i >= 0 && i === delta)
      c.toggle.setAttribute('aria-pressed', String(n === at))
      c.toggle.title = n === at ? call.off ? 'Close (Esc)' : 'Back to the whole chain (Esc)'
        : call.off ? `.${call.name}() is bypassed: open, its settings set without a render; its switch turns it back on`
        : call.sound ? `${call.name}: the sound alone, before any step`
        : `${ops[call.name]?.text || '.' + call.name + '()'}: the output up to here, and its settings`
      c.args.textContent = call.sound ? '' : summary(code, call)
      if (c.on) {
        c.on.setAttribute('aria-pressed', String(!call.off))
        c.on.querySelector('path').setAttribute('d', call.off ? SHUT : ON)
        c.on.title = call.off ? `Bypassed: turn .${call.name}() back on` : `Bypass .${call.name}(): hear the output without it`
        c.on.setAttribute('aria-label', call.off ? `Turn ${call.name} on` : `Turn ${call.name} off`)
      }
      if (open && !c.params) { c.params = params(c); c.li.append(c.params.dom); c.params.load() }
      if (!open && c.params) { c.params.dom.remove(); c.params = null }
      c.params?.refresh(i >= 0 && i === delta)
    }
    // a group folded hides its steps, unless the step chosen is one of them; its switch is off when all of them are
    for (const fold of folds) {
      const steps = members(fold), open = unfolded.has(fold.key) || steps.some(c => cards.indexOf(c) === at), off = steps.every(c => c.call.off)
      fold.toggle.setAttribute('aria-expanded', String(open))
      fold.toggle.title = open ? `Fold ${fold.group.name}` : `${fold.group.name}: its ${steps.length} steps, one step of the edits`
      fold.toggle.querySelector('.step-args').textContent = `${steps.length} steps`
      fold.li.classList.toggle('off', off)
      fold.li.classList.toggle('rolled', steps.every(c => c.li.classList.contains('rolled')))
      fold.on.setAttribute('aria-pressed', String(!off))
      fold.on.querySelector('path').setAttribute('d', off ? SHUT : ON)
      fold.on.title = off ? `Bypassed: turn ${fold.group.name} back on` : `Bypass ${fold.group.name}: hear the output without its steps`
      fold.on.setAttribute('aria-label', off ? `Turn ${fold.group.name} on` : `Turn ${fold.group.name} off`)
      for (const c of steps) { c.li.hidden = !open; c.li.classList.add('grouped') }
    }
    guide()
  }

  // What the card under the pointer sets, drawn over the output; none when no card is
  async function guide() {
    const c = hovered, name = c?.call.name
    if (!c || c.call.sound || !ops[name]) return oncall(null)
    const spec = c.params?.spec ?? ops[name].params ?? fromManifest(await describe(name))
    if (hovered === c) oncall(c.call, spec, valuesOf(spec, c.call))
  }

  // A press on a card chooses it; on the one chosen, the whole chain comes back
  function pick(c) {
    const id = c.call.sound ? 'source' : c.call.list.from
    choose(chosen === id ? null : id)
  }
  // Chooses a step, by where its "(" is ('source' for the sound it starts from, null for none): the output shows the
  // chain up to it, or with `takes` what it takes out, as its Δ (a live step that keeps the timing)
  function choose(id, takes = false) {
    chosen = id
    const c = cards[position()], i = takes && c && !reshapes(c.call.name) ? live().indexOf(c) : -1
    i >= 0 ? view(i, null) : view(null, kept())
  }
  // A call out of the chain: from the end of the one before it (or of the source) to its own end, with the line break;
  // one turned off, its comment
  function drop(c) {
    if (c.call.off) return ed.change({ from: c.call.from, to: c.call.to, insert: '' })
    const k = chain(ed.code), i = k?.calls.findIndex(x => x.list.from === c.call.list.from) ?? -1
    if (i >= 0) ed.change({ from: k.calls[i - 1]?.to ?? k.root.to, to: k.calls[i].to, insert: '' })
  }
  // The change that takes the steps after a card away, those turned off too, a closing save() or play() kept (from the
  // sound the chain starts from, every step), or null when there are none
  function past(card) {
    const code = ed.code, c = chain(code)
    if (!c) return null
    const from = card.call.sound ? c.root.to : card.call.origin ? c.calls[0].to : card.call.to
    const to = Math.max(c.expr.to, ...offCalls(code).map(o => o.to)), sinks = c.calls.filter(k => k.to > from && methods[k.name]?.sink).map(k => code.slice(k.dot, k.to)).join('')
    return to > from && code.slice(from, to) !== sinks ? { from, to, insert: sinks } : null
  }
  // While the output shows the chain rolled back to the card chosen, the steps after it, as a change that takes them
  // away (else null): the chain as it shows (a selection's audio taken to a tab of its own)
  const ahead = () => back != null && cards[position()] ? past(cards[position()]) : null
  // While it shows the chain rolled back to a card, that card's call (none for the sound it starts from) and where an edit
  // made then goes: right after it, the steps after it kept, as a new layer goes over the one selected; else null
  function at() {
    const c = back != null && cards[position()], k = c && chain(ed.code)
    if (!k) return null
    return { call: c.call.sound ? null : c.call, after: c.call.sound ? k.root.to : c.call.origin ? k.calls[0].to : c.call.to }
  }
  function onOff(c) {
    const change = c.call.off ? turnOn(ed.code, c.call) : turnOff(ed.code, c.call)
    if (change) ed.change(change)
  }
  function hear(c) {
    const i = live().indexOf(c)
    if (i >= 0) delta === i ? view(null, kept()) : view(i, null)
  }
  function view(d, b) {
    const changed = d !== delta || b !== back
    delta = d; back = b
    render()
    if (changed) onview({ delta, back })
  }

  // Keys on the cards: up and down go between them, Escape shows the whole chain again
  list.addEventListener('keydown', event => {
    // the cards shown: a group's own, and its steps' when it is unfolded
    const shown = [...list.children].filter(li => !li.hidden).map(li => li.querySelector('.step-toggle')), i = shown.indexOf(document.activeElement)
    if (event.key === 'Escape' && (chosen != null || delta != null)) { event.preventDefault(); chosen = null; view(null, null) }
    else if (i >= 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); shown[Math.max(0, Math.min(shown.length - 1, i + (event.key === 'ArrowDown' ? 1 : -1)))].focus() }
  })

  // A card's sliders, one per parameter; a plugin's come from its manifest, read by the engine. The ones that matter come
  // first and the engine's own are folded under Advanced (help.js layouts), open where the code sets one of them.
  function params(card) {
    const dom = document.createElement('div')
    dom.className = 'params'
    // what the step takes out, heard and drawn; a step that moves time, rate or channels has nothing that lines up to
    // take away
    const takes = reshapes(card.call.name) ? null : dom.appendChild(Object.assign(document.createElement('button'), { type: 'button', className: 'step-delta', textContent: 'Δ What it takes out', title: `Hear and see what .${card.call.name}() takes out: the output before it less the output after it` }))
    takes?.addEventListener('mousedown', event => event.preventDefault())
    takes?.addEventListener('click', () => hear(card))
    let rows = [], dragging = null
    const self = {
      dom, ready: false, spec: null,
      async load() {
        const name = card.call.name, spec = ops[name]?.params || fromManifest(await describe(name))
        if (card.params !== self) return
        self.spec = spec
        // a source, a band or what is learned from a selection is set in the code or on the picture, not by a slider
        rows = spec.map((s, i) => s.name === 'source' || s.name === 'band' || s.selection ? null : build(s, i)).filter(Boolean)
        if (!rows.length) { dom.append('No settings'); dom.classList.add('none'); return }
        arrange(name)
        self.ready = true
        values()
      },
      refresh(heard) {
        takes?.setAttribute('aria-pressed', String(heard))
        if (takes) takes.disabled = !!card.call.off
        if (self.ready) values()
      }
    }
    // A number's position on its slider, 0..1000: linear, or logarithmic for frequencies and ratios.
    const toSlider = (s, v) => s.log && s.min > 0 ? Math.log(v / s.min) / Math.log(s.max / s.min) * 1000 : (v - s.min) / (s.max - s.min) * 1000
    const fromSlider = (s, x) => s.log && s.min > 0 ? s.min * (s.max / s.min) ** (x / 1000) : s.min + x / 1000 * (s.max - s.min)
    // Times in the audio reach its end.
    const limits = s => ['at', 'duration', 'to'].includes(s.name) && s.unit === 's' ? { ...s, max: Math.max(duration(), .01) } : s
    // What pointing at a setting says: what it does and which way to move it (help.js), and for a number its range and
    // where it starts; the choices are on show.
    function tip(s, text) {
      const lim = limits(s), facts = s.values ? s.values.join(', ') : `${format(lim.min, s)} to ${format(lim.max, s)}${s.default == null ? '' : `, default ${format(s.default, s)}`}`
      return !text ? `${s.name}: ${facts}` : s.values ? text : `${text}\n${facts}`
    }
    // a row: its name and value above, its slider (or choices) across below
    function build(s, index) {
      const row = dom.appendChild(document.createElement('div')), text = help(card.call.name, s.name)
      row.className = 'param'
      const label = row.appendChild(document.createElement('label')), out = row.appendChild(document.createElement('output'))
      label.textContent = s.name
      row.title = tip(s, text)
      if (s.values) {
        const group = row.appendChild(document.createElement('div'))
        group.className = 'choices'
        group.role = 'group'
        group.setAttribute('aria-label', s.name)
        if (text) group.setAttribute('aria-description', text)
        for (const value of s.values) {
          const button = group.appendChild(document.createElement('button'))
          button.type = 'button'
          button.textContent = String(value)
          button.onmousedown = event => event.preventDefault()
          button.onclick = () => write(s, index, value)
        }
        row.classList.add('choice')
        return { s, index, row, out, group }
      }
      const input = row.appendChild(document.createElement('input'))
      Object.assign(input, { type: 'range', min: 0, max: 1000, step: 'any' })
      input.setAttribute('aria-label', s.unit ? `${s.name} (${s.unit})` : s.name)
      if (text) input.setAttribute('aria-description', text)
      input.addEventListener('pointerdown', () => { dragging = input })
      input.addEventListener('pointerup', () => { dragging = null })
      input.addEventListener('input', () => {
        const lim = limits(s), raw = fromSlider(lim, +input.value), step = s.step ?? (lim.log ? Math.max(.01, 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)) - 2)) : (lim.max - lim.min) / 1000)
        write(s, index, +number(Math.round(raw / step) * step, step), true)
      })
      input.addEventListener('change', () => ed.settle())
      return { s, index, row, out, input }
    }
    // The rows in the order the layout gives them, those few touch after a button that folds them away
    function arrange(name) {
      const [front, folded] = layout(name, rows.map(r => r.s.name)), by = n => rows.find(r => r.s.name === n)
      dom.append(...front.map(by).map(r => r.row))
      if (!folded.length) return
      const back = folded.map(by), set = valuesOf(self.spec, card.call), more = dom.appendChild(document.createElement('button'))
      more.type = 'button'
      more.className = 'step-more'
      more.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>Advanced <span></span>'
      more.lastChild.textContent = back.length
      more.title = `Settings few need to touch: ${folded.join(', ')}`
      const fold = open => { more.setAttribute('aria-expanded', String(open)); for (const r of back) r.row.hidden = !open }
      more.addEventListener('mousedown', event => event.preventDefault())
      more.addEventListener('click', () => fold(more.getAttribute('aria-expanded') !== 'true'))
      dom.append(...back.map(r => r.row))
      fold(back.some(r => set[r.index] !== undefined))
    }
    function values() {
      const now = valuesOf(self.spec, card.call)
      for (const row of rows) {
        const v = now[row.index], shown = v ?? row.s.default
        row.out.textContent = v === undefined ? (row.s.default === undefined ? 'auto' : format(row.s.default, row.s)) : format(v, row.s)
        row.out.classList.toggle('unset', v === undefined)
        if (row.input && dragging !== row.input && typeof shown === 'number') row.input.value = toSlider(limits(row.s), shown)
        if (row.group) for (const b of row.group.children) b.setAttribute('aria-pressed', String(b.textContent === String(shown)))
        row.out.hidden = !!row.group
      }
    }
    // Built-in methods take their parameters in order; ranges and plugins also take an options object, used when the
    // call already has one or has no arguments yet. A slider's moves are live and out of the history until it comes to
    // rest; a choice is one step.
    function write(s, index, value, live = false) {
      const call = card.call, op = ops[call.name], spec = self.spec, positional = call.args.filter(a => a.kind !== 'object'), options = call.args.find(a => a.kind === 'object')
      const named = (!op.params || op.range) && (options || !positional.length)
      const change = named ? setArg(call, s.name, value) : setArg(call, index, value, spec.map(p => p.default))
      // what the picture shows at once: the settings it had and the ones it gets, by name, its range with them
      const was = { ...Object.fromEntries(options?.props.map(p => [p.name, p.value]) || []), ...Object.fromEntries(spec.map((p, i) => [p.name, valuesOf(spec, call)[i]])) }
      // bypassed, the output stays as it is
      if (!call.off) onpreview(call.name, was, { ...was, [s.name]: value })
      live ? ed.slide(change) : ed.change(change, 'input.slider')
    }
    return self
  }

  // what the output shows: the card chosen (its id, as choose() takes it) and whether its Δ
  const shown = () => ({ id: chosen, takes: delta != null })
  return { refresh, choose, ahead, at, shown, group: makeGroup, ungroup: () => unmakeGroup() }
}

// The value each parameter has in a call now, by position or by name in an options object; undefined if unset.
export function valuesOf(spec, call) {
  const positional = call.args.filter(a => a.kind !== 'object'), options = call.args.find(a => a.kind === 'object')
  return spec.map((s, i) => options?.props.find(p => p.name === s.name)?.value ?? positional[i]?.value)
}

// What a step is set to, in a few words: its values with their units, a range by its times, a curve by its points, a
// sound by its name; what the words can't say, as written
function summary(code, call) {
  const spec = ops[call.name]?.params
  const words = call.args.filter(a => a.kind !== 'object').map((a, i) => said(code, a, spec?.[i]))
  for (const o of call.args.filter(a => a.kind === 'object')) {
    const props = o.props ?? [], get = name => props.find(p => p.name === name)?.value
    if (Array.isArray(get('t')) && Array.isArray(get('v'))) { words.push(`curve, ${get('t').length} points`); continue }
    for (const p of props) if (p.name !== 'at' && p.name !== 'duration') words.push(p.name === 'mix' && p.value?.t ? offs(p.value) : p.kind === 'object' || typeof p.value === 'number' || Array.isArray(p.value) ? `${p.name} ${said(code, p, spec?.find(s => s.name === p.name))}` : said(code, p))
    if (get('at') != null || get('duration') != null) words.push(times({ at: get('at') ?? 0, duration: get('duration') }))
  }
  return words.filter(Boolean).join(' · ')
}
const seconds = t => `${+t.toFixed(3)}`
const times = r => r.duration == null ? `from ${seconds(r.at)}s` : `${seconds(r.at)}–${seconds(r.at + r.duration)}s`
// a mix that turns its edit off and on over time (step's range, RX's Restore Selection): where it is off; another, its points
function offs({ t, v }) {
  if (!v.every(x => x === 0 || x === 1)) return `mix, ${t.length} points`
  const spans = []
  for (let i = 0; i < t.length; i++) if (!v[i]) spans.at(-1)?.end === i - 1 ? Object.assign(spans.at(-1), { to: t[i], end: i }) : spans.push({ from: i ? t[i] : 0, to: t[i], end: i })
  return 'off ' + spans.map(s => s.end === t.length - 1 ? times({ at: s.from }) : times({ at: s.from, duration: s.to - s.from })).join(', ')
}
function said(code, a, s) {
  const v = a.value
  if (typeof v === 'number') return s ? format(v, s) : `${+v.toFixed(3)}`
  // numbers: a band in hertz, else the numbers; pairs (warp's markers): from → to; ranges: their times
  if (Array.isArray(v)) return v.every(x => typeof x === 'number') ? (s?.unit === 'Hz' || v.length === 2 && v[1] > 20 ? `${format(v[0], { unit: 'Hz' })}–${format(v[1], { unit: 'Hz' })}` : v.map(x => +x.toFixed(3)).join(', '))
    : v.map(x => Array.isArray(x) ? x.map(seconds).join(' → ') : times(x)).join(', ')
  if (Array.isArray(v?.t)) return `${v.t.length} points`
  if (v && typeof v === 'object') return times(v)
  if (typeof v === 'string' || typeof v === 'boolean') return String(v)
  // an expression: a sound opened by name says the name
  const t = code.slice(a.valueFrom ?? a.from, a.valueTo ?? a.to).replace(/\s+/g, ' ').trim(), name = t.match(/^audio\(\s*(['"`])(.+?)\1\s*\)$/)?.[2]
  return name ? name.split('/').pop() : t.length > 24 ? t.slice(0, 23) + '…' : t
}
