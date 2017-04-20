const Audio = require('../');
const t = require('tape');
const assert = require('assert')
const AudioBuffer = require('audio-buffer')
const db = require('decibels')

t.skip('write', t => {
	let audio = Audio([0, .1, .2, .3, .4, .5], 1)

	audio.write(AudioBuffer(1, [1,1]), 2/audio.sampleRate)

	t.deepEqual(audio.data(1/44100,4/44100)[0], [.1,1,1,.4])

	t.end()
})

t('data', t => {
	let audio = new Audio(1, 2)

	t.deepEqual(audio.data(-100/audio.sampleRate)[0].length, 100)

	t.deepEqual(audio.data({channel: 1}).length, audio.sampleRate)

	let audio3 = Audio([0, .1, 0, .2, 0, .3], 3)
	t.deepEqual(audio3.data(), [new Float32Array([0, .1]), new Float32Array([0, .2]), new Float32Array([0, .3])])

	t.end()
})

t('normalize', t => {
	//full normalize
	let audio = Audio([0, .1, 0, -.1], {channels: 1})

	audio.normalize()
	t.deepEqual(audio.data({channel: 0}), [0, 1, 0, -1]);

	//partial normalize
	let audio2 = Audio([0, .1, 0, -.1], {channels: 1})
	audio2.normalize(2/audio2.sampleRate)
	t.deepEqual(audio2.data()[0], new Float32Array([0, .1, 0, -1]));

	//partial channels
	let audio3 = Audio([0, .1, 0, .2, 0, .3], 3)
	audio3.normalize({channel: [0, 1]})
	t.deepEqual(audio3.data({channel: [0, 1]}), [[0, .5], [0, 1]])

	t.end();
})

t('fade', t => {
	let audio = Audio(Array(100).fill(1), {channels: 1})

	let inCurve = Array(10).fill(1).map((v, i) => (i + .5)/10).map(v => db.toGain(v*40 - 40))
	let outCurve = inCurve.slice().reverse()

	//fade in
	audio.fade(10/audio.sampleRate)
	t.deepEqual(audio.data(0, 10/audio.sampleRate)[0], new Float32Array(inCurve))

	//fade out
	audio.fade(-10/audio.sampleRate)
	t.deepEqual(audio.data(-10/44100)[0], new Float32Array(outCurve))

	t.end();
})

t.only('trim', t => {
	let audio = new Audio([0,0,0,.1,.2,-.1,-.2,0,0], 1).trim()

	t.deepEqual(audio.data({channel: 0}), new Float32Array([.1,.2,-.1,-.2]))


	//trim samples from the beginning below -30 db
	audio = Audio([0.0001, 0, .1, .2], 1).trim({threshold: -30, left: true})

	t.deepEqual(audio.data({channel: 0}), new Float32Array([.1, .2]))

	//remove samples below .02 from the end
	audio = Audio([.1, .2, -.1, -.2, 0, .0001], 1).trim({level: .02, left: false})

	t.deepEqual(audio.data()[0], new Float32Array([.1, .2, -.1, -.2]))

	t.end();
})

t('gain', t => {
	let audio = new Audio(Array(44100).fill(1), 1).gain(-20)
	t.deepEqual(audio.buffer.getChannelData(0), Array(44100).fill(.1))
	// <Audio .5, .5, .5, .5, ...>

	t.end()
})

t('reverse', t => {
	let data = Array(1000).fill(1).map((v, i) => (.5 + i)/1000)
	let fixture = data.slice().reverse()

	let audio = new Audio(data, 1)

	audio.reverse()

	t.deepEqual(audio.data()[0], fixture)

	audio.reverse(10/44100, 10/44100)

	t.deepEqual(audio.data(10/44100, 10/44100)[0], data.slice(980, 990))

	t.end()
})


t('invert', t => {
	let data = Array(1000).fill(1).map((v, i) => (.5 + i)/1000)
	let fixture = Array(1000).fill(1).map((v, i) => -(.5 + i)/1000)

	let audio = new Audio(data, 1)

	audio.invert()

	t.deepEqual(audio.data()[0], fixture)

	audio.invert(10/44100, 10/44100)

	t.deepEqual(audio.data(10/44100, 10/44100)[0], data.slice(10, 20))

	t.end()
})
