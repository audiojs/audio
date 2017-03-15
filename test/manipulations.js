const Audio = require('../');
const t = require('tape');
const assert = require('assert')

t.test('Normalize', t => {
	//full normalize
	let audio = Audio([0, .1, 0, -.1], {channels: 1})

	audio.normalize()
	assert.deepEqual(audio.read().getChannelData(0), [0, 1, 0, -1]);


	//partial normalize
	let audio2 = Audio([0, .1, 0, -.1], {channels: 1})
	audio2.normalize(2/audio2.sampleRate)
	assert.deepEqual(audio2.read().getChannelData(0), [0, .1, 0, -1]);

	t.end();
});
