const Audio = require('../')
const t = require('tape')

function f32(x) {
	return new Float32Array([x])[0]
}

t('limits', t => {
	let min, max, a


	a = Audio([-0, 0, .5, -.3])

	;[min, max] = a.limits()

	t.equal(min, f32(-.3))
	t.equal(max, f32(.5))


	a = Audio([-.1, .1, -.2, .3], {channels: 2, format: 'interleaved'})
	;[min, max] = a.limits()
	t.equal(min, f32(-.2))
	t.equal(max, f32(.3))

	;[min, max] = a.limits({channel: 0})
	t.equal(min, f32(-.2))
	t.equal(max, f32(-.1))

	;[min, max] = a.limits({channel: 1})
	t.equal(min, f32(.1))
	t.equal(max, f32(.3))


	a = Audio([.1, .2, .3, .4])
	;[min, max] = a.limits(1/a.sampleRate, 2/a.sampleRate)
	t.equal(min, f32(.2))
	t.equal(max, f32(.3))

	t.end()
})

t.skip('loudness', t => {
	let a = Audio([0, .5, 1, .5, 0])

	let l = a.loudness()

	console.log(l)

	t.end()
})
