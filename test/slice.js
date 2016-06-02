var test = require('tape');
var Audio = require('..');

test('slicing audio', function(t) {
  var foo = new Audio([12, 4, 9, -2, 4, 10]);

  t.same(foo.slice(3, 5), [-2, 4]);
  t.same(foo.slice(3), [-2, 4, 10]);

  t.end();
});
