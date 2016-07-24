var test = require('tape');
var Audio = require('..');

test('reading audio', function(t) {
  // Mono
  var mono = new Audio({
    source: new Buffer([0, 50, 100, 50]),
    bitDepth: 8,
    channels: 1
  });
  t.is(mono.read(0), 0, 'mono first block');
  t.is(mono.read(1), 50, 'mono second block');

  // Stereo
  var stereo = new Audio({
    source: new Buffer([0, 50, 100, 50]),
    bitDepth: 8,
    channels: 2
  });
  t.is(stereo.read(0, 1), 0, 'stereo left');
  t.is(stereo.read(1, 2), 50, 'stereo right');

  // 4 channels
  var four = new Audio({
    source: new Buffer([0, 50, 100, 50, 0, 50, 100, 50]),
    bitDepth: 8,
    channels: 4
  });
  t.is(four.read(0, 1), 0, 'four first channel');
  t.is(four.read(1, 2), 50, 'four second channel');
  t.is(four.read(0, 3), 100, 'four third channel');
  t.is(four.read(1, 4), 50, 'four fourth channel');

  // Stereo 16-bit
  var st = new Audio({
    source: new Buffer([0, 50, 100, 50, 0, 50, 100, 50]),
    bitDepth: 16,
    channels: 2
  });
  t.is(st.read(0, 1), 12800, 'stereo 16-bit left');
  t.is(st.read(0, 2), 12900, 'stereo 16-bit right');

  t.end();
});
