const Audio = require('../')
const t = require('tape')

function f32(x) {
	return new Float32Array([x])[0]
}

t('range', t => {
	let min, max, a

	a = Audio([-0, 0, .5, -.3])

	;[min, max] = a.range()

	t.equal(min, f32(-.3))
	t.equal(max, f32(.5))

	a = Audio([-.1, .1, -.2, .3], {channels: 2, format: 'interleaved'})
	;[min, max] = a.range()
	t.equal(min, f32(-.2))
	t.equal(max, f32(.3))

	;[min, max] = a.range({channel: 0})
	t.equal(min, f32(-.2))
	t.equal(max, f32(-.1))

	;[min, max] = a.range({channel: 1})
	t.equal(min, f32(.1))
	t.equal(max, f32(.3))

	t.end()
})
