const Audio = require('../')
const t = require('tape')
const AudioBuffer = require('audio-buffer')
const db = require('decibels')
const lena = require('audio-lena')
const isBrowser = require('is-browser')
const path = require('path')
const fs = require('fs')
const AudioBufferList = require('audio-buffer-list')
const util = require('audio-buffer-utils')



t('create empty instance', t => {
	let a = Audio();

	t.equal(a.length, 0);
	t.equal(a.duration, 0);
	t.equal(a.channels, 1);
	t.equal(a.sampleRate, 44100);

	t.end();
});

t('create duration', t => {
	let a = Audio(2);

	t.equal(a.length, 2*44100);
	t.equal(a.duration, 2);
	t.equal(a.channels, 1);

	t.end();
});

t('create duration with channels', t => {
	let a = Audio(4, 3)

	t.equal(a.length, 4*44100);
	t.equal(a.duration, 4);
	t.equal(a.channels, 3);

	t.end()
})

t('create length from options', t => {
	let a = Audio({length: 1024, channels: 3})

	t.equal(a.length, 1024)
	t.equal(a.channels, 3)

	t.end()
})

t('create duration from options', t => {
	let a = Audio({duration: 1, channels: 3, rate: 70000})

	t.equal(a.length, 70000)
	t.equal(a.sampleRate, 70000)
	t.equal(a.duration, 1)
	t.equal(a.channels, 3)

	t.end()
})

t('create multiple instances', t => {
	let a = Audio([
		2,
		Audio(1),
		new AudioBuffer(null, {length: 44100, numberOfChannels: 2})
	])

	t.equal(a.duration, 4)
	t.equal(a.length, 4*44100)
	t.equal(a.channels, 2)

	t.end()
});

t('create from audio buffer', t => {
	let a = Audio(util.create([0,.1,.2,.3,.4,.5], 3, 48000))

	t.equal(a.length, 2)
	t.equal(a.channels, 3)
	t.equal(a.sampleRate, 48000)

	t.end()
})

t('create from audio buffer list', t => {
	let src = new AudioBufferList(2).repeat(2)

	let a = Audio(src)

	t.equal(a.length, 4)
	t.equal(a.channels, 1)
	t.equal(a.sampleRate, 44100)

	t.end()
})

t('create from raw array', t => {
	let src = new Audio(new Float32Array([0, .5]))

	t.equal(src.channels, 1)
	t.equal(src.length, 2)
	t.equal(src.duration, 2/src.sampleRate)

	t.end();
});

t('create from channels data', t => {
	let src = Audio([new Float32Array([0,0,0]), [1,1,1], [2,2,2]])

	t.equal(src.length, 3)
	t.equal(src.channels, 3)
	t.equal(src.sampleRate, 44100)

	t.end()
})

t.skip('create from buffer', t => {
	Promise.all([
	// Audio(lena.wav).then(a => {
	// 	t.ok(a)
	// 	t.equal(Math.floor(a.duration), 12)
	// }),

	// Audio(lena.mp3).then(a => {
	// 	t.ok(a)
	// 	t.equal(Math.floor(a.duration), 12)
	// }),

	Audio(lena.raw).then(a => {
		t.ok(a)
		t.equal(Math.floor(a.duration), 12)
	})
	]).then(a => {
		t.end()
	}, err => {
		t.fail(err)
	})
})

