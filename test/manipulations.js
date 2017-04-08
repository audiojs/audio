const Audio = require('../');
const t = require('tape');
const assert = require('assert')
const AudioBuffer = require('audio-buffer')
const db = require('decibels')

t.skip('write', t => {
	let audio = Audio([0, .1, .2, .3, .4, .5], 1)

	audio.write(AudioBuffer(1, [1,1]), 2/audio.sampleRate)

	assert.deepEqual(audio.data(1/44100,4/44100)[0], [.1,1,1,.4])

	t.end()
})

t('data', t => {
	let audio = new Audio(1, 2)

	assert.deepEqual(audio.data(-100/audio.sampleRate)[0].length, 100)

	assert.deepEqual(audio.data({channel: 1}).length, audio.sampleRate)

	t.end()
})

t('normalize', t => {
	//full normalize
	let audio = Audio([0, .1, 0, -.1], {channels: 1})

	audio.normalize()
	assert.deepEqual(audio.data()[0], [0, 1, 0, -1]);


	//partial normalize
	let audio2 = Audio([0, .1, 0, -.1], {channels: 1})
	audio2.normalize(2/audio2.sampleRate)
	assert.deepEqual(audio2.data()[0], [0, .1, 0, -1]);

	t.end();
})

t.skip('fade', t => {
	let audio = Audio(Array(1000).fill(1), {channels: 1})

	let inCurve = Array(100).fill(1).map((v, i) => (i + .5)/100).map(v => db.toGain(v*40 - 40))
	let outCurve = inCurve.slice().reverse()

	//fade in
	audio.fade(100/audio.sampleRate)
	assert.deepEqual(audio.data(0, 100/44100)[0], inCurve)

	//fade out
	audio.fade(-100/audio.sampleRate)
	assert.deepEqual(audio.data(-100/44100)[0], outCurve)

	t.end();
})

t('trim', t => {
	let audio = new Audio([0,0,0,.1,.2,-.1,-.2,0,0], 1).trim()

	assert.deepEqual(audio.buffer.getChannelData(0), [.1,.2,-.1,-.2])


	//trim samples from the beginning below -30 db
	audio = Audio([0.0001, 0, .1, .2], 1).trim({threshold: -30, left: true})

	assert.deepEqual(audio.data({channel: 0}), [.1, .2])

	//remove samples below .02 from the end
	audio = Audio([.1, .2, -.1, -.2, 0, .0001], 1).trim({level: .02, left: false})

	assert.deepEqual(audio.data()[0], [.1, .2, -.1, -.2])

	t.end();
})

t('gain', t => {
	let audio = new Audio(Array(44100).fill(1), 1).gain(.5)
	assert.deepEqual(audio.buffer.getChannelData(0), Array(44100).fill(db.toGain(.5*audio.range - audio.range)))
	// <Audio .5, .5, .5, .5, ...>

	t.end()
})

t('reverse', t => {
	let data = Array(1000).fill(1).map((v, i) => (.5 + i)/1000)
	let fixture = data.slice().reverse()

	let audio = new Audio(data, 1)

	audio.reverse()

	assert.deepEqual(audio.data()[0], fixture)

	audio.reverse(10/44100, 10/44100)

	assert.deepEqual(audio.data(10/44100, 10/44100)[0], data.slice(980, 990))

	t.end()
})


t('invert', t => {
	let data = Array(1000).fill(1).map((v, i) => (.5 + i)/1000)
	let fixture = Array(1000).fill(1).map((v, i) => -(.5 + i)/1000)

	let audio = new Audio(data, 1)

	audio.invert()

	assert.deepEqual(audio.data()[0], fixture)

	audio.invert(10/44100, 10/44100)

	assert.deepEqual(audio.data(10/44100, 10/44100)[0], data.slice(10, 20))

	t.end()
})
