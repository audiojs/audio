var test = require('tape');
var Audio = require('..');

test('writing audio', function(t) {
  var foo = new Audio([12, 4, 9], {
    length: 6
  });
  foo.write([-2, 4, 10], 3);
  t.same(foo, new Audio([12, 4, 9, -2, 4, 10]));
  t.end();
});
