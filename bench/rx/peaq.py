#!/usr/bin/env python3
"""PEAQ, Basic version (ITU-R BS.1387-1): objective difference grade (ODG) of a test signal
against its reference, from -4 (very annoying) to 0 (imperceptible).

A line-by-line numpy port of P. Kabal's MATLAB PQevalAudio (v1r0, 2004), in the variant
PQevalAudio_fn.m used by the declipping survey: github.com/rajmic/declipping2020_codes,
Evaluation_algorithms/PEAQ. Options as there: ClipMOV 0, PCinit 0, PDfactor 1, DelayOverlap 1,
DataBounds 1, EndMin NF/2; frames NF 2048, hop 1024; samples at 16-bit integer scale (x * 32768,
as PQgetData reads WAV files). Loop order is kept wherever floating-point sums or products
accumulate; numpy vectorizes across frames and bands.

  ITU-R BS.1387-1 (2001), Method for objective measurements of perceived audio quality.
  P. Kabal, "An Examination and Interpretation of ITU-R BS.1387: Perceptual Evaluation of Audio
  Quality", TSP Lab Technical Report, Dept. ECE, McGill University, 2002 (rev. 2003).
  P. Zaviska, P. Rajmic, A. Ozerov, L. Rencker, "A Survey and an Extensive Evaluation of Popular
  Audio Declipping Methods", IEEE JSTSP 15(1), 2021 (the published PEAQ numbers checked below).

Input path, as the survey's numbers require: rates other than 48 kHz are resampled as MATLAB
resample(x, 48000, fs) does (polyphase FIR, Kaiser-windowed sinc, beta 5, 10 zero crossings per
side, gain p; taps exactly 0 at the sinc's integer crossings), then both signals are floored to
16-bit PCM, as the survey's WAV files were (floor(x * 32768)). Rounding instead moves the ODG by up
to 0.14, unquantized floats by up to 0.45 (high SDRs, via BandwidthRef/TestB: the quantizer sets
the > 21.6 kHz noise floor they are measured against).

Validation: the survey's PEAQ_clipped (Numerical_results/PEAQ_declippingResults.mat), 10 sounds x
7 input SDRs (1 to 20 dB), clipped as Tools/clip_sdr.m (threshold root-found to machine precision),
odg(original, clipped, 44100): |ODG - published| < 1e-6 in 44 of 70 cases, < 1e-5 in 58, < 1e-4 in
68; mean 3.2e-5, max 1.4e-3 (a25_harp, 15 dB), next 3.6e-4 (a16_clarinet, 20 dB). The residual
cases move by up to 3e-3 when one 16-bit sample of the 48 kHz signals flips by one LSB, and not at
all under PEAQ-side rounding changes (FFT path, 1e-14 rescaling) or clip threshold changes up to
1e-7: what remains is a few LSBs where MATLAB's resample + audiowrite output differs from this one.

Usage:
  python peaq.py REF.wav TEST.wav            prints the ODG
  python peaq.py --batch PAIRS.jsonl         lines {"ref": path, "test": path} -> one JSON line
                                             {"ref", "test", "odg"} per pair (3 processes)
  from peaq import odg; grade, movs = odg(ref, test, fs)   mono float arrays in [-1, 1]
"""
import json
import sys
from math import gcd

import numpy as np

FS, NF, NADV = 48000, 2048, 1024
FSS = FS / NADV                        # frame rate, 46.875 Hz
AMAX = 32768.0                         # 16-bit integer scale of the samples
EMIN = NF // 2                         # PQopt.EndMin

MOVS = ('BandwidthRefB', 'BandwidthTestB', 'TotalNMRB', 'WinModDiff1B', 'ADBB', 'EHSB',
        'AvgModDiff1B', 'AvgModDiff2B', 'RmsNoiseLoudB', 'MFPDB', 'RelDistFramesB')

# PQCB('Basic'): 109 quarter-Bark bands; Kabal's tables replace the formula values (typos kept)
DZ = 0.25
FL = np.array([
    80.000, 103.445, 127.023, 150.762, 174.694, 198.849, 223.257, 247.950, 272.959, 298.317,
    324.055, 350.207, 376.805, 403.884, 431.478, 459.622, 488.353, 517.707, 547.721, 578.434,
    609.885, 642.114, 675.161, 709.071, 743.884, 779.647, 816.404, 854.203, 893.091, 933.119,
    974.336, 1016.797, 1060.555, 1105.666, 1152.187, 1200.178, 1249.700, 1300.816, 1353.592,
    1408.094, 1464.392, 1522.559, 1582.668, 1644.795, 1709.021, 1775.427, 1844.098, 1915.121,
    1988.587, 2064.590, 2143.227, 2224.597, 2308.806, 2395.959, 2486.169, 2579.551, 2676.223,
    2776.309, 2879.937, 2987.238, 3098.350, 3213.415, 3332.579, 3455.993, 3583.817, 3716.212,
    3853.817, 3995.399, 4142.547, 4294.979, 4452.890, 4616.482, 4785.962, 4961.548, 5143.463,
    5331.939, 5527.217, 5729.545, 5939.183, 6156.396, 6381.463, 6614.671, 6856.316, 7106.708,
    7366.166, 7635.020, 7913.614, 8202.302, 8501.454, 8811.450, 9132.688, 9465.574, 9810.536,
    10168.013, 10538.460, 10922.351, 11320.175, 11732.438, 12159.670, 12602.412, 13061.229,
    13536.710, 14029.458, 14540.103, 15069.295, 15617.710, 16186.049, 16775.035, 17385.420])
FC = np.array([
    91.708, 115.216, 138.870, 162.702, 186.742, 211.019, 235.566, 260.413, 285.593, 311.136,
    337.077, 363.448, 390.282, 417.614, 445.479, 473.912, 502.950, 532.629, 562.988, 594.065,
    625.899, 658.533, 692.006, 726.362, 761.644, 797.898, 835.170, 873.508, 912.959, 953.576,
    995.408, 1038.511, 1082.938, 1128.746, 1175.995, 1224.744, 1275.055, 1326.992, 1380.623,
    1436.014, 1493.237, 1552.366, 1613.474, 1676.641, 1741.946, 1809.474, 1879.310, 1951.543,
    2026.266, 2103.573, 2183.564, 2266.340, 2352.008, 2440.675, 2532.456, 2627.468, 2725.832,
    2827.672, 2933.120, 3042.309, 3155.379, 3272.475, 3393.745, 3519.344, 3649.432, 3784.176,
    3923.748, 4068.324, 4218.090, 4373.237, 4533.963, 4700.473, 4872.978, 5051.700, 5236.866,
    5428.712, 5627.484, 5833.434, 6046.825, 6267.931, 6497.031, 6734.420, 6980.399, 7235.284,
    7499.397, 7773.077, 8056.673, 8350.547, 8655.072, 8970.639, 9297.648, 9636.520, 9987.683,
    10351.586, 10728.695, 11119.490, 11524.470, 11944.149, 12379.066, 12829.775, 13294.850,
    13780.887, 14282.503, 14802.338, 15341.057, 15899.345, 16477.914, 17077.504, 17690.045])
FU = np.array([
    103.445, 127.023, 150.762, 174.694, 198.849, 223.257, 247.950, 272.959, 298.317, 324.055,
    350.207, 376.805, 403.884, 431.478, 459.622, 488.353, 517.707, 547.721, 578.434, 609.885,
    642.114, 675.161, 709.071, 743.884, 779.647, 816.404, 854.203, 893.091, 933.113, 974.336,
    1016.797, 1060.555, 1105.666, 1152.187, 1200.178, 1249.700, 1300.816, 1353.592, 1408.094,
    1464.392, 1522.559, 1582.668, 1644.795, 1709.021, 1775.427, 1844.098, 1915.121, 1988.587,
    2064.590, 2143.227, 2224.597, 2308.806, 2395.959, 2486.169, 2579.551, 2676.223, 2776.309,
    2879.937, 2987.238, 3098.350, 3213.415, 3332.579, 3455.993, 3583.817, 3716.212, 3853.348,
    3995.399, 4142.547, 4294.979, 4452.890, 4643.482, 4785.962, 4961.548, 5143.463, 5331.939,
    5527.217, 5729.545, 5939.183, 6156.396, 6381.463, 6614.671, 6856.316, 7106.708, 7366.166,
    7635.020, 7913.614, 8202.302, 8501.454, 8811.450, 9132.688, 9465.574, 9810.536, 10168.013,
    10538.460, 10922.351, 11320.175, 11732.438, 12159.670, 12602.412, 13061.229, 13536.710,
    14029.458, 14540.103, 15069.295, 15617.710, 16186.049, 16775.035, 17385.420, 18000.000])
NC = int(np.ceil((7 * np.arcsinh(18000 / 650) - 7 * np.arcsinh(80 / 650)) / DZ))   # 109
assert NC == len(FC)
BAND = np.arange(NC)


def ssum(a):
    """Left-to-right sum over the last axis (the order of the MATLAB loops)."""
    return np.cumsum(a, axis=-1)[..., -1]


def hann(n):                                         # PQHannWin
    return 0.5 * (1 - np.cos(2 * np.pi * np.arange(n) / (n - 1)))


def tconst(t100, tmin):                              # PQtConst at the frame rate
    t = tmin + (100 / FC) * (t100 - tmin)
    a = np.exp(-1 / (FSS * t))
    return a, 1 - a


def _gl():                                           # PQDFTFrame/PQ_GL: 92 dB SPL at fs/2048*43.5
    W, fcN, df = NF - 1, 1019.5 / FS, 1 / NF
    k = np.floor(fcN / df)
    dfW = min((k + 1) * df - fcN, fcN - k * df) * W
    gp = np.sin(np.pi * dfW) / (np.pi * dfW * (1 - dfW ** 2))
    return 10 ** (92 / 20) / (gp * AMAX / 4 * W)


def _cbmap():                                        # PQgroupCB/PQ_CBMapping
    df, ks, m = FS / NF, np.arange(NF // 2 + 1), []
    for fl, fu in zip(FL, FU):
        kl = ks[(ks + 0.5) * df > fl][0]
        ku = ks[(ks - 0.5) * df < fu][-1]
        ul = (min(fu, (kl + 0.5) * df) - max(fl, (kl - 0.5) * df)) / df
        uu = 0.0 if kl == ku else (min(fu, (ku + 0.5) * df) - max(fl, (ku - 0.5) * df)) / df
        m.append((kl, ku, ul, uu))
    return m


with np.errstate(divide='ignore'):
    _fk = np.linspace(0, FS / 2, NF // 2 + 1) / 1000
    W2 = 10 ** ((-2.184 * _fk ** -0.8 + 6.5 * np.exp(-0.6 * (_fk - 3.3) ** 2)
                 - 0.001 * _fk ** 3.6) / 10)            # PQWOME, W2[0] = 0
HW = _gl() * hann(NF)
CBMAP = _cbmap()
EIN = 10 ** (1.456 * (FC / 1000) ** -0.8 / 10)          # PQIntNoise
A_TDS, B_TDS = tconst(0.030, 0.008)                     # PQ_timeSpread
A_ADP, B_ADP = tconst(0.050, 0.008)                     # PQadapt, PQmodPatt
AL = 10 ** (-2.7 * DZ)                                  # PQ_SpreadCB
AUC = 10 ** ((-2.4 - 23 / FC) * DZ)
GIL = (1 - AL ** (BAND + 1)) / (1 - AL)
ADP_N = (np.minimum(BAND + 4, NC - 1) - np.maximum(BAND - 3, 0) + 1).astype(float)  # M1 3, M2 4
LOUD_ET = 10 ** (3.64 * (FC / 1000) ** -0.8 / 10)      # PQloud
LOUD_S = 10 ** ((-2 - 2.05 * np.arctan(FC / 4000) - 0.75 * np.arctan((FC / 1600) ** 2)) / 10)
LOUD_ETS = 1.07664 * (LOUD_ET / (LOUD_S * 1e4)) ** 0.23
ETE = EIN ** 0.3                                        # PQmovModDiffB
NMR_GM = 10 ** (-np.where(BAND <= 12 / DZ, 3, 0.25 * BAND * DZ) / 10)
BW_KX, BW_KL = int(np.floor(21586 / FS * NF + 0.5)), int(np.floor(8109 / FS * NF + 0.5))  # 921, 346
EHS_NL = 256                                            # 2^PQ_log2(NF * 9000 / FS)
EHS_HW = (1 / EHS_NL) * np.sqrt(8 / 3) * hann(EHS_NL)


def _spread0(E):                                     # PQ_SpreadCB, E: (n, NC)
    e = 0.4
    aUCE = AUC * E ** (0.2 * DZ)
    gIU = (1 - aUCE ** (NC - BAND)) / (1 - aUCE)
    En = E / (GIL + gIU - 1)
    aUCEe, Ene = aUCE ** e, En ** e
    Es = np.empty_like(E)
    Es[:, -1] = Ene[:, -1]
    aLe = AL ** e
    for m in range(NC - 2, -1, -1):                  # lower spreading
        Es[:, m] = aLe * Es[:, m + 1] + Ene[:, m]
    for m in range(NC - 1):                          # upper spreading, r = r * a
        r = np.repeat(aUCEe[:, m:m + 1], NC - m, axis=1)
        r[:, 0] = Ene[:, m]
        Es[:, m + 1:] += np.cumprod(r, axis=1)[:, 1:]
    return Es ** (1 / e)


BS = _spread0(np.ones((1, NC)))[0]


def spread(E):                                       # PQspreadCB
    return _spread0(E) / BS


def group(X):                                        # PQgroupCB, X: (n, NF/2+1)
    Eb = np.empty((len(X), NC))
    for i, (kl, ku, ul, uu) in enumerate(CBMAP):
        Ea = ul * X[:, kl]
        if ku > kl + 1:
            Ea = ssum(np.column_stack([Ea, X[:, kl + 1:ku]]))
        Eb[:, i] = Ea + uu * X[:, ku]
    return np.fmax(Eb, 1e-12)


def dft(x):                                          # PQDFTFrame, x: (n, NF) frames
    X = np.fft.rfft(HW * x, NF)
    return X.real ** 2 + X.imag ** 2


def excit(X2r, X2t):                                 # PQ_excitCB
    Xr, Xt = W2 * X2r, W2 * X2t
    EbN = group(Xr - 2 * np.sqrt(Xr * Xt) + Xt)
    return EbN, spread(group(Xr) + EIN), spread(group(Xt) + EIN)


class Mem:
    """Filter memories (PQinitFMem) and the frame recursions of PQeval."""

    def __init__(self):
        z = lambda: np.zeros((2, NC))
        self.Ef, self.P, self.PC, self.Ese, self.DE, self.Eavg = z(), z(), z(), z(), z(), z()  # PCinit 0
        self.Rn, self.Rd = np.zeros(NC), np.zeros(NC)

    def step(self, Es):                              # Es: (2, NC) -> Ehs, EP, M, ERavg
        self.Ef = A_TDS * self.Ef + B_TDS * Es       # PQ_timeSpread
        Ehs = np.fmax(self.Ef, Es)
        a, b = A_ADP, B_ADP                          # PQadapt
        self.P = a * self.P + b * Ehs
        CL = (ssum(np.sqrt(self.P[1] * self.P[0])) / ssum(self.P[1])) ** 2
        EP = np.array([Ehs[0] / CL, Ehs[1]]) if CL > 1 else np.array([Ehs[0], Ehs[1] * CL])
        self.Rn = a * self.Rn + EP[1] * EP[0]
        self.Rd = a * self.Rd + EP[0] * EP[0]
        if np.any(self.Rd <= 0) or np.any(self.Rn <= 0):
            raise ValueError('PQadapt: Rd or Rn is zero')
        ge = self.Rn >= self.Rd
        R = np.array([np.where(ge, 1.0, self.Rn / self.Rd), np.where(ge, self.Rd / self.Rn, 1.0)])
        Rp = np.pad(R, ((0, 0), (3, 4)))             # bands m-3..m+4, zeros add exactly
        sw = ssum(np.lib.stride_tricks.sliding_window_view(Rp, 8, axis=1))
        self.PC = a * self.PC + b * sw / ADP_N
        EP = EP * self.PC
        Ee = Es ** 0.3                               # PQmodPatt
        self.DE = a * self.DE + b * FSS * np.abs(Ee - self.Ese)
        self.Eavg = a * self.Eavg + b * Ee
        self.Ese = Ee
        return Ehs, EP, self.DE / (1 + self.Eavg / 0.3), self.Eavg[0]


def loud(Ehs):                                       # PQloud, Ehs: (n, NC)
    Nm = LOUD_ETS * ((1 - LOUD_S + LOUD_S * Ehs / LOUD_ET) ** 0.23 - 1)
    return (24 / NC) * ssum(np.fmax(Nm, 0))


def moddiff(M, ERavg):                               # PQmovModDiffB, M: (n, 2, NC)
    M1, M2 = M[:, 0], M[:, 1]
    gt = M1 > M2
    num1 = np.where(gt, M1 - M2, M2 - M1)
    num2 = np.where(gt, 0.1 * num1, num1)
    return ((100 / NC) * ssum(num1 / (1.0 + M1)), (100 / NC) * ssum(num2 / (0.01 + M1)),
            ssum(ERavg / (ERavg + 100 * ETE)))


def nloud(M, EP):                                    # PQmovNLoudB
    sref, stest = 0.15 * M[:, 0] + 0.5, 0.15 * M[:, 1] + 0.5
    beta = np.exp(-1.5 * (EP[:, 1] - EP[:, 0]) / EP[:, 0])
    a = np.fmax(stest * EP[:, 1] - sref * EP[:, 0], 0)
    b = EIN + sref * EP[:, 0] * beta
    NL = (24 / NC) * ssum((EIN / stest) ** 0.23 * ((1 + a / b) ** 0.23 - 1))
    return np.where(NL < 0, 0, NL)


def bw(X2r, X2t):                                    # PQmovBW
    Xth = X2t[:, BW_KX:NF // 2].max(axis=1, keepdims=True)
    k = np.arange(BW_KX)                             # highest bin passing wins; -2: none (BW -1)
    kr = np.where((X2r[:, :BW_KX] >= 10 * Xth) & (k > BW_KL), k, -2).max(axis=1)
    kt = np.where((X2t[:, :BW_KX] >= 10 ** 0.5 * Xth) & (k <= kr[:, None]), k, -2).max(axis=1)
    return kr + 1, kt + 1


def nmr(EbN, EhsR):                                  # PQmovNMRB
    m = EbN / (NMR_GM * EhsR)
    return ssum(m) / NC, np.where(m > 0, m, 0).max(axis=1)


def pd(Ehs):                                         # PQmovPD and PQ_ChanPD (mono)
    c = (-0.198719, 0.0550197, -0.00102438, 5.05622e-6, 9.01033e-11)
    R, T = 10 * np.log10(Ehs[:, 0]), 10 * np.log10(Ehs[:, 1])
    e = R - T
    pos = e > 0
    L = np.where(pos, 0.3 * R + 0.7 * T, T)
    s = np.where(L > 0, 5.95072 * (6.39468 / L) ** 1.71332
                 + c[0] + L * (c[1] + L * (c[2] + L * (c[3] + L * c[4]))), 1e30)
    p = 1 - 0.5 ** ((e / s) ** np.where(pos, 4, 6))
    q = np.abs(np.trunc(e)) / s
    return 1 - np.cumprod(1 - p, axis=1)[:, -1], ssum(q)


def ehs(xr, xt, X2r, X2t):                           # PQmovEHS
    NL = M = EHS_NL
    h = slice(NADV, NF)
    En = np.einsum('ij,ij->i', xr[:, h], xr[:, h]), np.einsum('ij,ij->i', xt[:, h], xt[:, h])
    D = np.log(X2t[:, :NL + M - 1] / X2r[:, :NL + M - 1])
    d0 = np.fft.rfft(D[:, :M], 2 * NL)               # PQ_Corr via DFT
    d1 = np.fft.rfft(D, 2 * NL)
    C = np.fft.irfft(np.conj(d0) * d1, 2 * NL)[:, :NL]
    s0 = C[:, :1]                                    # PQ_NCorr
    sj = np.cumsum(np.column_stack([s0, D[:, M:NL + M - 1] ** 2 - D[:, :NL - 1] ** 2]), axis=1)
    d = s0 * sj[:, 1:]
    Cn = np.column_stack([np.ones(len(D)), np.where(d <= 0, 1, C[:, 1:] / np.sqrt(d))])
    Cw = EHS_HW * (Cn - (1 / NL) * ssum(Cn)[:, None])
    cp = np.fft.rfft(Cw, NL)
    c2 = cp.real ** 2 + cp.imag ** 2
    v = np.where(c2[:, 1:] > c2[:, :1], c2[:, 1:], 0).max(axis=1)   # PQ_FindPeak: cprev stays c2[0]
    return np.where((En[0] < 8000) & (En[1] < 8000), -1, v)


def bounds(x):                                       # PQdataBoundary (mono, StartS 0)
    L, NB, thr = 5, 2048, 200.0
    a, end = np.abs(x), len(x) - 1

    def first(v):                                    # PQ_DataStart
        s = ssum(v[:L])
        if s > thr:
            return 0
        s = np.cumsum(np.concatenate([[s], v[L:] - v[:max(len(v) - L, 0)]]))[1:]
        return int(np.argmax(s > thr)) + 1 if np.any(s > thr) else -1

    def last(v):                                     # PQ_DataEnd
        n = len(v)
        s = ssum(v[n - min(n, L):])
        if s > thr:
            return n - 1
        i = np.arange(n - 2, L - 2, -1)
        s = np.cumsum(np.concatenate([[s], v[i - L + 1] - v[i + 1]]))[1:]
        return int(i[np.argmax(s > thr)]) if np.any(s > thr) else -1

    lo = hi = -1
    i = 0
    while i <= end:
        nf = min(end - i + 1, NB)
        if (k := first(a[i:i + nf])) >= 0:
            lo = k + i
            break
        i += NB - (L - 1)
    i = 0
    while i <= end:
        nf = min(end - i + 1, NB)
        js = end - (i + nf - 1 + 1) + 1
        if (k := last(a[js:js + nf])) >= 0:
            hi = k + js
            break
        i += NB - (L - 1)
    if (lo >= 0) != (hi >= 0) or lo > hi:
        raise ValueError('PQdataBoundary: inconsistent limits')
    return (lo, hi) if lo >= 0 else (0, 0)


def movc(xr, xt, block=256):
    """Per-frame MOV precursors (the frame loop of PQevalAudio_fn), samples at 16-bit scale."""
    lo, hi = bounds(xr)
    f0 = lo // NADV                                  # Fstart
    n = (hi + 1 - EMIN) // NADV - f0 + 1             # Np
    if n < 1:
        raise ValueError('PEAQ: signal too short or silent (no frame within the data bounds)')
    T = f0 + n                                       # frames from sample 0; the first f0 warm up
    ln = (T - 1) * NADV + NF
    xr, xt = (np.pad(v[:ln], (0, ln - len(v[:ln]))) for v in (xr, xt))
    view = lambda v, t: np.lib.stride_tricks.sliding_window_view(v, NF)[t * NADV]
    mem, out = Mem(), []
    for b0 in range(0, T, block):
        t = np.arange(b0, min(b0 + block, T))
        fr, ft = view(xr, t), view(xt, t)
        X2r, X2t = dft(fr), dft(ft)
        EbN, Esr, Est = excit(X2r, X2t)
        steps = [mem.step(Es) for Es in np.stack((Esr, Est), axis=1)]
        Ehs, EP, M, ER = (np.array(v) for v in zip(*steps))
        k = t >= f0
        Ehs, EP, M, ER, X2r, X2t, EbN, fr, ft = (v[k] for v in (Ehs, EP, M, ER, X2r, X2t, EbN, fr, ft))
        out.append(dict(zip(
            ('Mt1B', 'Mt2B', 'Wt', 'NL', 'NRef', 'NTest', 'BWRef', 'BWTest', 'NMRavg', 'NMRmax',
             'Pc', 'Qc', 'EHS'),
            (*moddiff(M, ER), nloud(M, EP), loud(Ehs[:, 0]), loud(Ehs[:, 1]), *bw(X2r, X2t),
             *nmr(EbN, Ehs[:, 0]), *pd(Ehs), ehs(fr, ft, X2r, X2t)))))
    return {key: np.concatenate([o[key] for o in out]) for key in out[0]}, f0


def avg(C, nwup):
    """PQavgMOVB (mono): time averages of the precursors -> the 11 MOVs."""
    def linpos(x):
        v = x[x >= 0]
        return ssum(v) / len(v) if len(v) else 0.0

    def wtavg(x, w):
        return ssum(w * x) / ssum(w) if len(x) else 0.0

    def winavg(L, x):
        N = len(x)
        if N < L:
            return 0.0
        r = np.sqrt(x)
        t = ssum(np.lib.stride_tricks.sliding_window_view(r, L)[:, ::-1])   # sqrt(x(i-m)), m = 0..L-1
        return np.sqrt(ssum((t / L) ** 4) / (N - L + 1))

    def rms(x):
        return np.sqrt(ssum(x ** 2) / len(x)) if len(x) else 0.0

    Np = len(C['Pc'])
    ndel = max(0, int(np.ceil(0.5 * FSS)) - nwup)
    nl = Np                                          # PQloudTest
    hit = np.flatnonzero((C['NRef'] > 0.1) & (C['NTest'] > 0.1))
    if len(hit):
        nl = int(hit[0])
    ndel_nl = max(nl + int(np.ceil(0.050 * FSS)), ndel)
    phc = pcmax = 0.0                                # PQ_avgPD, PDfactor 1
    for v in C['Pc']:
        phc = 0.9 * phc + (1 - 0.9) * v
        pcmax = np.fmax(pcmax * 1, phc)
    det = C['Pc'] > 0.5
    nd, qsum = int(det.sum()), ssum(C['Qc'][det]) if det.any() else 0.0
    adb = 0.0 if nd == 0 else np.log10(qsum / nd) if qsum > 0 else -0.5
    x1, x2, w = C['Mt1B'][ndel:], C['Mt2B'][ndel:], C['Wt'][ndel:]
    return np.array([
        linpos(C['BWRef']), linpos(C['BWTest']),
        10 * np.log10(ssum(C['NMRavg']) / Np),
        winavg(int(np.floor(0.1 * FSS)), x1),
        adb,
        1000 * linpos(C['EHS']),
        wtavg(x1, w), wtavg(x2, w),
        rms(C['NL'][ndel_nl:]),
        pcmax,
        np.count_nonzero(C['NMRmax'] > 10 ** (1.5 / 10)) / Np])


NN_AMIN = (393.916656, 361.965332, -24.045116, 1.110661, -0.206623, 0.074318, 1.113683,
           0.950345, 0.029985, 0.000101, 0)
NN_AMAX = (921, 881.131226, 16.212030, 107.137772, 2.886017, 13.933351, 63.257874,
           1145.018555, 14.819740, 1, 1)
NN_WX = ((-0.502657, 0.436333, 1.219602), (4.307481, 3.246017, 1.123743),
         (4.984241, -2.211189, -0.192096), (0.051056, -1.762424, 4.331315),
         (2.321580, 1.789971, -0.754560), (-5.303901, -3.452257, -10.814982),
         (2.730991, -6.111805, 1.519223), (0.624950, -1.331523, -5.955151),
         (3.102889, 0.871260, -5.922878), (-1.051468, -0.939882, -0.142913),
         (-1.804679, -0.503610, -0.620456))
NN_WXB = (-2.518254, 0.654841, -2.207228)
NN_WY = (-3.817048, 4.107138, 4.629582)
NN_WYB = -0.307594
NN_BMIN, NN_BMAX = -3.98, 0.22


def nnet(mov):                                       # PQnNet (Basic, ClipMOV 0)
    sig = lambda v: 1 / (1 + np.exp(-v))
    x = [(m - lo) / (hi - lo) for m, lo, hi in zip(mov, NN_AMIN, NN_AMAX)]
    di = NN_WYB
    for j in range(3):
        arg = NN_WXB[j]
        for i in range(len(x)):
            arg = arg + NN_WX[i][j] * x[i]
        di = di + NN_WY[j] * sig(arg)
    return float(NN_BMIN + (NN_BMAX - NN_BMIN) * sig(di))


def to48(x, fs):
    """MATLAB resample(x, 48000, fs): windowed sinc, exact zeros at its nonzero integer crossings."""
    x = np.asarray(x, dtype=float)
    fs = int(fs)
    if fs == FS:
        return x
    from scipy.signal import resample_poly
    from scipy.signal.windows import kaiser
    g = gcd(FS, fs)
    up, down = FS // g, fs // g
    m = max(up, down)
    n = np.arange(-10 * m, 10 * m + 1)
    h = np.sinc(n / m) * kaiser(len(n), 5.0)
    h[(n % m == 0) & (n != 0)] = 0                   # np.sinc(k) ~ 1e-17, not 0: floor() would see it
    return resample_poly(x, up, down, window=h / h.sum())


def odg(ref, test, fs=FS, pcm16=True):
    """PEAQ Basic ODG of test against ref (mono float arrays in [-1, 1] at rate fs) and the 11 MOVs.

    pcm16: pass both through 16-bit PCM as the survey's WAV files did (floor(x * 32768), saturated);
    False feeds the float samples to PEAQ unquantized."""
    r, t = to48(ref, fs) * AMAX, to48(test, fs) * AMAX
    if pcm16:
        r, t = (np.clip(np.floor(v), -AMAX, AMAX - 1) for v in (r, t))
    with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
        C, f0 = movc(r, t)
        mov = avg(C, f0)                             # DelayOverlap 1: Nwup = Fstart
        return nnet(mov), dict(zip(MOVS, map(float, mov)))


def _wav(path):
    import soundfile as sf
    x, fs = sf.read(path, dtype='float64', always_2d=True)
    return to48(x[:, 0], fs)


def _pair(p):
    try:
        return {**p, 'odg': odg(_wav(p['ref']), _wav(p['test']))[0]}
    except Exception as e:
        return {**p, 'odg': None, 'error': f'{type(e).__name__}: {e}'}


def main(argv):
    if len(argv) == 2 and argv[0] == '--batch':
        from multiprocessing import Pool
        with open(argv[1]) as f:
            pairs = [{'ref': d['ref'], 'test': d['test']} for d in map(json.loads, filter(str.strip, f))]
        with Pool(max(1, min(3, len(pairs)))) as pool:
            for r in pool.imap(_pair, pairs):
                print(json.dumps(r), flush=True)
    elif len(argv) == 2:
        print(f'{odg(_wav(argv[0]), _wav(argv[1]))[0]:.4f}')
    else:
        sys.exit(__doc__.split('Usage:')[1].rstrip())


if __name__ == '__main__':
    main(sys.argv[1:])
