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


//sources
let remoteMp3 = 'https://raw.githubusercontent.com/audiojs/audio/master/test/samples/lena.mp3'
let remoteWav = 'https://raw.githubusercontent.com/audiojs/audio/master/test/samples/lena.wav'
let localWav = !isBrowser ? './samples/lena.wav' : './test/samples/lena.wav'
let localMp3 = !isBrowser ? './samples/lena.mp3' : './test/samples/lena.mp3'



t('load wav', t => {
	Audio.load(localWav).then(audio => {
		t.equal(audio.length, 541184)
		t.equal(audio.channels, 1)
		t.end();
	}, err => {
		t.fail(err)
	})
})

t('load remote', t => {
	Audio.load(remoteMp3, (err, a) => {
		if (err) return t.fail(err)

		t.ok(a)
		t.equal(~~a.duration, 12)
		t.end()
	})
})

t('load callback', t => {
	Audio.load(localMp3, (err, audio) => {
		t.equal(audio.channels, 1)
		t.end();
	}, err => {
		t.fail(err)
	})
})

t('load caching', t => {
	let a

	//put into cache
	Audio.load(localWav).then((audio) => {
		t.ok(audio)
		a = audio
	})

	//load once first item is loaded
	Audio.load(localWav).then((audio) => {
		t.ok(Object.keys(Audio.cache).length)
		t.ok(Audio.isAudio(audio))
		t.notEqual(audio, a)
	})

	//load already loaded
	.then(audio => {
		return Audio.load(localWav)
	})
	.then(a => {
		t.ok(Audio.isAudio(a))
		t.end()
	})
})

t('load error', t => {
	t.plan(6)

	Audio.load('nonexistent', (err, audio) => {
		t.ok(err)
	})

	Audio.load('./', (err, audio) => {
		t.ok(err)
	})

	Audio.load('../', (err, audio) => {
		t.ok(err)
	})

	Audio.load('/', (err, audio) => {
		t.ok(err)
	})

	Audio.load('https://some-almost-real-url.com/file.mp3', (err, audio) => {
		t.ok(err)
	})

	Audio.load('*').then(ok => {}, err => {
		t.ok(err)
	})
})

t('load multiple sources', t => {
	Audio.load([localMp3, remoteMp3, localWav]).then(list => {
		t.equal(list.length, 3)

		let a = Audio(list)

		t.equal(~~a.duration, 36)

		t.end()
	}, err => {
		t.fail(err)
	})
})

t('load multiple mixed', t => {
	Audio.load(localWav).then(a => {
		return Audio.load([a, Audio.load(remoteMp3), localWav, Audio(2), util.create(44100)])
	})
	.then(list => {
		let audio = Audio(list)
		t.equal(~~audio.duration, 36 + 2 + 1)
		t.end()
	}, err => {
		t.fail(err)
	})
})

t('load multiple error', t => {
	Audio.load([localMp3, 'xxx']).then(list => {
		t.fail()
	}, err => {
		t.ok(err)
		t.end()
	})
})

t('fallback to decode')
