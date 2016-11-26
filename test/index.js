const Audio = require('../');
const lena = require('audio-lena');
const t = require('tape');
const createSource = require('audio-source')
const Gen = require('audio-generator')


//dictaphone cases
t.test('Create empty instance', t => {
	let a = Audio();

	assert.equal(a.length, 0);
	assert.equal(a.duration, 0);
	assert.equal(a.channels, 2);
	assert.equal(a.sampleRate, 44100);

	t.end();
});

t.test('Write stream', t => {
	let source = createSource(lena);

	let a = Audio();

	a.write(source, (err, a) => {

	});
});

t.test('End writing', t => {
	let gen = Gen((t) => {
		return Math.sin(t*440*Math.PI*2)
	});
	let through = Through((chunk, done) => {
		setTimeout(() => done(chunk), 200)
	});

	a.write()
	a.end();
});


// t.test('create from buffer', t => {
// 	Audio(lena).volume(.5).play(() => {
// 		console.log('end');
// 		t.end();
// 	});
// });

// t.test('create from audio buffer', t => {

// 	t.end();
// });

// t.test('create from array', t => {
// 	t.end();

// });

// t.test('load', t => {
// 	Audio('./lena.wav')

// 	t.end();
// });
