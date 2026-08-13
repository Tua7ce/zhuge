import { ZODIAC_NAMES, ZODIAC_TO_NUMBERS, getZodiac, getColor } from "./zodiac.mjs";
import { MODEL_CONFIG } from "./model-config.mjs";

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

export function round2(x) {
  return Math.round(x * 10000) / 10000;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function sum(arr) {
  return arr.reduce((s, x) => s + x, 0);
}

function weightedCombo(values, weights) {
  const keys = Object.keys(weights).filter((k) => values[k] !== undefined);
  const wSum = keys.reduce((s, k) => s + weights[k], 0);
  if (wSum <= 0) return 0;
  return keys.reduce((s, k) => s + (weights[k] / wSum) * values[k], 0);
}

function normalizedMax(values) {
  const mx = Math.max(...values, 0);
  if (mx <= 0) return values.map(() => 0);
  return values.map((v) => v / mx);
}

function lastIndexOf(arr, pred) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i], i)) return i;
  }
  return -1;
}

function freqWindow(specials, window) {
  const slice = window === "all" ? specials : specials.slice(-window);
  const f = {};
  for (let n = 1; n <= 49; n++) f[n] = 0;
  for (const s of slice) f[s]++;
  return f;
}

function omissionOf(specials, n) {
  const idx = lastIndexOf(specials, (s) => s === n);
  return idx >= 0 ? specials.length - 1 - idx : specials.length;
}

function avgGapOf(specials, n) {
  const idxs = [];
  specials.forEach((s, i) => {
    if (s === n) idxs.push(i);
  });
  if (idxs.length < 2) return Math.max(1, specials.length);
  let gaps = 0;
  for (let k = 1; k < idxs.length; k++) gaps += idxs[k] - idxs[k - 1];
  return gaps / (idxs.length - 1);
}

function zodiacFreqs(specials, window) {
  const slice = window === "all" ? specials : specials.slice(-window);
  const f = {};
  for (const z of ZODIAC_NAMES) f[z] = 0;
  for (const s of slice) f[getZodiac(s)]++;
  return f;
}

function zodiacOmission(specials, z) {
  const idx = lastIndexOf(specials, (s) => getZodiac(s) === z);
  return idx >= 0 ? specials.length - 1 - idx : specials.length;
}

function zodiacAvgGap(specials, z) {
  const idxs = [];
  specials.forEach((s, i) => {
    if (getZodiac(s) === z) idxs.push(i);
  });
  if (idxs.length < 2) return Math.max(1, specials.length);
  let gaps = 0;
  for (let k = 1; k < idxs.length; k++) gaps += idxs[k] - idxs[k - 1];
  return gaps / (idxs.length - 1);
}

function sortDesc(list, key) {
  return list
    .map((x) => x)
    .sort((a, b) => {
      const d = b[key] - a[key];
      return d !== 0 ? d : String(a.zodiac || a.number).localeCompare(String(b.zodiac || b.number));
    });
}

export function zodiac_model(specials, config = MODEL_CONFIG) {
  const out = [];
  for (const z of ZODIAC_NAMES) {
    const normCounts = {};
    for (const w of config.zodiacFrequencyWindows) {
      const values = ZODIAC_NAMES.map((name) => zodiacFreqs(specials, w)[name]);
      const nrm = normalizedMax(values);
      normCounts[w] = nrm[ZODIAC_NAMES.indexOf(z)];
    }
    const frequencyScore = weightedCombo(normCounts, config.zodiacFrequencyWeights);
    const omission = zodiacOmission(specials, z);
    const omissionScore = Math.min(omission, config.omissionCap) / config.omissionCap;
    const recentTrendScore = weightedCombo(normCounts, config.recentTrendWeights);
    const avgGap = zodiacAvgGap(specials, z);
    const gapScore = clamp(avgGap > 0 ? omission / avgGap / config.gapClip : 0, 0, 1);
    const score =
      config.zodiacWeights.frequency * frequencyScore +
      config.zodiacWeights.omission * omissionScore +
      config.zodiacWeights.recentTrend * recentTrendScore +
      config.zodiacWeights.gap * gapScore;
    out.push({ zodiac: z, score, frequencyScore, omissionScore, recentTrendScore, gapScore, omission });
  }
  return sortDesc(out, "score");
}

export function build_candidate_pool(zodiacScores, topK, config = MODEL_CONFIG) {
  const pool = [];
  const seen = new Set();
  for (let k = 0; k < Math.min(topK, zodiacScores.length); k++) {
    for (const n of ZODIAC_TO_NUMBERS[zodiacScores[k].zodiac] || []) {
      if (!seen.has(n)) {
        seen.add(n);
        pool.push(n);
      }
    }
  }
  return pool;
}

export function conditional_probability(specials, config = MODEL_CONFIG) {
  const alpha = config.laplaceAlpha;
  const zCount = {};
  const nCount = {};
  for (const s of specials) {
    zCount[getZodiac(s)] = (zCount[getZodiac(s)] || 0) + 1;
    nCount[s] = (nCount[s] || 0) + 1;
  }
  const p = {};
  for (let n = 1; n <= 49; n++) {
    const z = getZodiac(n);
    const size = (ZODIAC_TO_NUMBERS[z] || []).length;
    p[n] = ((nCount[n] || 0) + alpha) / ((zCount[z] || 0) + alpha * size);
  }
  return p;
}

export function number_model(specials, zodiacScores, config = MODEL_CONFIG) {
  const cond = conditional_probability(specials, config);
  const freq = {};
  for (const w of config.numberFrequencyWindows) freq[w] = freqWindow(specials, w);
  for (const w of Object.keys(config.recentWeights).map(Number)) {
    if (freq[w] === undefined) freq[w] = freqWindow(specials, w);
  }
  const tailCounts = {};
  for (let t = 0; t <= 9; t++) tailCounts[t] = 0;
  for (const s of specials) tailCounts[s % 10]++;
  const tailNorm = normalizedMax(Object.values(tailCounts));

  const normByWindow = {};
  for (const w of Object.keys(freq)) {
    const arr = [];
    for (let n = 1; n <= 49; n++) arr.push(freq[w][n]);
    const nrm = normalizedMax(arr);
    normByWindow[w] = {};
    for (let n = 1; n <= 49; n++) normByWindow[w][n] = nrm[n - 1];
  }

  const out = [];
  for (let n = 1; n <= 49; n++) {
    const values = {};
    for (const w of Object.keys(normByWindow)) values[w] = normByWindow[w][n];
    const z = getZodiac(n);
    const numberFrequency = weightedCombo(values, config.numberFrequencyWeights);
    const numberOmission = Math.min(omissionOf(specials, n), config.omissionCap) / config.omissionCap;
    const conditionalScore = cond[n];
    const recentScore = weightedCombo(values, config.recentWeights);
    const zodiacScore = (zodiacScores.find((x) => x.zodiac === z) || { score: 0 }).score;
    const tailScore = tailNorm[n % 10];
    const score =
      config.numberWeights.frequency * numberFrequency +
      config.numberWeights.omission * numberOmission +
      config.numberWeights.conditional * conditionalScore +
      config.numberWeights.recent * recentScore +
      config.numberWeights.zodiac * zodiacScore +
      config.numberWeights.tail * tailScore;
    out.push({
      number: n,
      zodiac: z,
      color: getColor(n),
      score,
      components: {
        frequency: numberFrequency,
        omission: numberOmission,
        conditional: conditionalScore,
        recent: recentScore,
        zodiac: zodiacScore,
        tail: tailScore
      }
    });
  }
  return sortDesc(out, "score");
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function logLoss(pairs, predict) {
  const pMin = 0.001, pMax = 0.999;
  let loss = 0;
  for (const p of pairs) {
    const q = clamp(predict(p.score), pMin, pMax);
    loss += -p.hit * Math.log(q) - (1 - p.hit) * Math.log(1 - q);
  }
  return loss / Math.max(1, pairs.length);
}

function fitPlatt(pairs) {
  const ys = pairs.map((p) => p.hit);
  if (new Set(ys).size === 1) {
    const v = ys[0];
    return () => v;
  }
  const xs = pairs.map((p) => p.score);
  const mu = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - mu) ** 2))) || 1;
  const zs = xs.map((x) => (x - mu) / sd);
  let a = 0, b = 0;
  const lr = 0.5;
  for (let iter = 0; iter < 150; iter++) {
    let da = 0, db = 0;
    for (let i = 0; i < pairs.length; i++) {
      const p = sigmoid(a * zs[i] + b);
      const err = p - ys[i];
      da += err * zs[i];
      db += err;
    }
    a -= (lr * da) / pairs.length;
    b -= (lr * db) / pairs.length;
  }
  return (score) => sigmoid(a * ((score - mu) / sd) + b);
}

function fitIsotonic(pairs) {
  const sorted = pairs
    .map((p) => ({ score: p.score, y: p.hit }))
    .sort((a, b) => a.score - b.score || a.y - b.y);
  const bins = [];
  for (const item of sorted) {
    bins.push({ score: item.score, sum: item.y, n: 1 });
    while (bins.length >= 2) {
      const a = bins[bins.length - 2], b = bins[bins.length - 1];
      if (a.sum / a.n <= b.sum / b.n) break;
      b.sum += a.sum;
      b.n += a.n;
      b.score = Math.max(a.score, b.score);
      bins.splice(bins.length - 2, 1);
    }
  }
  return (score) => {
    let best = bins[0];
    for (const bin of bins) {
      if (score >= bin.score) best = bin;
      else break;
    }
    return best.sum / best.n;
  };
}

function fitBeta(pairs) {
  const logit = (p) => Math.log(p / (1 - p));
  const invLogit = (x) => 1 / (1 + Math.exp(-x));
  let best = null;
  for (const a of [0.25, 0.5, 1, 2, 4]) {
    for (const b of [-3, -2, -1, 0, 1, 2, 3]) {
      const loss = logLoss(pairs, (score) => {
        const p0 = clamp(score, 0.01, 0.99);
        return invLogit(a * logit(p0) + b);
      });
      if (!best || loss < best.loss) best = { a, b, loss };
    }
  }
  return (score) => {
    const p0 = clamp(score, 0.01, 0.99);
    return invLogit(best.a * logit(p0) + best.b);
  };
}

function fitMethod(method, pairs) {
  if (method === "platt") return fitPlatt(pairs);
  if (method === "isotonic") return fitIsotonic(pairs);
  if (method === "beta") return fitBeta(pairs);
  return fitPlatt(pairs);
}

export function probability_calibration(pairs, method = "auto", config = MODEL_CONFIG) {
  const cal = config.calibration;
  if (!pairs || pairs.length < Math.max(2, cal.minSamples)) {
    return { method: "constant", samples: pairs ? pairs.length : 0, predict: () => 1 / 49 };
  }
  let methods = cal.methods;
  let chosen = method;
  if (method === "auto" && cal.auto) {
    const split = Math.max(1, Math.floor(pairs.length * cal.selectionSplit));
    const fitPairs = pairs.slice(0, split);
    const selPairs = pairs.slice(split);
    let best = null;
    for (const m of methods) {
      const predict = fitMethod(m, fitPairs);
      const ll = logLoss(selPairs, predict);
      if (!best || ll < best.logLoss) best = { method: m, logLoss: ll };
    }
    chosen = best ? best.method : cal.fallback;
  } else if (!methods.includes(chosen)) {
    chosen = cal.fallback;
  }
  const predict = fitMethod(chosen, pairs);
  const pMin = cal.probabilityMin, pMax = cal.probabilityMax;
  return {
    method: chosen,
    samples: pairs.length,
    logLoss: logLoss(pairs, predict),
    predict: (score) => clamp(predict(score), pMin, pMax)
  };
}

export function netWinForN(n, config = MODEL_CONFIG) {
  const unit = config.payoff.stakeUnit;
  return config.payoff.grossOdds * unit - n * unit;
}

export function ev_number(p, config = MODEL_CONFIG) {
  const unit = config.payoff.stakeUnit;
  return p * (config.payoff.grossOdds * unit - unit) - (1 - p) * unit;
}

export function ev_period(pAny, stake, config = MODEL_CONFIG) {
  const unit = config.payoff.stakeUnit;
  const n = Math.max(1, Math.round(stake / unit));
  return pAny * netWinForN(n, config) - (1 - pAny) * stake;
}

export function ev_optimizer(picks, pAny, budget, config = MODEL_CONFIG) {
  return {
    numbers: picks.map((x) => x.number),
    pAny,
    stake: budget,
    ev: round2(ev_period(pAny, budget, config))
  };
}

function kellyFractionOf(pAny, config = MODEL_CONFIG) {
  const b = config.kelly.netOdds;
  const q = 1 - pAny;
  const f = (b * pAny - q) / b;
  return clamp(f, 0, config.kelly.maxF);
}

export function bankroll_manager(opts, config = MODEL_CONFIG) {
  const mode = opts.mode || "fixed";
  const pAny = opts.pAny || 0;
  const kellyFraction = opts.kellyFraction ?? config.kelly.defaultFraction;
  let stake = opts.budget ?? config.budget.standard;
  let f = 0;
  if (mode === "kelly" || mode === "dynamic") {
    f = kellyFractionOf(pAny, config);
    if (mode === "kelly") {
      stake = f <= 0
        ? config.budget.min
        : clamp(100 * (1 + 2 * kellyFraction * f), config.budget.min, config.budget.max);
      stake = Math.round(stake / config.budget.step) * config.budget.step;
    } else {
      const lo = opts.stakeMin ?? 80, hi = opts.stakeMax ?? 120;
      stake = clamp(lo + (hi - lo) * pAny, lo, hi);
      stake = Math.round(stake / config.budget.step) * config.budget.step;
    }
  }
  if (config.lossProtection.enabled) {
    const lp = config.lossProtection;
    let cap = Infinity;
    if (opts.currentMissStreak >= lp.streakReduce) cap = Math.min(cap, lp.reducedStake);
    if (opts.currentMissStreak >= lp.streakCap100) cap = Math.min(cap, 100);
    if (opts.currentMissStreak >= lp.streakNoIncrease && opts.previousStake) {
      cap = Math.min(cap, opts.previousStake);
    }
    if (opts.consecutiveWins > 0) {
      cap = Math.min(cap, 100 + lp.recoveryStep * opts.consecutiveWins);
    }
    if (Number.isFinite(cap)) stake = Math.min(stake, cap);
    stake = Math.max(stake, config.budget.min);
  }
  return { stake, kellyFraction: f };
}

export function original_model(specials) {
  const freqT = freqWindow(specials, "all");
  const freqR = freqWindow(specials, 50);
  const maxFT = Math.max(...Object.values(freqT));
  const maxFR = Math.max(...Object.values(freqR));
  const omit = {};
  for (let n = 1; n <= 49; n++) omit[n] = omissionOf(specials, n);
  const maxOmit = Math.max(...Object.values(omit), 1);
  const last = specials[specials.length - 1];
  const prevZ = getZodiac(last);
  const zodMk = {};
  let zodTotal = 12;
  for (const z of ZODIAC_NAMES) zodMk[z] = 1;
  for (let i = 0; i < specials.length - 1; i++) {
    const from = getZodiac(specials[i]), to = getZodiac(specials[i + 1]);
    if (from === prevZ) {
      zodMk[to]++;
      zodTotal++;
    }
  }
  for (const z of ZODIAC_NAMES) zodMk[z] /= zodTotal;
  const zodF = {};
  for (const z of ZODIAC_NAMES) zodF[z] = 0;
  for (const s of specials) zodF[getZodiac(s)]++;
  const maxZF = Math.max(...Object.values(zodF), 1);
  const zodO = {};
  for (const z of ZODIAC_NAMES) zodO[z] = omissionOf(specials, ZODIAC_TO_NUMBERS[z][0]);
  const maxZO = Math.max(...Object.values(zodO), 1);
  const scores = {};
  for (let n = 1; n <= 49; n++) {
    const z = getZodiac(n);
    scores[n] =
      (freqT[n] / maxFT) * 0.20 +
      (freqR[n] / maxFR) * 0.15 +
      (omit[n] / maxOmit) * 0.20 +
      zodMk[z] * 0.15 +
      (zodF[z] / maxZF) * 0.15 +
      (zodO[z] / maxZO) * 0.15;
  }
  const sortedNumbers = Object.keys(scores)
    .map((n) => ({ number: +n, score: scores[n], zodiac: getZodiac(+n) }))
    .sort((a, b) => b.score - a.score);
  const zodiacRanking = ZODIAC_NAMES.map((z) => {
    const nums = ZODIAC_TO_NUMBERS[z];
    return { zodiac: z, score: mean(nums.map((n) => scores[n])) };
  }).sort((a, b) => b.score - a.score);
  return { scores, sortedNumbers, zodiacRanking };
}

function pickNumbers(sid, ctx) {
  const { zScores, scoresAll, orig, pMap, config } = ctx;
  const unit = config.payoff.stakeUnit;
  const nMax = Math.floor(config.budget.default / unit);
  const poolOf = (k) => build_candidate_pool(zScores, k, config);
  const byScore = (arr) => scoresAll.filter((x) => arr.includes(x.number)).sort((a, b) => b.score - a.score);
  if (sid === "A") {
    const zTop = orig.zodiacRanking.slice(0, 2);
    const nums = [];
    for (const z of zTop) for (const n of ZODIAC_TO_NUMBERS[z.zodiac]) if (!nums.includes(n)) nums.push(n);
    for (const s of orig.sortedNumbers) {
      if (nums.length >= nMax) break;
      if (!nums.includes(s.number)) nums.push(s.number);
    }
    return nums.slice(0, nMax);
  }
  if (sid === "B") {
    const nums = [...(ZODIAC_TO_NUMBERS[zScores[0].zodiac] || [])];
    for (const s of scoresAll) {
      if (nums.length >= nMax) break;
      if (!nums.includes(s.number)) nums.push(s.number);
    }
    return nums.slice(0, nMax);
  }
  if (sid === "C") return byScore(poolOf(2)).slice(0, nMax).map((x) => x.number);
  if (sid === "D") return byScore(poolOf(3)).slice(0, nMax).map((x) => x.number);
  if (sid === "E") return byScore(poolOf(4)).slice(0, nMax).map((x) => x.number);
  if (sid === "F") return byScore(poolOf(5)).slice(0, nMax).map((x) => x.number);
  if (sid === "G") return scoresAll.slice(0, nMax).map((x) => x.number);
  if (sid.startsWith("H")) {
    const n = +sid.slice(1);
    return byScore(poolOf(3)).slice(0, n).map((x) => x.number);
  }
  if (sid === "I") {
    const pool = byScore(poolOf(3));
    const positive = pool
      .map((x) => ({ x, ev: ev_number(pMap[x.number], config) }))
      .filter((item) => item.ev > 0)
      .sort((a, b) => b.ev - a.ev)
      .map((item) => item.x.number);
    return (positive.length ? positive : pool.map((x) => x.number)).slice(0, nMax);
  }
  return [];
}

function trimPicksByScore(sid, picks, scoresAll, orig, n) {
  if (n >= picks.length) return picks;
  if (sid === "A") {
    return orig.sortedNumbers.filter((x) => picks.includes(x.number)).slice(0, n).map((x) => x.number);
  }
  return scoresAll.filter((x) => picks.includes(x.number)).slice(0, n).map((x) => x.number);
}

function createState(config) {
  return {
    hits: [],
    records: [],
    bankroll: config.startBankroll,
    streak: 0,
    wins: 0,
    prevStake: config.budget.standard
  };
}

export function metrics(records, config = MODEL_CONFIG) {
  const bet = records.filter((r) => r.stake > 0);
  const totalStake = sum(bet.map((r) => r.stake));
  const hitCount = bet.filter((r) => r.hit).length;
  const net = sum(records.map((r) => r.profit));
  const hitRate = bet.length ? hitCount / bet.length : 0;
  const lastN = (n) => {
    const tail = bet.slice(-n);
    return tail.length ? tail.filter((r) => r.hit).length / tail.length : 0;
  };
  let maxStreak = 0, curStreak = 0;
  for (const r of bet) {
    if (r.hit) curStreak = 0;
    else {
      curStreak++;
      maxStreak = Math.max(maxStreak, curStreak);
    }
  }
  const bankrollSeries = [];
  const equity = [];
  const rolling = [];
  const drawdownSeries = [];
  let b = config.startBankroll;
  let peak = b;
  let maxDrawdown = 0;
  let currentDrawdown = 0;
  const winWindow = [];
  for (const r of records) {
    b += r.profit;
    peak = Math.max(peak, b);
    maxDrawdown = Math.max(maxDrawdown, peak - b);
    currentDrawdown = peak - b;
    bankrollSeries.push({ issue: r.issue, value: round2(b) });
    equity.push({ issue: r.issue, value: round2(b - config.startBankroll) });
    drawdownSeries.push({ issue: r.issue, value: round2(currentDrawdown) });
    winWindow.push(r.hit);
    if (winWindow.length > config.backtest.hitRateWindow) winWindow.shift();
    if (bet.includes(r) && winWindow.length) {
      rolling.push({ issue: r.issue, value: round2(winWindow.filter((x) => x).length / winWindow.length) });
    }
  }
  return {
    totalPeriods: records.length,
    betPeriods: bet.length,
    totalStake: round2(totalStake),
    hitCount,
    hitRate: round2(hitRate),
    hitRate10: round2(lastN(10)),
    hitRate20: round2(lastN(20)),
    hitRate30: round2(lastN(30)),
    cumulativeNet: round2(net),
    roi: round2(totalStake ? net / totalStake : 0),
    avgPerPeriod: round2(bet.length ? net / bet.length : 0),
    maxConsecutiveMiss: maxStreak,
    currentConsecutiveMiss: curStreak,
    maxDrawdown: round2(maxDrawdown),
    currentDrawdown: round2(currentDrawdown),
    finalBankroll: round2(config.startBankroll + net),
    peakBankroll: round2(Math.max(...bankrollSeries.map((p) => p.value), config.startBankroll)),
    profitPeriodRatio: round2(bet.length ? hitCount / bet.length : 0),
    netToDrawdown: round2(maxDrawdown ? net / maxDrawdown : net),
    series: { bankroll: bankrollSeries, equity, drawdown: drawdownSeries, hitRate: rolling }
  };
}

export function runBacktest(history, config = MODEL_CONFIG, options = {}) {
  const specials = history.map((h) => h.numbers[6]);
  const issues = history.map((h) => h.issue);
  const warmup = options.warmup ?? config.warmup;
  const strategyIds = options.strategies ?? Object.keys(DEFAULT_STRATEGIES);
  const useCalibration = options.useCalibration !== false;
  const stakeMode = options.stakeMode || "fixed";
  const kellyFraction = options.kellyFraction ?? config.kelly.defaultFraction;
  const pairs = [];
  const states = {};
  const jStates = {};
  const mStates = {};
  for (const sid of strategyIds) states[sid] = createState(config);
  for (let n = 5; n <= 12; n++) jStates[n] = { hits: [] };
  for (let n = 8; n <= 12; n++) mStates[n] = { hits: [] };
  let lastCalib = probability_calibration([], "constant", config);
  const unit = config.payoff.stakeUnit;

  for (let i = warmup; i < specials.length; i++) {
    const prior = specials.slice(0, i);
    const special = specials[i];
    const issue = issues[i];
    const zScores = zodiac_model(prior, config);
    const scoresAll = number_model(prior, zScores, config);
    const orig = original_model(prior);
    if (useCalibration && pairs.length >= config.calibration.minSamples) {
      lastCalib = probability_calibration(pairs, config.calibration.method, config);
    }
    const pMap = {};
    for (const s of scoresAll) pMap[s.number] = lastCalib.predict(s.score);
    const pools = {
      1: build_candidate_pool(zScores, 1, config),
      2: build_candidate_pool(zScores, 2, config),
      3: build_candidate_pool(zScores, 3, config),
      4: build_candidate_pool(zScores, 4, config),
      5: build_candidate_pool(zScores, 5, config)
    };
    const byScoreInPool = (arr) =>
      scoresAll.filter((x) => arr.includes(x.number)).sort((a, b) => b.score - a.score);
    const jPicks = {};
    for (let n = 5; n <= 12; n++) {
      jPicks[n] = byScoreInPool(pools[3]).slice(0, n).map((x) => x.number);
    }
    const mPicks = {};
    for (let n = 8; n <= 12; n++) {
      mPicks[n] = byScoreInPool(pools[3]).slice(0, n).map((x) => x.number);
    }

    for (const sid of strategyIds) {
      const st = states[sid];
      let picks;
      let chosenN = null;
      if (sid === "M") {
        let bestN = 10, bestEV = -Infinity;
        for (let n = 8; n <= 12; n++) {
          const hist = mStates[n].hits;
          const pAny = hist.length >= config.backtest.minPAnySamples
            ? mean(hist)
            : Math.min(1, sum(mPicks[n].map((num) => pMap[num] || 0)));
          const ev = ev_period(pAny, n * unit, config);
          if (ev > bestEV) {
            bestEV = ev;
            bestN = n;
          }
        }
        chosenN = bestN;
        picks = mPicks[bestN];
      } else if (sid === "J") {
        let bestN = 10, bestEV = -Infinity;
        for (let n = 5; n <= 12; n++) {
          const hist = jStates[n].hits;
          const pAny = hist.length >= config.backtest.minPAnySamples
            ? mean(hist)
            : Math.min(1, sum(jPicks[n].map((num) => pMap[num] || 0)));
          const ev = ev_period(pAny, n * unit, config);
          if (ev > bestEV) {
            bestEV = ev;
            bestN = n;
          }
        }
        chosenN = bestN;
        picks = jPicks[bestN];
      } else {
        picks = pickNumbers(sid, { zScores, scoresAll, orig, pMap, config });
      }
      let hit = picks.includes(special);
      const pAny = st.hits.length >= config.backtest.minPAnySamples
        ? mean(st.hits)
        : Math.min(1, sum(picks.map((num) => pMap[num] || 0)));
      const stakeInfo = stakeMode === "kelly"
        ? bankroll_manager({
            pAny,
            mode: "kelly",
            kellyFraction,
            previousStake: st.prevStake,
            currentMissStreak: st.streak,
            consecutiveWins: st.wins
          }, config)
        : bankroll_manager({
            pAny,
            mode: "fixed",
            budget: picks.length * unit,
            previousStake: st.prevStake,
            currentMissStreak: st.streak,
            consecutiveWins: st.wins
          }, config);
      const stake = stakeInfo.stake;
      const baseStake = picks.length * unit;
      if (stakeMode === "kelly" || stake < baseStake) {
        const n = Math.max(1, Math.floor(stake / unit));
        picks = stakeMode === "kelly"
          ? byScoreInPool(pools[3]).slice(0, n).map((x) => x.number)
          : trimPicksByScore(sid, picks, scoresAll, orig, n);
        chosenN = n;
        hit = picks.includes(special);
      }
      const profit = hit ? netWinForN(picks.length, config) : -stake;
      st.hits.push(hit);
      st.bankroll += profit;
      if (hit) {
        st.streak = 0;
        st.wins++;
      } else {
        st.streak++;
        st.wins = 0;
      }
      st.prevStake = stake;
      st.records.push({
        i,
        issue,
        picks,
        special,
        hit,
        stake,
        profit: round2(profit),
        pAny: round2(pAny),
        bankroll: round2(st.bankroll),
        topZodiacs: zScores.slice(0, 3).map((z) => z.zodiac),
        chosenN
      });
      if (sid === "J") {
        for (let n = 5; n <= 12; n++) jStates[n].hits.push(jPicks[n].includes(special));
      }
      if (sid === "M") {
        for (let n = 8; n <= 12; n++) mStates[n].hits.push(mPicks[n].includes(special));
      }
    }
    if (useCalibration) {
      for (const s of scoresAll) pairs.push({ score: s.score, hit: special === s.number });
    }
  }

  const strategyPeriods = {};
  for (const sid of strategyIds) {
    strategyPeriods[sid] = {
      records: states[sid].records,
      metrics: metrics(states[sid].records, config)
    };
  }
  return {
    strategyIds,
    strategyPeriods,
    pairs,
    calibration: { method: lastCalib.method, samples: pairs.length },
    config
  };
}

export const DEFAULT_STRATEGIES = {
  A: "原版生肖全码+补码（对照）",
  B: "单生肖数字补齐（对照）",
  C: "双生肖候选池→10码",
  D: "诸葛策略 · 三才定码 Top10",
  E: "四生肖候选池→10码",
  F: "五生肖候选池→10码",
  G: "49全数字→10码（对照）",
  H5: "精简方案 Top5",
  H6: "精简方案 Top6",
  H7: "精简方案 Top7",
  H8: "精简方案 Top8",
  H9: "精简方案 Top9",
  H10: "诸葛策略 · 三才定码 Top10",
  H11: "天罗候选 Top11",
  H12: "天罗模式 Top12",
  I: "慧算候选（对照）",
  J: "动态TopN（对照）",
  M: "慧算模式 Top8核心+动态补码"
};

export const STRATEGY_NOTES = {
  A: "早期算法版本，用于对照参考。",
  B: "只看第一生肖方向，用于对照参考。",
  C: "候选范围较窄，稳定性一般。",
  D: "命中率、收益与预算之间较平衡，是当前默认主策略。",
  E: "多一个生肖方向，覆盖略有提升。",
  F: "五个生肖候选池，覆盖更广。",
  G: "不看生肖方向，直接在全数字中选码。",
  H5: "投入更低，但覆盖明显减少。",
  H6: "投入较低，覆盖有限。",
  H7: "投入较低，覆盖减少。",
  H8: "精简方案，投入更低但覆盖减少。",
  H9: "接近默认方案的更低投入版本。",
  H10: "与诸葛策略相同的选号结果。",
  H11: "天罗候选的中间档位。",
  H12: "天罗模式，历史命中率更高，但每期需要120元预算。",
  I: "用单一号码预期收益筛选，仅供对照。",
  J: "动态选择号码数量，仅供对照。",
  M: "慧算模式，先选8个核心号码，再根据历史表现动态决定是否补到12码。"
};

export function evaluateStrategy(metrics, config = MODEL_CONFIG) {
  const ev = config.evaluation;
  const riskRatio = metrics.totalStake ? metrics.maxDrawdown / metrics.totalStake : 0;
  return {
    profitability: metrics.roi >= ev.roiGood ? "良好" : metrics.roi >= ev.roiFair ? "一般" : "较弱",
    hitRate: metrics.hitRate >= ev.hitHigh ? "较高" : metrics.hitRate >= ev.hitMid ? "中等" : "较低",
    risk: riskRatio < ev.riskLow ? "低" : riskRatio < ev.riskMid ? "中" : "高",
    stability: metrics.profitPeriodRatio >= ev.stabilityGood ? "良好" : metrics.profitPeriodRatio >= ev.stabilityFair ? "一般" : "较弱"
  };
}

export function conclusionSentence(metrics) {
  const rate = (metrics.hitRate * 100).toFixed(2);
  const net = metrics.cumulativeNet > 0 ? "+" + metrics.cumulativeNet : String(metrics.cumulativeNet);
  return `过去${metrics.betPeriods}次模拟中，该策略命中${metrics.hitCount}次，历史命中率${rate}%，按每期100元模拟累计收益${net}元；历史最大回撤${metrics.maxDrawdown}元，最长连续${metrics.maxConsecutiveMiss}期未命中。`;
}

export function rankStrategies(strategyPeriods) {
  const rows = Object.keys(strategyPeriods).map((sid) => ({
    strategyId: sid,
    name: DEFAULT_STRATEGIES[sid] || sid,
    metrics: strategyPeriods[sid].metrics
  }));
  rows.sort((a, b) => {
    const m = a.metrics, n = b.metrics;
    if (m.cumulativeNet !== n.cumulativeNet) return n.cumulativeNet - m.cumulativeNet;
    if (m.roi !== n.roi) return n.roi - m.roi;
    if (m.netToDrawdown !== n.netToDrawdown) return n.netToDrawdown - m.netToDrawdown;
    return n.profitPeriodRatio - m.profitPeriodRatio;
  });
  return rows.map((row, idx) => ({ rank: idx + 1, ...row }));
}

function renormalize(weights, key, delta) {
  const next = { ...weights };
  next[key] = (next[key] || 0) + delta;
  const total = Object.values(next).reduce((s, v) => s + v, 0);
  for (const k of Object.keys(next)) next[k] /= total;
  return next;
}

function buildConfigGrid(config) {
  const configs = [{ label: "default", config }];
  for (const key of config.grid.zodiacVariants) {
    const cfg = structuredClone(config);
    cfg.zodiacWeights = renormalize(cfg.zodiacWeights, key, 0.1);
    configs.push({ label: `zodiac+${key}`, config: cfg });
  }
  const zodiacVariants = configs.map((x) => x);
  const numberVariants = [{ label: "number+default", config }];
  for (const key of config.grid.numberVariants) {
    const cfg = structuredClone(config);
    cfg.numberWeights = renormalize(cfg.numberWeights, key, 0.1);
    numberVariants.push({ label: `number+${key}`, config: cfg });
  }
  const out = [];
  for (const zw of zodiacVariants) {
    for (const nw of numberVariants) {
      for (const windows of config.grid.windowSets) {
        const cfg = structuredClone(zw.config);
        cfg.numberWeights = nw.config.numberWeights;
        cfg.zodiacFrequencyWindows = windows;
        cfg.numberFrequencyWindows = windows;
        out.push({ label: `${zw.label} · ${nw.label} · w${windows.join("/")}`, config: cfg });
      }
    }
  }
  return out;
}

export function strategy_optimizer(history, config = MODEL_CONFIG) {
  const warmup = config.warmup;
  const T = history.length - warmup;
  const valStart = warmup + Math.floor(T * config.backtest.split.train);
  const testStart = warmup + Math.floor(T * (config.backtest.split.train + config.backtest.split.validation));
  const trainValEnd = testStart;
  const grid = buildConfigGrid(config);
  const evaluated = [];
  for (const item of grid) {
    const run = runBacktest(history.slice(0, trainValEnd), item.config, {
      strategies: ["D"],
      useCalibration: false
    });
    const records = run.strategyPeriods.D.records.filter((r) => r.i >= valStart);
    const m = metrics(records, item.config);
    evaluated.push({ label: item.label, config: item.config, metrics: m });
  }
  const norm = (key) => {
    const vals = evaluated.map((e) => e.metrics[key]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return (e) => (hi === lo ? 0.5 : (e.metrics[key] - lo) / (hi - lo));
  };
  const nNet = norm("cumulativeNet");
  const nRoi = norm("roi");
  const nNd = norm("netToDrawdown");
  let best = null;
  for (const e of evaluated) {
    const score = 0.40 * nNet(e) + 0.30 * nRoi(e) + 0.20 * nNd(e) + 0.10 * e.metrics.profitPeriodRatio;
    if (!best || score > best.score) best = { label: e.label, config: e.config, metrics: e.metrics, score };
  }
  const defaultRun = runBacktest(history, config, { strategies: ["D"], useCalibration: false });
  const selectedRun = runBacktest(history, best.config, { strategies: ["D"], useCalibration: false });
  const dm = metrics(defaultRun.strategyPeriods.D.records.filter((r) => r.i >= testStart), config);
  const sm = metrics(selectedRun.strategyPeriods.D.records.filter((r) => r.i >= testStart), best.config);
  const rulePassed =
    sm.roi * 100 >= dm.roi * 100 + config.grid.replacement.roiLiftPct &&
    sm.maxDrawdown <= dm.maxDrawdown * config.grid.replacement.maxDrawdownWorseFactor &&
    sm.hitRate >= dm.hitRate - config.grid.replacement.hitRateDropPct / 100;
  return {
    configCount: grid.length,
    splits: { trainValEnd, valStart, testStart },
    bestConfigLabel: best.label,
    defaultMetrics: dm,
    selectedMetrics: sm,
    replacementRulePassed: rulePassed,
    activeConfig: rulePassed ? best.config : config,
    activeConfigLabel: rulePassed ? best.label : "default"
  };
}

function combinedPicks(poolTop, allTop, n) {
  const seen = new Set();
  const out = [];
  for (const x of [...poolTop, ...allTop]) {
    if (!seen.has(x.number)) {
      seen.add(x.number);
      out.push(x);
    }
  }
  return out.slice(0, n);
}

export function render_prediction(history, backtestResult, config = MODEL_CONFIG, optimizerResult = null) {
  const specials = history.map((h) => h.numbers[6]);
  const prior = specials;
  const zScores = zodiac_model(prior, config);
  const scoresAll = number_model(prior, zScores, config);
  const calib = probability_calibration(backtestResult.pairs, config.calibration.method, config);
  const pMap = {};
  for (const s of scoresAll) pMap[s.number] = calib.predict(s.score);
  const pool3 = build_candidate_pool(zScores, 3, config);
  const poolTop = scoresAll.filter((x) => pool3.includes(x.number));
  const topZodiacs = zScores.slice(0, 3).map((z) => ({
    ...z,
    probability: round2(z.score / sum(zScores.map((x) => x.score)) || 0)
  }));
  const topNumbers = combinedPicks(poolTop, scoresAll, 10);
  const mainMetrics = backtestResult.strategyPeriods.D.metrics;
  const empPAny = mainMetrics.betPeriods >= config.backtest.minPAnySamples ? mainMetrics.hitRate : null;
  const pAnyOf = (picks) => {
    if (picks.length === 10 && empPAny !== null && picks.map((x) => x.number).sort().join() === topNumbers.map((x) => x.number).sort().join()) {
      return empPAny;
    }
    return Math.min(1, sum(picks.map((x) => pMap[x.number] || 0)));
  };

  const modeN = (() => {
    const records = backtestResult.strategyPeriods.M ? backtestResult.strategyPeriods.M.records : [];
    const counts = {};
    for (const r of records) {
      const n = r.chosenN || 10;
      counts[n] = (counts[n] || 0) + 1;
    }
    let best = 10, bestCount = 0;
    for (const [n, c] of Object.entries(counts)) {
      if (c > bestCount) {
        best = +n;
        bestCount = c;
      }
    }
    return best;
  })();
  const modePicks = {
    tianluo: combinedPicks(poolTop, scoresAll, config.modes.tianluo.topN),
    zhuge: topNumbers,
    huisuan: combinedPicks(poolTop, scoresAll, modeN)
  };
  const buildMode = (key, picks) => {
    const stake = picks.length * config.payoff.stakeUnit;
    const pAny = pAnyOf(picks);
    return {
      name: config.modes[key].name,
      picks: picks.map((x) => x.number),
      numberCount: picks.length,
      perCode: config.payoff.stakeUnit,
      stake,
      hitNet: netWinForN(picks.length, config),
      missLoss: -stake,
      ev: round2(ev_period(pAny, stake, config)),
      pAny: round2(pAny),
      note: config.modes[key].note
    };
  };
  const modes = {
    tianluo: buildMode("tianluo", modePicks.tianluo),
    zhuge: buildMode("zhuge", modePicks.zhuge),
    huisuan: buildMode("huisuan", modePicks.huisuan)
  };

  const budgets = {};
  const maxBudget = Math.max(...config.budget.presets);
  for (let b = config.budget.presets[0]; b <= maxBudget; b += config.budget.step) {
    const n = Math.min(config.budget.maxNumbers, Math.floor(b / config.payoff.stakeUnit));
    const picks = combinedPicks(poolTop, scoresAll, n);
    const pAny = pAnyOf(picks);
    const fixed = {
      stake: b,
      numberCount: n,
      perCode: config.payoff.stakeUnit,
      numbers: picks.map((x) => x.number),
      pAny: round2(pAny),
      hitNet: netWinForN(n, config),
      missLoss: -b,
      ev: round2(ev_period(pAny, b, config)),
      pAnySource: empPAny !== null && n === 10 ? "walk_forward" : "calibrated_sum"
    };
    const kellyStake = bankroll_manager({
      pAny,
      mode: "kelly",
      kellyFraction: config.kelly.defaultFraction,
      previousStake: 100,
      currentMissStreak: mainMetrics.currentConsecutiveMiss,
      consecutiveWins: 0
    }, config).stake;
    const nKelly = Math.max(1, Math.round(kellyStake / config.payoff.stakeUnit));
    const picksKelly = combinedPicks(poolTop, scoresAll, nKelly);
    const pAnyKelly = pAnyOf(picksKelly);
    const kelly = {
      stake: kellyStake,
      numberCount: nKelly,
      perCode: config.payoff.stakeUnit,
      numbers: picksKelly.map((x) => x.number),
      pAny: round2(pAnyKelly),
      hitNet: netWinForN(nKelly, config),
      missLoss: -kellyStake,
      ev: round2(ev_period(pAnyKelly, kellyStake, config)),
      pAnySource: "calibrated_sum"
    };
    budgets[b] = { fixed, kelly };
  }

  const explanation = {};
  const components = ["frequency", "omission", "conditional", "recent", "zodiac", "tail"];
  for (const c of components) {
    explanation[c] = round2(mean(topNumbers.map((x) => x.components[c])) * (config.numberWeights[c] || 0));
  }
  const kelly = {};
  for (const f of config.kelly.fractions) {
    const pAnyBase = empPAny ?? pAnyOf(topNumbers);
    const stake = bankroll_manager({
      pAny: pAnyBase,
      mode: "kelly",
      kellyFraction: f,
      previousStake: 100,
      currentMissStreak: mainMetrics.currentConsecutiveMiss,
      consecutiveWins: 0
    }, config).stake;
    const n = Math.max(1, Math.round(stake / config.payoff.stakeUnit));
    kelly[String(f)] = {
      fraction: f,
      stake,
      numberCount: n,
      hitNet: netWinForN(n, config),
      missLoss: -stake,
      ev: round2(ev_period(pAnyBase, stake, config))
    };
  }

  const earningsPAny = empPAny ?? pAnyOf(topNumbers);
  return {
    generated_at: new Date().toISOString(),
    nextIssue: history.length ? +history[history.length - 1].issue + 1 : 0,
    latestIssue: history.length ? +history[history.length - 1].issue : 0,
    totalPeriods: history.length,
    latestSpecial: specials.length ? specials[specials.length - 1] : 0,
    latestZodiac: specials.length ? getZodiac(specials[specials.length - 1]) : "-",
    branding: config.branding,
    modelConfig: {
      zodiacWeights: config.zodiacWeights,
      numberWeights: config.numberWeights,
      zodiacFrequencyWindows: config.zodiacFrequencyWindows,
      numberFrequencyWindows: config.numberFrequencyWindows,
      calibrationMethod: calib.method,
      calibrationSamples: calib.samples,
      activeConfigLabel: optimizerResult ? optimizerResult.activeConfigLabel : "default",
      flowName: config.branding.flowName
    },
    topZodiacs,
    topNumbers: topNumbers.map((x) => ({
      number: x.number,
      zodiac: x.zodiac,
      color: x.color,
      numberScore: round2(x.score),
      calibratedProbability: round2(pMap[x.number]),
      components: Object.fromEntries(components.map((c) => [c, round2(x.components[c])]))
    })),
    coreMetrics: {
      overall: { hitRate: mainMetrics.hitRate, sample: mainMetrics.betPeriods },
      last10: { hitRate: mainMetrics.hitRate10, sample: Math.min(10, mainMetrics.betPeriods) },
      last20: { hitRate: mainMetrics.hitRate20, sample: Math.min(20, mainMetrics.betPeriods) },
      last30: { hitRate: mainMetrics.hitRate30, sample: Math.min(30, mainMetrics.betPeriods) },
      currentMissStreak: mainMetrics.currentConsecutiveMiss,
      maxMissStreak: mainMetrics.maxConsecutiveMiss,
      currentDrawdown: mainMetrics.currentDrawdown,
      maxDrawdown: mainMetrics.maxDrawdown
    },
    earnings: {
      suggestedStake: 100,
      numberCount: 10,
      perCode: 10,
      hitNet: 370,
      missLoss: -100,
      ev: round2(ev_period(earningsPAny, 100, config)),
      roi: mainMetrics.roi,
      pAny: round2(earningsPAny),
      pAnySource: empPAny !== null ? "walk_forward" : "calibrated_sum"
    },
    conclusion: {
      sentence: `当前生肖方向集中在${topZodiacs.map((z) => z.zodiac).join("、")}，结合候选池中的号码频次、遗漏与条件概率，模型最终筛选出10个核心号码。`,
      hitRate: mainMetrics.hitRate,
      last30: mainMetrics.hitRate30,
      last20: mainMetrics.hitRate20,
      last10: mainMetrics.hitRate10,
      currentMissStreak: mainMetrics.currentConsecutiveMiss,
      maxMissStreak: mainMetrics.maxConsecutiveMiss
    },
    modelExplanation: explanation,
    modes,
    budgets,
    kelly
  };
}

export function buildPredictionHistory(backtestResult, config = MODEL_CONFIG) {
  const records = backtestResult.strategyPeriods.D.records.map((r) => ({
    issue: r.issue,
    topZodiacs: r.topZodiacs,
    topNumbers: r.picks,
    predictedHitRate: r.pAny,
    predictedProbability: r.pAny,
    actualSpecial: r.special,
    hit: r.hit,
    stake: r.stake,
    profit: r.profit,
    cumulativeBankroll: r.bankroll,
    strategy: `${config.branding.mainStrategy} · ${config.branding.flowName}`
  }));
  return records;
}
