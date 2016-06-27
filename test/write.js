var test = require('tape');
var Audio = require('..');

test('writing audio', function(t) {
  // Writing pulses
  var bar = new Audio([0, 0, 0, 0, 3]);
  bar.write([1, 2], 2);
  t.same(
    bar.sample,
    new Buffer([0, 0, 0, 0, 1, 0, 2, 0, 3, 0]),
    'writing pulses'
  );

  // Writing buffers
  var foo = new Audio(new Buffer(10).fill(0));
  foo.write(new Buffer([1, 2, 3, 4]), 2);
  t.same(
    foo.sample,
    new Buffer([0, 0, 0, 0, 1, 2, 3, 4, 0, 0]),
    'writing buffers'
  );

  // Writing unorthodox values.
  var baz = new Audio({bitDepth: 8, length: 2});
  baz.write([255, -255], 0, true);
  t.same(baz.sample, new Buffer([127, -128]), 'writing unorthodox values');

  // Writing single pulse values.
  var qux = new Audio([0, 0, 0, 0, 3], {bitDepth: 8});
  qux.write(1, 0);
  qux.write(3, 1);
  qux.write(10, 3);
  t.same(
    qux.sample,
    new Buffer([1, 3, 0, 10, 3]),
    'writing single pulses'
  );

  t.end();
});
