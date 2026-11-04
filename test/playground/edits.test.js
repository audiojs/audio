// The edits: the chain's steps and cards, undo and redo, sliders, recipes, the code; the server, the page and the
// helpers in page.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, code, tipOf, wholeLevels, seconds, open, settled, frames, poll, selected, tab, menu, palette, noCues, write, LANES, tall, spans, axis, grab, drag, lengthIs, pixels, bursts, turn, chime, contextRow } from './page.js'

test('editor: a slider rewrites its argument, the output and its guide follow', async () => {
  await open()
  // a press on its card opens its settings
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  const slider = page.locator('.params input[type=range]').first()
  await slider.waitFor()
  assert.equal(await page.locator('.step.open .step-name').innerText(), 'Normalize')
  await slider.fill('500')
  await page.waitForFunction(() => scriptText().includes('normalize(-18)'))
  await page.locator('.readout', { hasText: '−18.0dBFS' }).waitFor()
  // one move, one step back
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => scriptText().includes('normalize(-1)'))
})

// Pointed at, a setting says what it does and which way to move it (help.js), with its range and where it starts; the
// ones few touch wait under Advanced, which opens with the card where the code sets one of them
test('editor: a card\'s settings say what they do; the engine\'s own wait under Advanced', async () => {
  await open()
  const rows = page.locator('.step.open .param'), shown = () => rows.locator('label:visible').allInnerTexts(), more = page.locator('.step.open .step-more')
  // a card opened afresh: a press on the one open closes it, and another opens it
  const reopen = async name => {
    await tab('Edits')
    const card = page.locator('.step-name', { hasText: name })
    if (await page.locator('.step.open .step-name', { hasText: name }).count()) await card.click()
    await card.click()
    await rows.first().waitFor()
  }
  await write(`audio('chime.wav').declick()`)
  await reopen('Declick')
  assert.deepEqual(await shown(), ['threshold'])
  assert.match(await rows.first().evaluate(tipOf), /^Detection threshold\. .*\n2× to 30×, default 8×$/s)
  assert.match(await more.innerText(), /^Advanced\s+2$/)
  assert.equal(await more.getAttribute('aria-expanded'), 'false')
  await more.click()
  assert.deepEqual(await shown(), ['threshold', 'longest', 'order'])
  // every one says more than its name
  assert.deepEqual(await rows.evaluateAll(all => all.filter(row => !row.title.includes('\n')).map(row => row.querySelector('label').textContent)), [])
  // and it folds again
  await more.click()
  assert.deepEqual(await shown(), ['threshold'])
  // moving one writes it into the code, where it is set
  await more.click()
  await page.locator('.step.open .param', { hasText: 'longest' }).locator('input').fill('250')
  await page.waitForFunction(() => /declick\(8, \d/.test(scriptText()))
  // set in the code, one opens the fold with its card (decrackle was never open here); none set, it is folded
  await write(`audio('chime.wav').decrackle({ order: 24 })`)
  await reopen('Decrackle')
  assert.deepEqual(await shown(), ['threshold', 'order'])
  await write(`audio('chime.wav').decrackle()`)
  await reopen('Decrackle')
  assert.deepEqual(await shown(), ['threshold'])
  // a folded choice says what it decides, and sets as a choice does: the expander's mode
  await write(`audio('chime.wav').expander()`)
  await reopen('Expander')
  assert.deepEqual(await shown(), ['threshold', 'ratio', 'range'])
  await more.click()
  const mode = page.locator('.step.open .param', { hasText: 'mode' })
  assert.match(await mode.evaluate(tipOf), /^downward turns quiet sound/)
  await mode.getByRole('button', { name: 'upward' }).click()
  await page.waitForFunction(() => /expander\(\{ mode: 'upward' \}\)/.test(scriptText()))
  // a choice of an edit with none folded says what it decides too, its values on the keys
  await write(`audio('chime.wav').compressor().highpass(80)`)
  await reopen('Highpass')
  assert.match(await page.locator('.step.open .param', { hasText: 'order' }).evaluate(tipOf), /^Steepness\. /)
  // an edit with no settings has nothing to fold
  await write(`audio('chime.wav').reverse()`)
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Reverse' }).click()
  await page.locator('.step.open .params.none').waitFor()
  assert.equal(await page.locator('.step.open .params').innerText(), 'No settings')
  assert.equal(await more.count(), 0)
})

// The edits, as a history: a press on a step shows the output as it is up to it, the steps after it dimmed, and opens
// its settings, one card at a time; a press again, or its badge on the picture, shows the whole chain. The sound the chain
// starts from comes first.
test('editor: a step chosen among the edits shows the output up to it and opens its settings; × removes one', async () => {
  await open()
  await tab('Edits')
  assert.deepEqual(await page.locator('.step-name').allInnerTexts(), ['chime.wav', 'Trim', 'Normalize', 'Fade'])
  // each says what it is set to
  assert.deepEqual(await page.locator('.step-args').allInnerTexts(), ['', '', '−1dB', '0.02s · 0.1s'])
  const card = name => page.locator('.step', { has: page.locator('.step-name', { hasText: name }) })
  const opened = async () => (await page.locator('.step.open .step-name').allInnerTexts()).join()
  const rolled = async () => (await page.locator('.step.rolled .step-name').allInnerTexts()).join()
  // the keys staying where they were: Space plays, types nothing
  await page.locator('.plot').focus()
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('plot')), true)
  await page.locator('.viewing', { hasText: 'Up to Normalize: ' }).waitFor()
  assert.equal(await opened(), 'Normalize')
  assert.equal(await rolled(), 'Fade')
  const slider = await card('Normalize').locator('input[type=range]').first().boundingBox()
  await drag([slider.x + slider.width * .3, slider.y + slider.height / 2], [slider.width * .2, 0])
  assert.equal(await opened(), 'Normalize', 'open after its slider moved')
  assert.ok(await page.locator('.viewing').isVisible(), 'still up to it')
  // the sound it starts from: the file alone
  await page.locator('.step-name', { hasText: 'chime.wav' }).click()
  await page.locator('.viewing', { hasText: 'The source alone' }).waitFor()
  assert.equal(await opened(), '')
  assert.equal(await rolled(), 'Trim,Normalize,Fade')
  await lengthIs('0:08.000')
  // the last step is the whole chain; pressed again, it closes
  await page.locator('.step-name', { hasText: 'Fade' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  assert.equal(await opened(), 'Fade')
  await page.locator('.step-name', { hasText: 'Fade' }).click()
  assert.equal(await opened(), '')
  // the badge on the picture shows the whole chain again
  await page.locator('.step-name', { hasText: 'Trim' }).click()
  await page.locator('.viewing', { hasText: 'Up to Trim: ' }).getByRole('button', { name: 'Show all' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  assert.equal(await rolled(), '')
  // what a step sets shows on the picture only while its card is under the pointer: normalize's level, a dashed line
  // across each lane, twice
  const orange = () => pixels(`let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] - d[i + 2] > 60) n++; return n`)
  await page.mouse.move(0, 0)
  await settled()
  const away = await orange(), width = (await page.locator('.plot').boundingBox()).width
  await card('Normalize').hover()
  await poll(orange, over => assert.ok(over - away > width, `the level lines: ${away} orange pixels, ${over} over its card`))
  await page.mouse.move(0, 0)
  await poll(orange, n => assert.ok(Math.abs(n - away) < width / 4, 'gone with the pointer'))
  // keys on the picture, or Tab to the next control, draw no focus ring
  await page.locator('.plot').focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('.plot').evaluate(el => getComputedStyle(el).outlineStyle), 'none')
  // × takes the call out of the chain, with its line
  await card('Trim').hover()
  await page.getByRole('button', { name: 'Remove trim' }).click()
  await page.waitForFunction(() => { const t = document.querySelector('.cm-content').textContent; return /\.normalize\(-[\d.]+\)/.test(t) && !t.includes('trim') })
  assert.deepEqual(await page.locator('.step-name').allInnerTexts(), ['chime.wav', 'Normalize', 'Fade'])
  // Add an edit, right under the last card
  const [lastCard, add] = await Promise.all([page.locator('.step').last().boundingBox(), page.locator('.add-step').boundingBox()])
  assert.ok(add.y - (lastCard.y + lastCard.height) < 12, `right under it: ${add.y - (lastCard.y + lastCard.height)}px`)
  // two acts, its eye and ×, over its right end, taking no room: what it is set to runs to the card's edge
  await card('Fade').hover()
  assert.deepEqual(await card('Fade').locator('.step-acts button').evaluateAll(b => b.map(x => x.getAttribute('aria-label'))), ['Turn fade off', 'Remove fade'])
  const [whole, args] = await Promise.all([card('Fade').boundingBox(), card('Fade').locator('.step-args').boundingBox()])
  assert.ok(whole.x + whole.width - (args.x + args.width) <= 13, `to the card's edge: ${whole.x + whole.width - (args.x + args.width)}px short`)
})

// A number in the code drags, as Bret Victor's Tangle has it: across, a step (its last decimal's) for every 4 px, the
// output following as it goes; let go, one step of the history. A minus before it is its own
test('editor: a number in the code drags, the output following, one step of the history', async () => {
  await open()
  await tab('Code')
  const one = page.locator('.cm-line', { hasText: '.normalize(' }).locator('span', { hasText: /^1$/ })
  const at = await one.boundingBox(), y = at.y + at.height / 2
  await page.mouse.move(at.x + at.width / 2, y)
  await page.mouse.down()
  assert.equal(await one.evaluate(el => getComputedStyle(el).cursor), 'ew-resize', 'its pointer says it drags')
  await page.mouse.move(at.x + at.width / 2 - 22, y, { steps: 5 })
  await page.waitForFunction(() => scriptText().includes('.normalize(-6)'))
  await page.locator('.readout', { hasText: '−6.0dBFS' }).waitFor()
  await page.mouse.up()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText().includes('.normalize(-1)'))
  // through zero, its minus its own: −1, 9 px right (two steps), is 1; a decimal steps by its last place: 0.02, 9 px
  // right, is 0.04
  const drag9 = async locator => { const b = await locator.boundingBox(), cy = b.y + b.height / 2; await page.mouse.move(b.x + b.width / 2, cy); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 9, cy, { steps: 3 }); await page.mouse.up() }
  await drag9(page.locator('.cm-line', { hasText: '.normalize(' }).locator('span', { hasText: /^1$/ }))
  await page.waitForFunction(() => scriptText().includes('.normalize(1)'))
  await drag9(page.locator('.cm-line', { hasText: '.fade(' }).locator('span', { hasText: /^0\.02$/ }))
  await page.waitForFunction(() => scriptText().includes('.fade(0.04, 0.1)'))
  // only pressed, the caret goes there and nothing changes
  const before = await code(), two = page.locator('.cm-line', { hasText: '.fade(' }).locator('span', { hasText: /^0\.1$/ }), b = await two.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  await frames()
  assert.equal(await code(), before)
})

// The edits as a stack of layers: a step chosen shows the output up to it; an edit made then goes in right after it, the
// steps after it kept, its own card chosen; undo takes it back, the step chosen as it was
test('editor: an edit made with the output rolled back to a step goes in right after it, the steps after it kept', async () => {
  await open()
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Trim' }).click()
  await page.locator('.viewing', { hasText: 'Up to Trim: ' }).waitFor()
  await wholeLevels().waitFor()
  await page.keyboard.press('m')
  await page.waitForFunction(() => /\.trim\(\)\s*\.mark\(0\)\s*\.normalize\(-1\)\s*\.fade\(0\.02, 0\.1\)$/.test(scriptText().trim()))
  assert.deepEqual(await page.locator('.step-name').allInnerTexts(), ['chime.wav', 'Trim', 'Mark', 'Normalize', 'Fade'])
  await page.locator('.viewing', { hasText: 'Up to Mark: 2 later steps bypassed' }).waitFor()
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => /\.trim\(\)\s*\.normalize\(-1\)\s*\.fade\(0\.02, 0\.1\)$/.test(scriptText().trim()))
  await page.locator('.viewing', { hasText: 'Up to Trim: ' }).waitFor()
})

// Rolled back, a choice that sets the last step again in place (the grip's way, a fade's curve) leaves the steps after
// the one shown alone: only what shows is set again, never a step hidden
test('editor: rolled back to a step, the grip\'s way leaves a stretch after it as it is', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2
  await write(`audio('chime.wav').stretch(1.5, { at: 1, duration: 1 })`)
  await lengthIs('0:08.500')
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'chime.wav' }).click()
  await page.locator('.viewing', { hasText: 'The source alone' }).waitFor()
  await lengthIs('0:08.000')
  await drag([x(1), y], [x(2) - x(1), 0])
  await turn(await grab([[x(2) + 8, box.y + lh * 3 / 4]], /^url\(|ew-resize/), 'grip', 'speed')
  await settled()
  assert.equal(await code(), `audio('chime.wav').stretch(1.5, { at: 1, duration: 1 })`)
})

// What is selected is kept beside each step of the history, as a text editor keeps its selections: undo brings back what
// was selected before the step, redo what was selected after it. A stretch makes its range longer: undone, the range is
// as long as it was; a delete leaves a caret: undone, its range is selected again
test('editor: undo brings back what was selected before the step, redo what was selected after it', async () => {
  const { box, x, y } = await chime(), lh = (tall(box) - LANES) / 2
  await drag([x(1), y], [x(2) - x(1), 0])
  await drag(await grab([[x(2) + 8, box.y + lh * 3 / 4]], /^url\(|ew-resize/), [x(1.5) - x(1), 0])
  await page.waitForFunction(() => /\.stretch\(1\.5, \{ at: 1, d: 1 \}\)$/.test(scriptText()))
  assert.equal(await selected(), '0:01.000–0:02.500')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText() === "audio('chime.wav')")
  assert.equal(await selected(), '0:01.000–0:02.000', 'as before the stretch')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await page.waitForFunction(() => /\.stretch\(/.test(scriptText()))
  assert.equal(await selected(), '0:01.000–0:02.500', 'as after it')
  await lengthIs('0:08.500')
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.remove\(/.test(scriptText()))
  assert.equal(await selected(), '')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !/\.remove\(/.test(scriptText()))
  assert.equal(await selected(), '0:01.000–0:02.500', 'the range deleted, selected again')
})

test('editor: Undo steps back through the script, a slider drag one step however long it pauses', async () => {
  await open()
  // Edit > Undo, as the keys, what there is to undo named
  const row = name => page.locator('.menubar-list .menu-row', { has: page.locator('.menu-label', { hasText: new RegExp(`^${name}$`) }) })
  const undoable = async () => { await page.locator('.menubar-item', { hasText: /^Edit$/ }).click(); const off = await row('Undo').getAttribute('aria-disabled'); await page.keyboard.press('Escape'); return off !== 'true' }
  assert.equal(await undoable(), false, 'nothing to undo yet')
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Normalize' }).click()
  const slider = await page.locator('.params input[type=range]').first().boundingBox(), y = slider.y + slider.height / 2
  await page.mouse.move(slider.x + slider.width * .3, y)
  await page.mouse.down()
  await page.mouse.move(slider.x + slider.width * .45, y, { steps: 5 })
  // longer than the history joins typing across
  await page.waitForTimeout(700)
  await page.mouse.move(slider.x + slider.width * .6, y, { steps: 5 })
  await page.mouse.up()
  assert.doesNotMatch(await code(), /normalize\(-1\)/)
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => scriptText().includes('normalize(-1)'))
  assert.equal(await undoable(), false, 'back where it started')
  // what was done: the step undone, still there to redo, named by what it changed (Edit > History, newest first)
  await page.locator('.menubar-item', { hasText: /^Edit$/ }).click()
  await row('History').click()
  const steps = await page.locator('.menubar-list[aria-label="History"]').locator('.menu-label').allInnerTexts()
  await page.keyboard.press('Escape')
  assert.match(steps[0], /^normalize: -1 → -?[\d.]+$/)
  assert.equal(steps[1], 'The script as it opened')
})

test('editor: deleting a selection writes remove() and shortens the output by its length', async () => {
  await open()
  const before = await seconds(), { box, x } = await axis(before)
  await page.mouse.move(x(before * .25), box.y + 100)
  await page.mouse.down()
  await page.mouse.move(x(before * .5), box.y + 120, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => scriptText().includes('.remove('))
  // its sides crossfaded over 10 ms (the settings), the length still less by the selection's
  const [, at, duration] = (await code()).match(/\.remove\(\{ at: ([\d.]+), d: ([\d.]+), xfade: 0\.01 \}\)/)
  // each time goes to the zoom's 1-2-5 step, at most 2.5 pixels
  const px = before / await spans(box)
  assert.ok(Math.abs(+at - before * .25) < 3 * px && Math.abs(+duration - before * .25) < 3 * px, `${at} ${duration}`)
  await page.waitForFunction(expected => Math.abs(+(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1] - expected) < .002, before - +duration)
  // the waveform shares the script's history
  await page.locator('.plot').focus()
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.remove('))
  await page.waitForFunction(expected => Math.abs(+(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(' · ').pop().split(':')[1] - expected) < .002, before)
})

test('editor: completion lists methods by group and a chosen one opens its sliders', async () => {
  await open()
  await tab('Code')
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\n  .gai')
  const options = page.locator('.cm-tooltip-autocomplete li')
  await options.first().waitFor()
  assert.ok((await options.allInnerTexts()).some(t => t.startsWith('gain')))
  // CodeMirror takes no accept key for 75 ms after the list opens (autocompletion's interactionDelay)
  await page.waitForTimeout(100)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => scriptText().endsWith('.gain()'))
  await tab('Edits')
  await page.locator('.step-name', { hasText: 'Gain' }).click()
  await page.locator('.step.open .step-name', { hasText: 'Gain' }).waitFor()
  await page.locator('.step.open .params input[type=range]').first().fill('750')
  await page.waitForFunction(() => /\.gain\(0\)$/.test(scriptText()))
})

// A recipe goes on the sound as it is, nothing rewritten: its calls after the chain's own, one step; over the selection
// when there is one; a script of statements takes the chain as its source; one that makes a sound opens a tab. Its
// de-reverb model is not fetched: the script is what is tested
test('editor: a recipe goes on the sound as it is, over the selection when there is one, one step', async () => {
  await page.route(/huggingface\.co/, route => route.abort())
  await open()
  const chime = `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`
  await menu('Process', 'Recipes', 'Reduce noise')
  assert.equal(await code(), `${chime}\n  .omlsa()`)
  await menu('Edit', 'Undo')
  await page.waitForFunction(c => scriptText() === c, chime)
  await noCues()
  const { box, x } = await axis(6.525), y = box.y + tall(box) / 3
  await drag([x(1), y], [x(2) - x(1), 0])
  await menu('Process', 'Recipes', 'Remove room echo')
  await page.waitForFunction(c => scriptText() === c, `${chime}\n  // Remove room echo\n    .highpass(80, { at: 1, d: 1 })\n    .dereverb({ at: 1, d: 1 })`)
  await menu('Edit', 'Undo')
  await page.waitForFunction(c => scriptText() === c, chime)
  await menu('Process', 'Recipes', 'Measure loudness')
  assert.match(await code(), /^let a = audio\('chime\.wav'\)\n  \.trim\(\)\n  \.normalize\(-1\)\n  \.fade\(0\.02, 0\.1\)\nlet \[lufs/)
  await menu('Process', 'Recipes', 'Measure loudness')
  assert.match(await code(), /\nlet a2 = a\nlet \[lufs2, peak2, range2\] = await a2\.stat\(\['loudness', 'db', 'lra'\]\)\nconsole\.log\(`\$\{lufs2\.toFixed\(1\)\} LUFS · peak \$\{peak2/)
  await page.waitForFunction(() => !document.querySelector('.message.problem'))
  const tabs = await page.locator('.files .file').count()
  await menu('Process', 'Recipes', 'Noise')
  await page.waitForFunction(n => document.querySelectorAll('.files .file').length === n + 1, tabs)
  assert.equal(await code(), `audio.from(3).noise({ color: 'pink' })`)
})

// Several ranges, as a text editor's several selections: the next pause like the one selected joins it (⌘D), and an
// edit acts on each, in one step
test('editor: pauses selected together are shortened or deleted together, in one step', async () => {
  await open()
  await write(bursts)
  await lengthIs('0:02.500')
  const { box, x } = await axis(2.5), y = box.y + tall(box) / 3
  await page.mouse.dblclick(x(.45), y)
  await page.keyboard.press('ControlOrMeta+D')
  await page.keyboard.press('ControlOrMeta+D')
  assert.match(await page.locator('.clock').evaluate(tipOf), /^Selected 3 ranges: 0:00\.\d+, \d+ samples/)
  await palette('Delete all 3')
  // the pauses at 0.4–0.5, 0.9–1.5 and 1.9–2 s, from the last back, so each time holds
  await page.waitForFunction(() => (scriptText().match(/\.remove\(/g) || []).length === 3)
  const ats = [...(await code()).matchAll(/remove\(\{ at: ([\d.]+)/g)].map(m => +m[1])
  assert.ok(ats[0] > ats[1] && ats[1] > ats[2] && Math.abs(ats[2] - .4) < .03, JSON.stringify(ats))
  await page.waitForFunction(() => +(e => e.title || e.dataset.tip || '')(document.querySelector('.source')).split(':').pop() < 1.8)
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => !scriptText().includes('.remove('))
})

// A card's switches: a step turned off (its eye) is commented out where it stands; open, its Δ plays and draws what it
// takes out
test('editor: a step turns off and on, Δ shows what it takes out', async () => {
  await open()
  await tab('Edits')
  const card = name => page.locator('.step', { has: page.locator('.step-name', { hasText: name }) })
  await card('Normalize').hover()
  await page.getByRole('button', { name: 'Turn normalize off' }).click()
  await page.waitForFunction(() => document.querySelector('.cm-content').textContent.includes('// .normalize(-1)'))
  await page.waitForFunction(() => !document.querySelector('.readout').textContent.startsWith('−1.0'))
  assert.ok(await card('Normalize').evaluate(el => el.classList.contains('off')))
  await card('Normalize').hover()
  await page.getByRole('button', { name: 'Turn normalize on' }).click()
  await page.waitForFunction(() => !document.querySelector('.cm-content').textContent.includes('//'))
  await page.locator('.readout', { hasText: '−1.0dBFS' }).waitFor()
  // what the fade takes out, from its card open: the start and end it softens, far under the output
  await card('Fade').locator('.step-name').click()
  await card('Fade').getByRole('button', { name: 'Δ What it takes out' }).click()
  await page.locator('.viewing', { hasText: 'What Fade takes out' }).waitFor()
  await page.waitForFunction(() => { const m = document.querySelector('.readout').textContent.match(/^−([\d.]+)dBFS/); return m && +m[1] > 6 })
  await card('Fade').getByRole('button', { name: 'Δ What it takes out' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  await page.locator('.readout', { hasText: '−1.0dBFS' }).waitFor()
})

// A generated sound's first call makes it: the source has nothing to turn off, take away or remove; chosen, it is the
// sound alone. A step that changes time, rate or channels has nothing to take away (Δ): it doesn't line up.
test('editor: a generated sound\'s source has no switches and shows the sound alone; a step that reshapes has no Δ', async () => {
  await open()
  await write(`audio.from(t => 0.5 * Math.sin(2 * Math.PI * 440 * t), { duration: 1, channels: 2 }).gain(-3).filter('highpass', 80).remix(1).speed(2)`)
  await lengthIs('0:00.500')
  await tab('Edits')
  const card = name => page.locator('.step', { has: page.locator('.step-name', { hasText: name }) })
  // the source: nothing to turn off or remove
  assert.equal(await card('From').locator('.step-acts').count(), 0)
  assert.deepEqual(await card('Gain').locator('.step-acts button').evaluateAll(b => b.map(x => x.getAttribute('aria-label'))), ['Turn gain off', 'Remove gain'])
  // open, a step that reshapes has no Δ
  const delta = async name => { await card(name).locator('.step-name').click(); const n = await card(name).locator('.step-delta').count(); await card(name).locator('.step-name').click(); return n }
  assert.deepEqual([await delta('Gain'), await delta('Filter'), await delta('Remix'), await delta('Speed')], [1, 1, 0, 0])
  await page.locator('.step-name', { hasText: 'From' }).click()
  await page.locator('.viewing', { hasText: 'Up to From: ' }).waitFor()
  await lengthIs('0:01.000')
  await page.locator('.viewing').getByRole('button', { name: 'Show all' }).click()
  await page.locator('.viewing').waitFor({ state: 'detached' })
  await lengthIs('0:00.500')
})

// What each card says of its step: numbers with their units, a band in hertz, a range by its times, a gain curve by its
// points, warp's markers as from → to, a sound by its name
test('editor: each card says what its step is set to, whatever its arguments are', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain({ t: [0, 1, 2], v: [0, -6, 0] })\n  .spectral([500, 2000], -6, { at: 1, duration: 0.5 })\n  .warp([[1, 1.2], [2, 2.1]])\n  .mix(audio('chime.wav'), { at: 2 })\n  .normalize(-16, 'lufs')`)
  await lengthIs('0:08.000')
  await tab('Edits')
  assert.deepEqual(await page.locator('.step-args').allInnerTexts(), ['', 'curve, 3 points', '500Hz–2kHz · −6dB · 1–1.5s', '1 → 1.2, 2 → 2.1', 'chime.wav · from 2s', '−16dB · lufs'])
})

// A number selected in the code: ↑ and ↓ step it by its last decimal's step, ten with Shift, still selected; what it
// sets said by it (normalize's target, in dB, its slider from −36 to 0 dB, ops.js)
test('editor: a number selected in the code steps with the arrows, saying what it sets', async () => {
  await open()
  await tab('Code')
  await page.locator('.cm-line', { hasText: '.normalize(' }).locator('span', { hasText: /^1$/ }).dblclick()
  await page.keyboard.press('ArrowUp')
  await page.waitForFunction(() => scriptText().includes('.normalize(0)'))
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForFunction(() => scriptText().includes('.normalize(10)'))
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => scriptText().includes('.normalize(9)'))
  await page.locator('.hint', { hasText: /^normalize target 9dB, −36dB to 0dB$/ }).waitFor()
  // a decimal, all of it selected by a double-click, by its last place; pointed at, a number says what it sets
  await page.locator('.cm-line', { hasText: '.fade(' }).locator('span', { hasText: /^0\.02$/ }).dblclick()
  await page.keyboard.press('ArrowUp')
  await page.waitForFunction(() => scriptText().includes('.fade(0.03, 0.1)'))
  await page.locator('.cm-content').click({ position: { x: 4, y: 4 } })
  await page.locator('.cm-line', { hasText: '.fade(' }).locator('span', { hasText: /^0\.1$/ }).hover()
  await page.locator('.hint', { hasText: /^fade out 0\.1s, 0s to 5s$/ }).waitFor()
})

// The edits' cards are as wide as the panel: a long call's settings, folded, are cut short with an ellipsis, never
// widening the card past the panel
test('editor: a long step is cut short in its card, the card no wider than the panel', async () => {
  await open()
  await write(`audio('chime.wav')\n  .warp([${Array.from({ length: 12 }, (_, i) => `[${i / 2 + .5}, ${i / 2 + .6}]`).join(', ')}])`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const side = await page.locator('.side-slab').boundingBox(), card = await page.locator('.step').last().boundingBox()
  assert.ok(card.x + card.width <= side.x + side.width + .5, `the card in the panel: ${card.x + card.width} ≤ ${side.x + side.width}`)
  assert.ok(await page.locator('.step').last().locator('.step-args').evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === 'ellipsis'), 'its settings cut short')
})

// A recipe of several calls is one step of the edits: its name a comment, its calls indented under it (code.js groups),
// one card, folded; a press unfolds it to its steps, its eye turns them all off and on in one step, its × takes them
// all away. An edit made after it is a step of its own, not the group's. Its de-reverb model is not fetched
test('editor: a recipe is one card of the edits, its steps folded under it, turned off or removed together', async () => {
  await page.route(/huggingface\.co/, route => route.abort())
  await open()
  const chime = `audio('chime.wav')\n  .trim()\n  .normalize(-1)\n  .fade(0.02, 0.1)`
  await menu('Process', 'Recipes', 'Remove room echo')
  const grouped = `${chime}\n  // Remove room echo\n    .highpass(80)\n    .dereverb()`
  await page.waitForFunction(c => scriptText() === c, grouped)
  await tab('Edits')
  const names = () => page.locator('.steps-list > li:not([hidden]) .step-name').allInnerTexts()
  await page.waitForFunction(() => document.querySelector('.step-group'))
  assert.deepEqual(await names(), ['chime.wav', 'Trim', 'Normalize', 'Fade', 'Remove room echo'])
  assert.equal(await page.locator('.step-group .step-args').innerText(), '2 steps')
  const group = page.locator('.step-group .step-toggle')
  await group.click()
  assert.deepEqual(await names(), ['chime.wav', 'Trim', 'Normalize', 'Fade', 'Remove room echo', 'Highpass', 'Dereverb'])
  await group.click()
  assert.deepEqual(await names(), ['chime.wav', 'Trim', 'Normalize', 'Fade', 'Remove room echo'])
  // its eye: all its steps off, in one step of the history, and back on
  await page.locator('.step-group').hover()
  await page.getByRole('button', { name: 'Turn Remove room echo off' }).click()
  await page.waitForFunction(() => /\n    \/\/ \.highpass\(80\)\n    \/\/ \.dereverb\(\)$/.test(scriptText()))
  await menu('Edit', 'Undo')
  await page.waitForFunction(c => scriptText() === c, grouped)
  // an edit after it is its own step
  await page.locator('.plot').focus()
  await page.keyboard.press('m')
  await page.waitForFunction(c => scriptText() === c + '\n  .mark(0)', grouped)
  await page.waitForFunction(() => [...document.querySelectorAll('.steps-list > li:not([hidden]) .step-name')].map(e => e.textContent).at(-1) === 'Mark')
  // its ×: all of it away, the name too
  await page.locator('.step-group').hover()
  await page.getByRole('button', { name: 'Remove Remove room echo' }).click()
  await page.waitForFunction(c => scriptText() === c + '\n  .mark(0)', chime)
  assert.equal(await page.locator('.step-group').count(), 0)
})

// Recipes: a goal's whole chain, a group each, folded till opened; found by its words (its group opening), put on the
// sound open
test('editor: a recipe found by its words goes on the sound open; its groups fold', async () => {
  await open()
  await tab('Recipes')
  const master = page.locator('.recipe-group', { has: page.locator('summary', { hasText: /^Master/ }) })
  assert.equal(await master.locator('.scenario').first().isVisible(), false, 'folded')
  await master.locator('summary').click()
  assert.ok((await master.locator('.scenario strong').allInnerTexts()).includes('Mastering chain, dither last'), 'opened: the mastering recipes')
  await page.getByRole('searchbox', { name: 'Find a recipe' }).fill('restore vinyl')
  assert.deepEqual(await page.locator('.scenario strong').allInnerTexts(), ['Restore vinyl'])
  await page.locator('.scenario', { hasText: 'Restore vinyl' }).click()
  await page.waitForFunction(() => /^audio\('chime\.wav'\)\.trim\(\)\.normalize\(-1\)\.fade\(0\.02,0\.1\)\/\/Restorevinyl\.declick\(\)\.decrackle\(\)\.midside/.test(scriptText().replace(/\s+/g, '')))
})

// History as Photoshop's: a card chosen rolls the output back to it; an edit made then goes in right after it, its card
// chosen; undone, the card chosen before is chosen again; redone, the edit's card
test('editor: an edit made rolled back to a card, undone and redone, brings back the card chosen with it', async () => {
  await open()
  await noCues()
  await write(`audio('chime.wav')\n  .gain(-3)\n  .reverse()\n  .highpass(80)`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const card = name => page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: new RegExp(`^${name}$`) }) })
  await card('Gain').locator('.step-toggle').click()
  await page.locator('.viewing', { hasText: 'Up to Gain: 2 later steps bypassed' }).waitFor()
  const { box, x } = await axis(8), y = box.y + tall(box) * .3
  await drag([x(2), y], [x(3) - x(2), 0])
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => /\.gain\(-3\)\s*\.remove\([^)]*\)\s*\.reverse\(\)\s*\.highpass\(80\)$/.test(scriptText().trim()))
  await page.locator('.viewing', { hasText: 'Up to Remove: 2 later steps bypassed' }).waitFor()
  assert.ok(await card('Remove').evaluate(el => el.classList.contains('chosen')), 'the edit\'s card chosen')
  await page.keyboard.press('ControlOrMeta+Z')
  await page.waitForFunction(() => scriptText().includes('.reverse()') && !scriptText().includes('.remove('))
  await page.locator('.viewing', { hasText: 'Up to Gain: 2 later steps bypassed' }).waitFor()
  assert.ok(await card('Gain').evaluate(el => el.classList.contains('chosen')), 'its card chosen again')
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  await page.waitForFunction(() => scriptText().includes('.remove('))
  await page.locator('.viewing', { hasText: 'Up to Remove: 2 later steps bypassed' }).waitFor()
})

// A card dragged up or down takes its step there in the chain; a step bypassed keeps its card where it is, as tall, open
// if it was, the output whole; its settings set in its comment, nothing run, till it is back on
test('editor: a card dragged takes its step along the chain; one bypassed stays where it is, as it was', async () => {
  await page.addInitScript(() => { const post = Worker.prototype.postMessage; window.runs = 0; Worker.prototype.postMessage = function (m, ...r) { if (m?.type === 'run') runs++; return post.call(this, m, ...r) } })
  await open()
  await write(`audio('chime.wav')\n  .gain(-3)\n  .reverse()\n  .highpass(80)`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const card = name => page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: new RegExp(`^${name}$`) }) })
  const names = () => page.locator('.step-name').allInnerTexts()
  const from = await card('Highpass').locator('.step-toggle').boundingBox(), to = await card('Gain').locator('.step-toggle').boundingBox()
  await page.mouse.move(from.x + 40, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, to.y + 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(() => /\.highpass\(80\)\s*\.gain\(-3\)\s*\.reverse\(\)$/.test(scriptText().trim()))
  assert.deepEqual(await names(), ['chime.wav', 'Highpass', 'Gain', 'Reverse'])
  assert.equal(await page.locator('.viewing').count(), 0, 'a drag is no click: nothing chosen')
  // chosen, then bypassed: in place, open, dimmed
  await card('Gain').locator('.step-toggle').click()
  await page.locator('.viewing', { hasText: 'Up to Gain: ' }).waitFor()
  const box = await card('Gain').boundingBox()
  await card('Gain').hover()
  await page.getByRole('button', { name: 'Turn gain off' }).click()
  await page.waitForFunction(() => scriptText().includes('// .gain(-3)'))
  assert.deepEqual(await names(), ['chime.wav', 'Highpass', 'Gain', 'Reverse'])
  assert.ok(await card('Gain').evaluate(el => el.classList.contains('open') && el.classList.contains('chosen') && el.classList.contains('off')), 'open, chosen, off')
  assert.deepEqual(await card('Gain').boundingBox(), box, 'where it was, as tall')
  await page.locator('.viewing').waitFor({ state: 'detached' })
  // set while bypassed: into its comment, nothing run
  const ran = await page.evaluate(() => runs), slider = card('Gain').locator('input[type=range]').first()
  await slider.evaluate(el => { el.value = 700; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) })
  await page.waitForFunction(() => /^  \/\/ \.gain\(-?[\d.]+\)$/m.test(scriptText()) && !scriptText().includes('.gain(-3)'))
  await settled()
  assert.equal(await page.evaluate(() => runs), ran, 'nothing run')
  assert.ok(await card('Gain').evaluate(el => el.classList.contains('open') && el.classList.contains('off')), 'open, off')
  assert.equal(await page.locator('.viewing').count(), 0, 'the output whole')
  await card('Gain').hover()
  await page.getByRole('button', { name: 'Turn gain on' }).click()
  await page.waitForFunction(() => /^  \.gain\(-?[\d.]+\)$/m.test(scriptText()) && !scriptText().includes('//'))
  await page.locator('.viewing', { hasText: 'Up to Gain: ' }).waitFor()
  assert.ok(await page.evaluate(n => runs > n, ran), 'back on, it runs')
})

// The edits as a layers panel: rows picked with Shift made a group (⌘G), open, its steps set in under its name; the
// name double-clicked, named anew; a step dragged by a step of it goes into it, out by one outside; the group dragged
// whole; ⇧⌘G unmakes it. Each one step of the history
test('editor: the edits as layers: picked rows grouped, named, dragged in and out, the group moved whole, unmade', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain(-3)\n  .reverse()\n  .highpass(80)\n  .fade(1)`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const row = name => page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: new RegExp(`^${name}$`) }) })
  const names = () => page.locator('.steps-list .step:not([hidden]) .step-name').allInnerTexts()
  await row('Reverse').locator('.step-toggle').click()
  await row('Highpass').locator('.step-toggle').click({ modifiers: ['Shift'] })
  assert.ok(await row('Highpass').evaluate(el => el.classList.contains('picked')))
  await page.keyboard.press('ControlOrMeta+G')
  await page.waitForFunction(() => scriptText().includes('  // Group\n    .reverse()\n    .highpass(80)\n  .fade(1)'))
  assert.deepEqual(await names(), ['chime.wav', 'Gain', 'Group', 'Reverse', 'Highpass', 'Fade'], 'open, its steps under it')
  // named anew
  await row('Group').locator('.step-toggle').dblclick()
  await page.locator('.step-rename').fill('Montage')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => scriptText().includes('// Montage'))
  // a step dragged onto one of its steps goes in, set in as they are
  const drag = async (name, onto, below = true) => {
    const a = await row(name).locator('.step-toggle').boundingBox(), b = await row(onto).locator('.step-toggle').boundingBox()
    await page.mouse.move(a.x + 30, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 30, below ? b.y + b.height - 2 : b.y + 2, { steps: 10 })
    await page.mouse.up()
  }
  await drag('Fade', 'Reverse', false)
  await page.waitForFunction(() => scriptText().includes('  // Montage\n    .fade(1)\n    .reverse()\n    .highpass(80)'))
  // the group dragged whole, above the gain
  await drag('Montage', 'Gain', false)
  await page.waitForFunction(() => /audio\('chime\.wav'\)\n  \/\/ Montage\n    \.fade\(1\)\n    \.reverse\(\)\n    \.highpass\(80\)\n  \.gain\(-3\)$/.test(scriptText()))
  // unmade, from the menu as from ⇧⌘G
  await row('Reverse').locator('.step-toggle').click()
  await menu('Edit', 'Ungroup')
  await page.waitForFunction(() => scriptText() === `audio('chime.wav')\n  .fade(1)\n  .reverse()\n  .highpass(80)\n  .gain(-3)`)
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => scriptText().includes('// Montage'))
})

// A layer's chevron, before its icon, turns down while it is open (a step's settings shown, a group unfolded). Its menu,
// right-clicked: muted and back on, moved, grouped, the chain up to it made one sound (a file kept as a take is, the
// script opening it, its marks marked on it again, the steps after it going on from it), one step of the history each
test('editor: layers: a chevron while open; a row\'s menu mutes, moves, groups and flattens the chain up to it', async () => {
  await open()
  await write(`audio('chime.wav')\n  .gain(-3)\n  .mark(1, 'one')\n  .reverse()\n  .highpass(80)`)
  await lengthIs('0:08.000')
  await tab('Edits')
  const row = name => page.locator('.steps-list .step', { has: page.locator('.step-name', { hasText: new RegExp(`^${name}$`) }) })
  // turned as it settles (it turns over a moment)
  const turned = (name, to) => row(name).locator('.step-chevron').evaluate((el, to) => new Promise(done => { const look = () => getComputedStyle(el).rotate === to ? done(true) : requestAnimationFrame(look); look(); setTimeout(() => done(false), 1000) }), to)
  assert.ok(await turned('Reverse', 'none'))
  await row('Reverse').locator('.step-toggle').click()
  assert.ok(await turned('Reverse', '90deg'), 'open: turned down')
  assert.equal(await row('chime.wav').locator('.step-chevron').evaluate(el => getComputedStyle(el).visibility), 'hidden', 'the sound opens to nothing')
  const rowMenu = async (name, item) => { await row(name).locator('.step-toggle').click({ button: 'right' }); await contextRow(item).click() }
  await rowMenu('Highpass', 'Mute')
  await page.waitForFunction(() => scriptText().includes('// .highpass(80)'))
  await rowMenu('Highpass', 'Unmute')
  await page.waitForFunction(() => scriptText().includes('\n  .highpass(80)'))
  await rowMenu('Reverse', 'Move up')
  await page.waitForFunction(() => /\.gain\(-3\)\n  \.mark\(1, 'one'\)\n  \.reverse\(\)/.test(scriptText()) || /\.gain\(-3\)\n  \.reverse\(\)\n  \.mark/.test(scriptText()))
  await rowMenu('Highpass', 'Group')
  await page.waitForFunction(() => scriptText().includes('  // Group\n    .highpass(80)'))
  // the chain up to Reverse, one sound: a file of its own, its mark on it again, the steps after it from it
  await rowMenu('Reverse', 'Flatten up to here')
  await page.waitForFunction(() => /^audio\('chime-flat\.wav'\)/.test(scriptText()))
  assert.match(await code(), /^audio\('chime-flat\.wav'\)\n  \.mark\(1, 'one'\)\n  \/\/ Group\n    \.highpass\(80\)$/)
  await lengthIs('0:08.000')
  const kept = await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('audio-repl-files'); const names = []; for await (const k of d.keys()) names.push(decodeURIComponent(k)); return names })
  assert.ok(kept.includes('chime-flat.wav'), 'kept as a take is')
  await rowMenu('Highpass', 'Flatten all')
  await page.waitForFunction(() => /^audio\('chime-flat-2\.wav'\)\n  \.mark\(1, 'one'\)$/.test(scriptText()))
  await menu('Edit', 'Undo')
  await page.waitForFunction(() => /^audio\('chime-flat\.wav'\)\n  \.mark\(1, 'one'\)\n  \/\/ Group/.test(scriptText()))
})
