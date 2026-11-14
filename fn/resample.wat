;; sincInterp's dot products (fn/resample.js; wat2wasm resample.wat): outputs i0..i1 of a block, i1 − i0 ≥ 4.
;; Output i sits at source position pos = (rev ? n − 1 − i : i)·r + phase: base = ⌊pos⌋, f = (pos − base)·P, p = ⌊f⌋,
;; mu = f − p. Its taps x[base + 1 − half + j], j < taps, weigh by rows p and p + 1 of the table t (P + 1 rows of
;; `taps` float64, their sums in w): a = Σ t[p][j]·x, b = Σ t[p + 1][j]·x, w' = w[p] + mu·(w[p + 1] − w[p]), and
;; y = w' ≠ 0 ? (a + mu·(b − a)) / w' : 0, stored as float32. Each sum is the JS loop's: the even taps in lane 0 and
;; the odd in lane 1 of a float64x2 (its a0, a1 and b0, b1), the same products added in the same order, so the same
;; bits. Four outputs a pass, their sums apart, so one's additions need not wait on another's; the last pass takes the
;; last four, those already done again, alike.
(module
  (memory (export "memory") 1)
  ;; x: float32 source; y: float32 outputs, output i at y + 4·i; t, w: the bank's float64 rows and sums
  (func (export "sinc") (param $x i32) (param $y i32) (param $t i32) (param $w i32)
    (param $n i32) (param $i0 i32) (param $i1 i32) (param $rev i32)
    (param $r f64) (param $phase f64) (param $P f64) (param $half i32) (param $taps i32)
    (local $i i32) (local $jx i32) (local $jt i32) (local $end i32) (local $row i32) (local $q i32) (local $v v128)
    (local $sa f64) (local $sb f64) (local $ww f64)
    (local $pos0 f64) (local $base0 f64) (local $f0 f64) (local $p0 f64) (local $mu0 f64)
    (local $x0 i32) (local $t0 i32) (local $w0 i32) (local $a0 v128) (local $b0 v128)
    (local $pos1 f64) (local $base1 f64) (local $f1 f64) (local $p1 f64) (local $mu1 f64)
    (local $x1 i32) (local $t1 i32) (local $w1 i32) (local $a1 v128) (local $b1 v128)
    (local $pos2 f64) (local $base2 f64) (local $f2 f64) (local $p2 f64) (local $mu2 f64)
    (local $x2 i32) (local $t2 i32) (local $w2 i32) (local $a2 v128) (local $b2 v128)
    (local $pos3 f64) (local $base3 f64) (local $f3 f64) (local $p3 f64) (local $mu3 f64)
    (local $x3 i32) (local $t3 i32) (local $w3 i32) (local $a3 v128) (local $b3 v128)
    (local.set $row (i32.shl (local.get $taps) (i32.const 3)))
    (local.set $end (i32.shl (local.get $taps) (i32.const 2)))
    (local.set $i (local.get $i0))
    (loop $pass (if (i32.lt_s (local.get $i) (local.get $i1)) (then
      (if (i32.gt_s (i32.add (local.get $i) (i32.const 4)) (local.get $i1)) (then
        (local.set $i (i32.sub (local.get $i1) (i32.const 4)))))
      ;; output i + 0
      (local.set $pos0 (f64.add (f64.mul (f64.convert_i32_s
        (select (i32.sub (i32.sub (local.get $n) (i32.const 1)) (local.get $i)) (local.get $i) (local.get $rev)))
        (local.get $r)) (local.get $phase)))
      (local.set $base0 (f64.floor (local.get $pos0)))
      (local.set $f0 (f64.mul (f64.sub (local.get $pos0) (local.get $base0)) (local.get $P)))
      (local.set $p0 (f64.floor (local.get $f0)))
      (local.set $mu0 (f64.sub (local.get $f0) (local.get $p0)))
      (local.set $x0 (i32.add (local.get $x) (i32.shl
        (i32.sub (i32.add (i32.trunc_f64_s (local.get $base0)) (i32.const 1)) (local.get $half)) (i32.const 2))))
      (local.set $w0 (i32.add (local.get $w) (i32.shl (i32.trunc_f64_s (local.get $p0)) (i32.const 3))))
      (local.set $t0 (i32.add (local.get $t) (i32.mul (i32.trunc_f64_s (local.get $p0)) (local.get $row))))
      (local.set $a0 (v128.const f64x2 0 0))
      (local.set $b0 (v128.const f64x2 0 0))
      ;; output i + 1
      (local.set $pos1 (f64.add (f64.mul (f64.convert_i32_s
        (select (i32.sub (i32.sub (local.get $n) (i32.const 1)) (i32.add (local.get $i) (i32.const 1))) (i32.add (local.get $i) (i32.const 1)) (local.get $rev)))
        (local.get $r)) (local.get $phase)))
      (local.set $base1 (f64.floor (local.get $pos1)))
      (local.set $f1 (f64.mul (f64.sub (local.get $pos1) (local.get $base1)) (local.get $P)))
      (local.set $p1 (f64.floor (local.get $f1)))
      (local.set $mu1 (f64.sub (local.get $f1) (local.get $p1)))
      (local.set $x1 (i32.add (local.get $x) (i32.shl
        (i32.sub (i32.add (i32.trunc_f64_s (local.get $base1)) (i32.const 1)) (local.get $half)) (i32.const 2))))
      (local.set $w1 (i32.add (local.get $w) (i32.shl (i32.trunc_f64_s (local.get $p1)) (i32.const 3))))
      (local.set $t1 (i32.add (local.get $t) (i32.mul (i32.trunc_f64_s (local.get $p1)) (local.get $row))))
      (local.set $a1 (v128.const f64x2 0 0))
      (local.set $b1 (v128.const f64x2 0 0))
      ;; output i + 2
      (local.set $pos2 (f64.add (f64.mul (f64.convert_i32_s
        (select (i32.sub (i32.sub (local.get $n) (i32.const 1)) (i32.add (local.get $i) (i32.const 2))) (i32.add (local.get $i) (i32.const 2)) (local.get $rev)))
        (local.get $r)) (local.get $phase)))
      (local.set $base2 (f64.floor (local.get $pos2)))
      (local.set $f2 (f64.mul (f64.sub (local.get $pos2) (local.get $base2)) (local.get $P)))
      (local.set $p2 (f64.floor (local.get $f2)))
      (local.set $mu2 (f64.sub (local.get $f2) (local.get $p2)))
      (local.set $x2 (i32.add (local.get $x) (i32.shl
        (i32.sub (i32.add (i32.trunc_f64_s (local.get $base2)) (i32.const 1)) (local.get $half)) (i32.const 2))))
      (local.set $w2 (i32.add (local.get $w) (i32.shl (i32.trunc_f64_s (local.get $p2)) (i32.const 3))))
      (local.set $t2 (i32.add (local.get $t) (i32.mul (i32.trunc_f64_s (local.get $p2)) (local.get $row))))
      (local.set $a2 (v128.const f64x2 0 0))
      (local.set $b2 (v128.const f64x2 0 0))
      ;; output i + 3
      (local.set $pos3 (f64.add (f64.mul (f64.convert_i32_s
        (select (i32.sub (i32.sub (local.get $n) (i32.const 1)) (i32.add (local.get $i) (i32.const 3))) (i32.add (local.get $i) (i32.const 3)) (local.get $rev)))
        (local.get $r)) (local.get $phase)))
      (local.set $base3 (f64.floor (local.get $pos3)))
      (local.set $f3 (f64.mul (f64.sub (local.get $pos3) (local.get $base3)) (local.get $P)))
      (local.set $p3 (f64.floor (local.get $f3)))
      (local.set $mu3 (f64.sub (local.get $f3) (local.get $p3)))
      (local.set $x3 (i32.add (local.get $x) (i32.shl
        (i32.sub (i32.add (i32.trunc_f64_s (local.get $base3)) (i32.const 1)) (local.get $half)) (i32.const 2))))
      (local.set $w3 (i32.add (local.get $w) (i32.shl (i32.trunc_f64_s (local.get $p3)) (i32.const 3))))
      (local.set $t3 (i32.add (local.get $t) (i32.mul (i32.trunc_f64_s (local.get $p3)) (local.get $row))))
      (local.set $a3 (v128.const f64x2 0 0))
      (local.set $b3 (v128.const f64x2 0 0))
      ;; the taps a pair at a time: jx their byte offset in the source, jt in a row
      (local.set $jx (i32.const 0))
      (local.set $jt (i32.const 0))
      (loop $tap
        (local.set $v (f64x2.promote_low_f32x4 (v128.load64_zero (i32.add (local.get $x0) (local.get $jx)))))
        (local.set $q (i32.add (local.get $t0) (local.get $jt)))
        (local.set $a0 (f64x2.add (local.get $a0) (f64x2.mul (v128.load (local.get $q)) (local.get $v))))
        (local.set $b0 (f64x2.add (local.get $b0) (f64x2.mul (v128.load (i32.add (local.get $q) (local.get $row))) (local.get $v))))
        (local.set $v (f64x2.promote_low_f32x4 (v128.load64_zero (i32.add (local.get $x1) (local.get $jx)))))
        (local.set $q (i32.add (local.get $t1) (local.get $jt)))
        (local.set $a1 (f64x2.add (local.get $a1) (f64x2.mul (v128.load (local.get $q)) (local.get $v))))
        (local.set $b1 (f64x2.add (local.get $b1) (f64x2.mul (v128.load (i32.add (local.get $q) (local.get $row))) (local.get $v))))
        (local.set $v (f64x2.promote_low_f32x4 (v128.load64_zero (i32.add (local.get $x2) (local.get $jx)))))
        (local.set $q (i32.add (local.get $t2) (local.get $jt)))
        (local.set $a2 (f64x2.add (local.get $a2) (f64x2.mul (v128.load (local.get $q)) (local.get $v))))
        (local.set $b2 (f64x2.add (local.get $b2) (f64x2.mul (v128.load (i32.add (local.get $q) (local.get $row))) (local.get $v))))
        (local.set $v (f64x2.promote_low_f32x4 (v128.load64_zero (i32.add (local.get $x3) (local.get $jx)))))
        (local.set $q (i32.add (local.get $t3) (local.get $jt)))
        (local.set $a3 (f64x2.add (local.get $a3) (f64x2.mul (v128.load (local.get $q)) (local.get $v))))
        (local.set $b3 (f64x2.add (local.get $b3) (f64x2.mul (v128.load (i32.add (local.get $q) (local.get $row))) (local.get $v))))
        (local.set $jt (i32.add (local.get $jt) (i32.const 16)))
        (br_if $tap (i32.lt_u (local.tee $jx (i32.add (local.get $jx) (i32.const 8))) (local.get $end))))
      (local.set $sa (f64.add (f64x2.extract_lane 0 (local.get $a0)) (f64x2.extract_lane 1 (local.get $a0))))
      (local.set $sb (f64.add (f64x2.extract_lane 0 (local.get $b0)) (f64x2.extract_lane 1 (local.get $b0))))
      (local.set $ww (f64.add (f64.load (local.get $w0))
        (f64.mul (local.get $mu0) (f64.sub (f64.load offset=8 (local.get $w0)) (f64.load (local.get $w0))))))
      (f32.store (i32.add (local.get $y) (i32.shl (local.get $i) (i32.const 2)))
        (f32.demote_f64 (select
          (f64.div (f64.add (local.get $sa) (f64.mul (local.get $mu0) (f64.sub (local.get $sb) (local.get $sa)))) (local.get $ww))
          (f64.const 0)
          (f64.ne (local.get $ww) (f64.const 0)))))
      (local.set $sa (f64.add (f64x2.extract_lane 0 (local.get $a1)) (f64x2.extract_lane 1 (local.get $a1))))
      (local.set $sb (f64.add (f64x2.extract_lane 0 (local.get $b1)) (f64x2.extract_lane 1 (local.get $b1))))
      (local.set $ww (f64.add (f64.load (local.get $w1))
        (f64.mul (local.get $mu1) (f64.sub (f64.load offset=8 (local.get $w1)) (f64.load (local.get $w1))))))
      (f32.store (i32.add (local.get $y) (i32.shl (i32.add (local.get $i) (i32.const 1)) (i32.const 2)))
        (f32.demote_f64 (select
          (f64.div (f64.add (local.get $sa) (f64.mul (local.get $mu1) (f64.sub (local.get $sb) (local.get $sa)))) (local.get $ww))
          (f64.const 0)
          (f64.ne (local.get $ww) (f64.const 0)))))
      (local.set $sa (f64.add (f64x2.extract_lane 0 (local.get $a2)) (f64x2.extract_lane 1 (local.get $a2))))
      (local.set $sb (f64.add (f64x2.extract_lane 0 (local.get $b2)) (f64x2.extract_lane 1 (local.get $b2))))
      (local.set $ww (f64.add (f64.load (local.get $w2))
        (f64.mul (local.get $mu2) (f64.sub (f64.load offset=8 (local.get $w2)) (f64.load (local.get $w2))))))
      (f32.store (i32.add (local.get $y) (i32.shl (i32.add (local.get $i) (i32.const 2)) (i32.const 2)))
        (f32.demote_f64 (select
          (f64.div (f64.add (local.get $sa) (f64.mul (local.get $mu2) (f64.sub (local.get $sb) (local.get $sa)))) (local.get $ww))
          (f64.const 0)
          (f64.ne (local.get $ww) (f64.const 0)))))
      (local.set $sa (f64.add (f64x2.extract_lane 0 (local.get $a3)) (f64x2.extract_lane 1 (local.get $a3))))
      (local.set $sb (f64.add (f64x2.extract_lane 0 (local.get $b3)) (f64x2.extract_lane 1 (local.get $b3))))
      (local.set $ww (f64.add (f64.load (local.get $w3))
        (f64.mul (local.get $mu3) (f64.sub (f64.load offset=8 (local.get $w3)) (f64.load (local.get $w3))))))
      (f32.store (i32.add (local.get $y) (i32.shl (i32.add (local.get $i) (i32.const 3)) (i32.const 2)))
        (f32.demote_f64 (select
          (f64.div (f64.add (local.get $sa) (f64.mul (local.get $mu3) (f64.sub (local.get $sb) (local.get $sa)))) (local.get $ww))
          (f64.const 0)
          (f64.ne (local.get $ww) (f64.const 0)))))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $pass)))))
)
