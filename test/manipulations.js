const Audio = require('../');
const t = require('tape');
const assert = require('assert')

t('Normalize', t => {
	//full normalize
	let audio = Audio([0, .1, 0, -.1], {channels: 1})

	audio.normalize()
	assert.deepEqual(audio.read().getChannelData(0), [0, 1, 0, -1]);


	//partial normalize
	let audio2 = Audio([0, .1, 0, -.1], {channels: 1})
	audio2.normalize(2/audio2.sampleRate)
	assert.deepEqual(audio2.read().getChannelData(0), [0, .1, 0, -1]);

	t.end();
})

t('Fade', t => {
	let audio = Audio(Array(1000).fill(1), {channels: 1})

	let inCurve = Array(100).fill(1).map((v, i) => (i + .5)/100)
	let outCurve = inCurve.slice().reverse()

	//fade in
	audio.fade(0, 100/audio.sampleRate)
	assert.deepEqual(audio.readRaw(0, 100).getChannelData(0), inCurve)

	//fade out
	audio.fade(0, -100/audio.sampleRate)
	assert.deepEqual(audio.readRaw(-100).getChannelData(0), outCurve)

	t.end();
})