'use strict'

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
const createOscillator = require('audio-oscillator')


t('through', t => {
	let a = Audio([1, 1])

	a.through(buf => {
		util.fill(buf, 1)
	}, {from: .5, to: 1.5})

	// t.equal(a.get(0, 1), )

	t.end()
})


t.skip('clone instance', t => {
	let audio = Audio();
	Audio(audio)
});


t('options.length')
t('options.channels array')
t('options.channels number')


t('pad', t => {
	t.end()
})

t('clone', t => {
	t.end()
})

t.skip('insert sync', t => {
	let a = new Audio(.1)

	a.insert(a)
	t.equal(a.duration, .2)
	t.notOk(a.buffer.buffers[0].buffers)

	t.end()
})

t.skip('async', t => {

	t.end()
})

t.skip('stream', t => {
	// let a = Audio(MediaInput, a => {

	// })

	t.end()
})

t.skip('sync sequence', t => {
	t.end()
})

t.skip('mixed sequence', t => {
	t.end()
})

t.skip('data', t => {
	let audio = new Audio(1, 2)

	t.deepEqual(audio.data(-100/audio.sampleRate)[0].length, 100)

	t.deepEqual(audio.data({channel: 1}).length, audio.sampleRate)

	let audio3 = Audio([0, .1, 0, .2, 0, .3], 3)
	t.deepEqual(audio3.data(),
		[new Float32Array([0, .1]), new Float32Array([0, .2]), new Float32Array([0, .3])])

	t.end()
})

t.only('normalize', t => {
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

t.skip('fade', t => {
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

t.skip('trim', t => {
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
	let audio = new Audio(new Float32Array(Array(441).fill(1))).gain(-20)

	// t.equal(audio.get({channel: 0})[10], .1)
	t.deepEqual(audio.get({channel: 0}), new Float32Array(Array(441).fill(.1)))

	t.end()
})

t.skip('reverse', t => {
	let data = Array(1000).fill(1).map((v, i) => (.5 + i)/10)
	let fixture = new Float32Array(data.slice().reverse())

	let audio = new Audio(data, 1)

	audio.reverse()

	t.deepEqual(audio.data({channel: 0}), fixture)

	audio.reverse(10/44100, 10/44100)

	t.deepEqual(audio.data(10/44100, 10/44100)[0], new Float32Array(data.slice(980, 990)))

	t.end()
})


t.skip('invert', t => {
	let data = Array(1000).fill(1).map((v, i) => (.5 + i)/1000)
	let fixture = Array(1000).fill(1).map((v, i) => -(.5 + i)/1000)

	let audio = new Audio(data, 1)

	audio.invert()

	t.deepEqual(audio.data()[0], new Float32Array(fixture))

	audio.invert(10/44100, 10/44100)

	t.deepEqual(audio.data(10/44100, 10/44100)[0], new Float32Array(data.slice(10, 20)))

	t.end()
})

t.skip('Write stream', t => {
	let source = createSource(lena);

	let a = Audio();

	a.write(source, (err, a) => {

	});

	t.end()
});

t.skip('End writing', t => {
	let gen = Gen((t) => {
		return Math.sin(t*440*Math.PI*2)
	});
	let through = Through((chunk, done) => {
		setTimeout(() => done(chunk), 200)
	});

	a.write()
	a.end();
});



t.skip('save', t => {
	let a = Audio(lena, (err, a) => {
		a.save('lena.wav', (err, a) => {
			if (!isBrowser) {
				let p = __dirname + path.sep + 'lena.wav'
				t.ok(fs.existsSync(p))
				fs.unlinkSync(p);
			}
			t.end()
		})
	})
})

t.skip('write', t => {
	let audio = Audio([0, .1, .2, .3, .4, .5], 1)

	audio.write(AudioBuffer(1, [1,1]), 2/audio.sampleRate)

	t.deepEqual(audio.data(1/44100,4/44100)[0], [.1,1,1,.4])

	t.end()
})




t.skip('periodic', t => {
	let audio = Audio({length: 8})

	audio.periodic('saw', {from: 2, to: 6, frequency: 44100})

	t.deepEqual(audio.toArray(), [])
})
