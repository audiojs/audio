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


let remoteMp3 = 'https://github.com/audiojs/audio/raw/master/test/samples/lena.mp3'
let remoteWav = 'https://github.com/audiojs/audio/raw/master/test/samples/lena.wav'
let localWav = './samples/lena.wav'
let localMp3 = './samples/lena.mp3'


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
	t.plan(5)

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

t.only('load multiple mixed', t => {
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

t.skip('normalize', t => {
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

t.skip('gain', t => {
	let audio = new Audio(Array(44100).fill(1), 1).gain(-20)

	t.deepEqual(audio.data({channel: 0}), new Float32Array(Array(44100).fill(.1)))
	// <Audio .5, .5, .5, .5, ...>

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
