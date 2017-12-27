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
let remoteMp3 = 'https://raw.githubusercontent.com/Jam3/silent-mp3-datauri/master/silence.mp3'
let localWav = !isBrowser ? './samples/lena.wav' : './test/samples/lena.wav'
let localMp3 = !isBrowser ? './samples/lena.mp3' : './test/samples/lena.mp3'


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


	let a2 = Audio({duration: 1, channels: 1})
	t.equal(a2.length, 44100)
	t.equal(a2.channels, 1)

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

t('create from multiple arguments', t => {
	let a = Audio.from([
		2,
		Audio(1),
		new AudioBuffer(null, {length: 44100, numberOfChannels: 2})
	])

	t.equal(a.duration, 4)
	t.equal(a.length, 4*44100)
	t.equal(a.channels, 2)

	t.end()
});

t.skip('create by concatenating the arguments', t => {
	let a = Audio.from([0,1], [0,1])

	t.equal(a.length, 4)
})

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

t('create from direct string')

t('create from uint8 array')

t('create from arraybuffer with dtype')

t('create from base64 string')

t('create from base64 string with dtype')

t('create from datauri octet-stream')

t('create from ndarray')

t('create from ndsamples')

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
		t.end()
	})
})








t('load wav', t => {
	Audio.load(localWav).then(audio => {
		t.equal(audio.length, 541184)
		t.equal(audio.channels, 1)
		t.end();
	}, err => {
		t.fail(err)
		t.end()
	})
})

t('load remote', t => {
	Audio.load(remoteMp3, (err, a) => {
		if (err) {
			t.fail(err)
			return t.end()
		}

		t.ok(a)
		t.notEqual(a.duration, 0)
		t.end()
	})
})

t('load callback', t => {
	Audio.load(localMp3, (err, audio) => {
		t.equal(audio.channels, 1)
		t.end();
	}, err => {
		t.fail(err)
		t.end()
	})
})

t('load caching', t => {
	let a

	//put into cache
	Audio.load(localWav).then((audio) => {
		t.ok(audio)
	})

	//load once first item is loaded
	Audio.load(localWav).then((audio) => {
		t.ok(Object.keys(Audio.cache).length)
		t.ok(audio instanceof Audio)
		t.notEqual(audio, a)
	})

	//load already loaded
	.then(audio => {
		return Audio.load(localWav)
	})
	.then(a => {
		t.ok(a instanceof Audio)
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

		let a = Audio.from(list)

		t.equal(~~a.duration, 24)

		t.end()
	}, err => {
		t.fail(err)
		t.end()
	})
})

t('load multiple mixed', t => {
	Audio.load(localWav).then(a => {
		return Audio.load([a, Audio.load(remoteMp3), localWav, Audio(2), util.create(44100)])
	})
	.then(list => {
		let audio = Audio.from(list)
		t.equal(~~audio.duration, 24 + 2 + 1)
		t.end()
	}, err => {
		t.fail(err)
		t.end()
	})
})

t('load multiple error', t => {
	Audio.load([localMp3, 'xxx']).then(list => {
		t.fail()
		t.end()
	}, err => {
		t.ok(err)
		t.end()
	})
})

t.skip('fallback to decode')




t('decode base64', t => {
	Audio.decode(require('audio-lena/mp3-base64')).then(audio => {
		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	}, err => {
		t.fail(err)
		t.end()
	})
})

t('decode mp3', t => {
	Audio.decode(require('audio-lena/mp3')).then(audio => {
		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	}, err => {
		t.fail(err)
		t.end()
	})
})
t('decode wav', t => {
	Audio.decode(require('audio-lena/wav')).then(audio => {
		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	}, err => {
		t.fail(err)
		t.end()
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
		t.end()
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
		t.end()
	})
})

isBrowser && t('decode Blob', t => {
	let mp3 = require('audio-lena/mp3')
	Audio.decode(new Blob([mp3]), (err, audio) => {
		if (err) {
			t.fail(err)
			t.end()
		}

		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
		t.end()
	})
})

t('decode Buffer', t => {
	let mp3 = Buffer.from(require('audio-lena/mp3'))

	t.plan(3)

	Audio.decode(mp3, (err, audio) => {
		if (err) {
			t.fail(err)
			t.end()
		}

		t.equal(~~audio.duration, 12)
		t.equal(audio.channels, 1)
	})

	t.ok('async')
})
t.skip('decode TypedArray', t => {
	let arr = new Float32Array(require('audio-lena/raw'))

	t.plan(3)

	Audio.decode(arr, (err, audio) => {
		if (err) {
			t.fail(err)
			t.end()
		}

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
	}, err => {
		t.fail(err)
		t.end()
	})
})

t('error decoding (bad argument)', t => {
	Audio.decode('xxxx', (err, audio) => {
		if (!err) {
			t.fail('No error raised')
		}
		t.ok(err)
	})

	Audio.decode([require('audio-lena/mp3'), 'xxxx'], (err, audio) => {
		if (!err) {
			t.fail('No error raised')
		}
		t.ok(err)
		t.end()
	})
})

t('error decoding format')

t.only('properly detect numeric array vs items array', t => {
	let num, mul, ch, err

	// num = new Audio([0])
	// t.equal(num.length, 1)
	// t.equal(num.channels, 1)

	// num = new Audio([1])
	// t.equal(num.length, 1)
	// t.equal(num.channels, 1)

	// num = new Audio([-1])
	// t.equal(num.length, 1)
	// t.equal(num.channels, 1)

	// num = new Audio([0, 1])
	// t.equal(num.length, 2)
	// t.equal(num.channels, 1)

	// num = new Audio([-1, 1])
	// t.equal(num.length, 2)
	// t.equal(num.channels, 1)

	// num = new Audio([1, 1, 1])
	// t.equal(num.length, 3)
	// t.equal(num.channels, 1)

	// num = new Audio([1, 1])
	// t.equal(num.length, 2)
	// t.equal(num.channels, 1)

	mul = Audio.from([1, Audio(0), 1])
	t.equal(mul.length, 44100*2)
	t.equal(mul.channels, 1)

	// mul = Audio.from([Audio(0)])
	// t.equal(mul.length, 0)
	// t.equal(mul.channels, 1)

	// ch = new Audio([[0, 1], [0, 1]])
	// t.equal(ch.length, 2)
	// t.equal(ch.channels, 2)

	// ch = new Audio([new Float32Array([0, 1]), new Float32Array([0, 1])])
	// t.equal(ch.length, 2)
	// t.equal(ch.channels, 2)

	// mul = Audio.from([1, new Float32Array([0, 1]), new Float32Array([0, 1])], {channels: 2})
	// t.equal(mul.length, 44102)
	// t.equal(mul.channels, 2)


	// err = new Audio([1, 1, Audio(0)])
	// t.notOk(err.getChannelData(0)[3])

	// err = new Audio([-1, 1, Audio(0)])
	// t.notOk(err.getChannelData(0)[3])

	// t.throws(() => {
	// 	err = new Audio([-1, Audio(0)])
	// })

	// t.throws(() => {
	// 	err = new Audio([Audio(0), -1])
	// })

	// mul = Audio.from([Audio(0), 1])
	// t.equal(mul.length, 44100)
	// t.equal(mul.channels, 1)

	t.end()
})
