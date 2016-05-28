var test = require('tape');
var Audio = require('..');

test('writing audio', function(t) {
  var foo = new Audio([12, 4, 9, -2, 4, 10]);
  t.is(foo.read(3), -2);
  t.end();
});
