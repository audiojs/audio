;; blocks(x, y, m, bs, cuts, p, o): fn/block.js's pass over m blocks of bs float32 samples of two channels at x and y
;; (byte offsets), each float64x2 lane a channel. Of each block: the least and the greatest sample, their sum, the sum
;; of their squares, how many squares reach full scale, the sum of the channels' products, and the sum of the squares
;; of the K-weighted samples over [0, c1), [c1, c2) and [c2, bs), c1 and c2 the block's two int32 at `cuts`, the
;; filter's state carried from block to block, in and out. The same float64 ops, in the same order, as levels() and
;; @audio/weighting-k's ms() in JS: the same bits. The kernel runs at the filter's latency (13 dependent float ops a
;; sample); the rest runs in its shadow.
;; p: f64 b0 b1 b2 a1 a2 (shelf) e0 e1 e2 f1 f2 (highpass) at 0, full scale squared at 80; f64x2 state z1 z2 w1 w2 at
;; 96. Out, 144 bytes a block from o: f64x2 min max sum squares clipped K-sums×3, then f64 products.
;; wat2wasm fn/block.wat -o - | node -e "process.stdin.on('data', b => console.log([...b].join(',')))"
(module
  (memory (export "memory") 1)
  (func (export "blocks") (param $x i32) (param $y i32) (param $m i32) (param $bs i32) (param $cuts i32) (param $p i32) (param $o i32)
    (local $x0 i32) (local $e i32) (local $g i32) (local $b i32)
    (local $v v128) (local $v2 v128) (local $t v128) (local $u v128) (local $qk v128)
    (local $mn v128) (local $mx v128) (local $s v128) (local $q v128) (local $k v128) (local $f v128) (local $one v128)
    (local $xy f64)
    (local $z1 v128) (local $z2 v128) (local $w1 v128) (local $w2 v128)
    (local $b0 v128) (local $b1 v128) (local $b2 v128) (local $a1 v128) (local $a2 v128)
    (local $e0 v128) (local $e1 v128) (local $e2 v128) (local $f1 v128) (local $f2 v128)
    (local.set $b0 (v128.load64_splat (local.get $p)))
    (local.set $b1 (v128.load64_splat offset=8 (local.get $p)))
    (local.set $b2 (v128.load64_splat offset=16 (local.get $p)))
    (local.set $a1 (v128.load64_splat offset=24 (local.get $p)))
    (local.set $a2 (v128.load64_splat offset=32 (local.get $p)))
    (local.set $e0 (v128.load64_splat offset=40 (local.get $p)))
    (local.set $e1 (v128.load64_splat offset=48 (local.get $p)))
    (local.set $e2 (v128.load64_splat offset=56 (local.get $p)))
    (local.set $f1 (v128.load64_splat offset=64 (local.get $p)))
    (local.set $f2 (v128.load64_splat offset=72 (local.get $p)))
    (local.set $f (v128.load64_splat offset=80 (local.get $p)))
    (local.set $z1 (v128.load offset=96 (local.get $p)))
    (local.set $z2 (v128.load offset=112 (local.get $p)))
    (local.set $w1 (v128.load offset=128 (local.get $p)))
    (local.set $w2 (v128.load offset=144 (local.get $p)))
    (local.set $one (v128.const f64x2 1 1))
    (local.set $y (i32.sub (local.get $y) (local.get $x)))
    (block $end
      (br_if $end (i32.eqz (local.get $m)))
      (loop $blocks
        (local.set $x0 (local.get $x))
        (local.set $mn (v128.const f64x2 inf inf))
        (local.set $mx (v128.const f64x2 -inf -inf))
        (local.set $s (v128.const f64x2 0 0))
        (local.set $q (v128.const f64x2 0 0))
        (local.set $k (v128.const f64x2 0 0))
        (local.set $xy (f64.const 0))
        (local.set $g (i32.const 0))
        ;; three parts, the K sum anew in each
        (loop $parts
          (local.set $e (i32.add (local.get $x0) (i32.shl
            (select (i32.load (local.get $cuts)) (select (i32.load offset=4 (local.get $cuts)) (local.get $bs) (i32.eq (local.get $g) (i32.const 1))) (i32.eqz (local.get $g)))
            (i32.const 2))))
          (local.set $qk (v128.const f64x2 0 0))
          (block $done
            (br_if $done (i32.ge_u (local.get $x) (local.get $e)))
            (loop $l
              ;; [x[i], y[i]] as float64, exact
              (local.set $v (f64x2.promote_low_f32x4
                (v128.load32_lane 1 (i32.add (local.get $x) (local.get $y)) (v128.load32_zero (local.get $x)))))
              (local.set $v2 (f64x2.mul (local.get $v) (local.get $v)))
              ;; pmin(a, b) = b < a ? b : a: `if (v < mn) mn = v`, a NaN passed over as there
              (local.set $mn (f64x2.pmin (local.get $mn) (local.get $v)))
              (local.set $mx (f64x2.pmax (local.get $mx) (local.get $v)))
              (local.set $s (f64x2.add (local.get $s) (local.get $v)))
              (local.set $q (f64x2.add (local.get $q) (local.get $v2)))
              ;; one where the lane clips (its mask all ones), none elsewhere
              (local.set $k (f64x2.add (local.get $k) (v128.and (f64x2.ge (local.get $v2) (local.get $f)) (local.get $one))))
              (local.set $xy (f64.add (local.get $xy) (f64x2.extract_lane 0
                (f64x2.mul (local.get $v) (i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7 (local.get $v) (local.get $v))))))
              ;; the shelf, then the highpass, transposed direct form II: y = b0 v + z1, z1 = b1 v - a1 y + z2, z2 = b2 v - a2 y
              (local.set $t (f64x2.add (f64x2.mul (local.get $b0) (local.get $v)) (local.get $z1)))
              (local.set $z1 (f64x2.add (f64x2.sub (f64x2.mul (local.get $b1) (local.get $v)) (f64x2.mul (local.get $a1) (local.get $t))) (local.get $z2)))
              (local.set $z2 (f64x2.sub (f64x2.mul (local.get $b2) (local.get $v)) (f64x2.mul (local.get $a2) (local.get $t))))
              (local.set $u (f64x2.add (f64x2.mul (local.get $e0) (local.get $t)) (local.get $w1)))
              (local.set $w1 (f64x2.add (f64x2.sub (f64x2.mul (local.get $e1) (local.get $t)) (f64x2.mul (local.get $f1) (local.get $u))) (local.get $w2)))
              (local.set $w2 (f64x2.sub (f64x2.mul (local.get $e2) (local.get $t)) (f64x2.mul (local.get $f2) (local.get $u))))
              (local.set $qk (f64x2.add (local.get $qk) (f64x2.mul (local.get $u) (local.get $u))))
              (local.set $x (i32.add (local.get $x) (i32.const 4)))
              (br_if $l (i32.lt_u (local.get $x) (local.get $e)))))
          (v128.store offset=80 (i32.add (local.get $o) (i32.shl (local.get $g) (i32.const 4))) (local.get $qk))
          (local.set $g (i32.add (local.get $g) (i32.const 1)))
          (br_if $parts (i32.lt_u (local.get $g) (i32.const 3))))
        (v128.store (local.get $o) (local.get $mn))
        (v128.store offset=16 (local.get $o) (local.get $mx))
        (v128.store offset=32 (local.get $o) (local.get $s))
        (v128.store offset=48 (local.get $o) (local.get $q))
        (v128.store offset=64 (local.get $o) (local.get $k))
        (f64.store offset=128 (local.get $o) (local.get $xy))
        (local.set $o (i32.add (local.get $o) (i32.const 144)))
        (local.set $cuts (i32.add (local.get $cuts) (i32.const 8)))
        (local.set $b (i32.add (local.get $b) (i32.const 1)))
        (br_if $blocks (i32.lt_u (local.get $b) (local.get $m)))))
    (v128.store offset=96 (local.get $p) (local.get $z1))
    (v128.store offset=112 (local.get $p) (local.get $z2))
    (v128.store offset=128 (local.get $p) (local.get $w1))
    (v128.store offset=144 (local.get $p) (local.get $w2))))
