const Audio = require('../');
const lena = require('audio-lena');
const t = require('tape');
const createSource = require('audio-source')
const Gen = require('audio-generator')


//dictaphone cases
t('Create empty instance', t => {
	let a = Audio();

	assert.equal(a.length, 0);
	assert.equal(a.duration, 0);
	assert.equal(a.channels, 2);
	assert.equal(a.sampleRate, 44100);

	t.end();
});

t('Write stream', t => {
	let source = createSource(lena);

	let a = Audio();

	a.write(source, (err, a) => {

	});
});

t('End writing', t => {
	let gen = Gen((t) => {
		return Math.sin(t*440*Math.PI*2)
	});
	let through = Through((chunk, done) => {
		setTimeout(() => done(chunk), 200)
	});

	a.write()
	a.end();
});




t('Caching resource', t => {
	let a = Audio('./chopin.mp3').on('load', (audio) => {
	})

	let b = Audio('./chopin.mp3').on('load', (audio) => {
	})

	assert.equal(Object.keys(Audio.cache).length === 1)
});


t('Download', t => {
	t.end()
})


// t('create from buffer', t => {
// 	Audio(lena).volume(.5).play(() => {
// 		console.log('end');
// 		t.end();
// 	});
// });

// t('create from audio buffer', t => {

// 	t.end();
// });

// t('create from array', t => {
// 	t.end();

// });

// t('load', t => {
// 	Audio('./lena.wav')

// 	t.end();
// });

// t('clone instance', t => {
// let audio = Audio();
// Audio(audio)
// });
