var test = require('tape');
var Audio = require('..');

test('initializing audio', function(t) {
  // Static defaults
  var foo = new Audio();
  t.is(foo.sampleRate, 44100, 'default sample rate');
  t.is(foo.bitDepth, 16, 'default bit depth');
  t.is(foo.channels, 2, 'default channels amount');
  t.is(foo.byteOrder, 'LE', 'default byte order');

  // Dynamic signed defaults + custom
  var bar = new Audio({bitDepth: 16});
  var baz = new Audio({bitDepth: 8});
  var xuq = new Audio({bitDepth: 8, signed: false});
  t.is(bar.signed, false, 'unsigned with bit-depth more than 8');
  t.is(baz.signed, true, 'signed with bit-depth of 8');
  t.is(xuq.signed, false, 'unsigned with bit-depth of 8 from custom option');

  // Dynamic max defaults + custom
  var qux = new Audio({bitDepth: 16});
  var oof = new Audio({bitDepth: 16, signed: true});
  var rab = new Audio({bitDepth: 8, signed: false});
  var qof = new Audio({bitDepth: 8});
  var zab = new Audio({max: 500});
  t.is(qux.max, 65535, 'max 16-bit unsigned');
  t.is(oof.max, 32767, 'max 16-bit signed');
  t.is(rab.max, 255, 'max 8-bit unsigned');
  t.is(qof.max, 127, 'max 8-bit signed');
  t.is(zab.max, 500, 'max from custom option');

  // Dynamic min defaults + custom
  var zaf = new Audio({min: -500});
  t.is(qux.min, 0, 'min 16-bit unsigned');
  t.is(oof.min, -32768, 'min 16-bit signed');
  t.is(rab.min, 0, 'min 8-bit unsigned');
  t.is(qof.min, -128, 'min 8-bit signed');
  t.is(zaf.min, -500, 'min from custom option');

  // Dynamic length defaults + custom
  var faz = new Audio(new Buffer(100).fill(0));
  var fux = new Audio([1, 2, 3, 4]);
  var fox = new Audio([1, 2, 3, 4], {bitDepth: 8});
  var fax = new Audio({length: 150});
  t.is(faz.length, 100, 'length from buffer');
  t.is(fux.length, 8, 'length from 16-bit pulses');
  t.is(fox.length, 4, 'length from 8-bit pulses');
  t.is(fax.length, 150, 'length from custom option');

  t.end();
});
