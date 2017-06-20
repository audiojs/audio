const Audio = require('../')
const t = require('tape')
const isBrowser = require('is-browser')
const path = require('path')
const fs = require('fs')


t('decode base64', t => {
	Audio.decode(require('audio-lena/mp3-base64')).then(audio => {
		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	}, err => {
		t.fail(err)
	})
})

t('decode mp3', t => {
	Audio.decode(require('audio-lena/mp3')).then(audio => {
		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	}, err => {
		t.fail(err)
	})
})
t('decode wav', t => {
	Audio.decode(require('audio-lena/wav')).then(audio => {
		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	}, err => {
		t.fail(err)
	})
})

t.skip('decode ogg', t => {
	require('vorbis.js')
	Audio.decode(require('audio-lena/ogg')).then(audio => {
		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	}, err => {
		t.fail(err)
	})
})

t('decode flac', t => {
	require('flac.js')
	Audio.decode(require('audio-lena/flac')).then(audio => {
		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	}, err => {
		t.fail(err)
	})
})

isBrowser && t('decode Blob', t => {
	let mp3 = require('audio-lena/mp3')
	Audio.decode(new Blob([mp3]), (err, audio) => {
		if (err) t.fail(err)

		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	})
})

t('decode Buffer', t => {
	let mp3 = Buffer.from(require('audio-lena/mp3'))

	t.plan(3)

	Audio.decode(mp3, (err, audio) => {
		if (err) t.fail(err)

		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
	})

	t.ok('async')
})
t.skip('decode TypedArray', t => {
	let arr = new Float32Array(require('audio-lena/raw'))

	t.plan(3)

	Audio.decode(arr, (err, audio) => {
		if (err) t.fail(err)

		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
	})

	t.ok('async')
})

t('decode multiple items', t => {
	require('flac.js')
	Audio.decode([require('audio-lena/mp3'), require('audio-lena/wav-base64'), require('audio-lena/flac-datauri')]).then(list => {
		t.equal(list.length, 3)
		t.equal(~~list[0].duration, 12)
		t.equal(~~list[1].duration, 12)
		t.equal(~~list[2].duration, 12)
		t.end()
	}, err => t.fail(err))
})

t('error decoding (bad argument)', t => {
	Audio.decode('xxxx', (err, audio) => {
		if (!err) t.fail('No error raised')
		t.ok(err)
	})

	Audio.decode([require('audio-lena/mp3'), 'xxxx'], (err, audio) => {
		if (!err) t.fail('No error raised')
		t.ok(err)
		t.end()
	})
})

t('error decoding format')

