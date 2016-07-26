var test = require('tape');
var Audio = require('..');

test('slicing audio', function(t) {
  var foo = new Audio({
    source: new Buffer([1, 2, 3, 4, 5, 6, 7, 8]),
    channels: 1
  });

  // Both provided
  t.same(
    foo.slice(0, 2).source,
    new Buffer([1, 2, 3, 4]),
    'slice start and end'
  );

  // Start provided
  t.same(
    foo.slice(2).source,
    new Buffer([5, 6, 7, 8]),
    'slice start to dynamnic end'
  );

  // None provided (replicate)
  t.same(
    foo.slice().source,
    new Buffer([1, 2, 3, 4, 5, 6, 7, 8]),
    'slice replicate (start 0 to dynamic end)'
  );

  t.end();
});
