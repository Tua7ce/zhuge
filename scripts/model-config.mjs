export const MODEL_CONFIG = {
  warmup: 30,
  startBankroll: 1000,
  zodiacWeights: { frequency: 0.35, omission: 0.30, recentTrend: 0.20, gap: 0.15 },
  zodiacFrequencyWindows: [10, 20, 30, 50],
  zodiacFrequencyWeights: { 10: 0.15, 20: 0.30, 30: 0.35, 50: 0.20 },
  recentTrendWeights: { 10: 0.50, 20: 0.30, 30: 0.20 },
  numberWeights: { frequency: 0.30, omission: 0.25, conditional: 0.20, recent: 0.10, zodiac: 0.10, tail: 0.05 },
  numberFrequencyWindows: [10, 20, 30, 50],
  numberFrequencyWeights: { 10: 0.10, 20: 0.40, 30: 0.35, 50: 0.15 },
  recentWeights: { 5: 0.20, 10: 0.50, 20: 0.30 },
  omissionCap: 30,
  gapClip: 2,
  laplaceAlpha: 1,
  calibration: {
    methods: ["platt", "isotonic", "beta"],
    auto: true,
    fallback: "platt",
    minSamples: 20,
    selectionSplit: 0.70,
    probabilityMin: 0.001,
    probabilityMax: 0.999
  },
  payoff: {
    stakeUnit: 10,
    grossOdds: 47
  },
  branding: {
    siteName: "诸葛六合",
    mainStrategy: "诸葛策略",
    tianluoName: "天罗模式",
    huisuanName: "慧算模式",
    flowName: "三才定码"
  },
  budget: {
    default: 100,
    min: 50,
    standard: 100,
    max: 150,
    step: 10,
    maxNumbers: 49,
    presets: [10, 20, 50, 100, 200, 300, 400]
  },
  kelly: {
    fractions: [0.10, 0.25, 0.50],
    defaultFraction: 0.25,
    maxF: 0.50,
    netOdds: 3.7,
    winThresholdP: 10 / 47
  },
  lossProtection: {
    enabled: true,
    streakNoIncrease: 5,
    streakCap100: 8,
    streakReduce: 10,
    reducedStake: 60,
    recoveryStep: 10
  },
  backtest: {
    split: { train: 0.60, validation: 0.20, test: 0.20 },
    minPAnySamples: 20,
    hitRateWindow: 20,
    mainStrategy: "D"
  },
  grid: {
    zodiacVariants: ["frequency", "omission", "recentTrend", "gap"],
    numberVariants: ["frequency", "omission", "conditional", "recent"],
    windowSets: [
      [10, 20, 30, 50],
      [20, 30, 50, 80],
      [30, 50, 80, 100]
    ],
    replacement: {
      roiLiftPct: 2.0,
      maxDrawdownWorseFactor: 1.20,
      hitRateDropPct: 2.0
    }
  },
  evaluation: {
    roiGood: 0.15,
    roiFair: 0,
    hitHigh: 0.25,
    hitMid: 0.20,
    riskLow: 0.10,
    riskMid: 0.20,
    stabilityGood: 0.25,
    stabilityFair: 0.20
  },
  modes: {
    tianluo: { name: "天罗模式", topN: 12, stake: 120, mode: "fixed", note: "覆盖更多号码，历史命中率更高，但预算更高。" },
    zhuge: { name: "诸葛策略", topN: 10, stake: 100, mode: "fixed", note: "命中率、收益与预算之间较平衡，是当前默认主策略。" },
    huisuan: { name: "慧算模式", minN: 8, maxN: 12, mode: "dynamic", note: "先选8个核心号码，再根据历史表现动态决定是否补码。" }
  }
};
