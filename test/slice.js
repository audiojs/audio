var test = require('tape');
var Audio = require('..');

test('slicing audio', function(t) {
  // Slicing pulses with fixed points
  var bar = new Audio([1, 4, 0, 2, 3]);
  var foo = bar.slice(2, 4);
  t.same(
    foo,
    [0, 2],
    'slicing fixed pulse points'
  );

  // Slicing pulses with no end
  var baz = new Audio([0, 0, 2, 0, 3]);
  var qux = baz.slice(1);
  t.same(
    qux,
    [0, 2, 0, 3],
    'slicing no end pulse points'
  );

  // Slicing buffer
  var zuq = new Audio(new Buffer([0, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  var qaz = zuq.slice(2, 4, true);
  t.same(
    qaz,
    new Buffer([5, 6, 7, 8]),
    'slicing buffer'
  );

  t.end();
});
