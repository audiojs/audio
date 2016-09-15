const Audio = require('../');
const lena = require('audio-lena');
const t = require('tape');

t.test('create from buffer', t => {
	Audio(lena).volume(.5).play(() => {
		console.log('end');
		t.end();
	});
});

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
