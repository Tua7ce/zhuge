import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { MODEL_CONFIG } from "./model-config.mjs";
import {
  DEFAULT_STRATEGIES,
  runBacktest,
  rankStrategies,
  strategy_optimizer,
  temporal_factor_study,
  buildPredictionHistory,
  render_prediction,
  probability_calibration,
  STRATEGY_NOTES,
  evaluateStrategy,
  conclusionSentence
} from "./engine.mjs";

const D = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const HIST = join(D, "history.json");
const BACKTEST = join(D, "backtest.json");
const PHR = join(D, "prediction-history.json");
const PRED = join(D, "predictions.json");

export function computeAll(history, config = MODEL_CONFIG) {
  const optimizer = strategy_optimizer(history, config);
  const active = optimizer.activeConfig;
  const temporalStudy = temporal_factor_study(history, active);
  const { productionConfig: temporalProductionConfig, ...temporalStudyOutput } = temporalStudy;
  const result = runBacktest(history, temporalProductionConfig, { useCalibration: true });
  const dMetrics = result.strategyPeriods.D.metrics;
  const comparison = config.calibration.methods.map((method) => {
    const c = probability_calibration(result.pairs, method, config);
    return { method, samples: c.samples, logLoss: c.logLoss };
  });
  const ranking = rankStrategies(result.strategyPeriods).map((r) => ({
    ...r,
    mode: r.strategyId === "D" ? "zhuge" : r.strategyId === "H12" ? "tianluo" : r.strategyId === "M" ? "huisuan" : null
  }));
  const maxRoi = Math.max(...ranking.map((r) => r.metrics.roi));
  const maxHit = Math.max(...ranking.map((r) => r.metrics.hitRate));
  const minDD = Math.min(...ranking.map((r) => r.metrics.maxDrawdown));
  for (const r of ranking) {
    r.tags = [];
    if (r.strategyId === "D") r.tags.push("当前主策略");
    if (r.metrics.roi === maxRoi) r.tags.push("ROI最高");
    if (r.metrics.hitRate === maxHit) r.tags.push("命中率最高");
    if (r.metrics.maxDrawdown === minDD) r.tags.push("回撤最低");
  }
  const kellyPerformance = [];
  for (const fraction of config.kelly.fractions) {
    const run = runBacktest(history, temporalProductionConfig, {
      strategies: ["D"],
      useCalibration: false,
      stakeMode: "kelly",
      kellyFraction: fraction
    });
    kellyPerformance.push({ fraction, metrics: run.strategyPeriods.D.metrics });
  }
  const kellyRows = [
    { name: "固定100元", metrics: dMetrics },
    ...kellyPerformance.map((k) => ({ name: `${k.fraction} Kelly`, metrics: k.metrics }))
  ];
  const bestRoi = Math.max(...kellyRows.map((r) => r.metrics.roi));
  const lowestDD = Math.min(...kellyRows.map((r) => r.metrics.maxDrawdown));
  let combinedBest = kellyRows[0];
  for (const row of kellyRows) {
    const score = row.metrics.roi - row.metrics.maxDrawdown / Math.max(1, row.metrics.totalStake);
    const bestScore = combinedBest.metrics.roi - combinedBest.metrics.maxDrawdown / Math.max(1, combinedBest.metrics.totalStake);
    if (score > bestScore) combinedBest = row;
  }
  const kellyLabels = {
    roiBest: kellyRows.find((r) => r.metrics.roi === bestRoi).name,
    riskLowest: kellyRows.find((r) => r.metrics.maxDrawdown === lowestDD).name,
    combinedBest: combinedBest.name
  };
  const backtest = {
    generated_at: new Date().toISOString(),
    periods: history.length,
    warmup: config.warmup,
    activeConfig: {
      label: optimizer.activeConfigLabel,
      zodiacWeights: active.zodiacWeights,
      numberWeights: active.numberWeights,
      zodiacFrequencyWindows: active.zodiacFrequencyWindows,
      numberFrequencyWindows: active.numberFrequencyWindows,
      temporal: temporalProductionConfig.temporal
    },
    temporalFactorStudy: temporalStudyOutput,
    calibration: {
      ...result.calibration,
      comparison
    },
    mainStrategy: {
      id: "D",
      name: config.branding.mainStrategy,
      flowName: config.branding.flowName,
      mode: "zhuge",
      note: config.modes.zhuge.note
    },
    conclusion: {
      sentence: conclusionSentence(dMetrics),
      totalPeriods: dMetrics.totalPeriods,
      betPeriods: dMetrics.betPeriods,
      hitCount: dMetrics.hitCount,
      hitRate: dMetrics.hitRate,
      cumulativeNet: dMetrics.cumulativeNet,
      roi: dMetrics.roi,
      maxDrawdown: dMetrics.maxDrawdown,
      maxConsecutiveMiss: dMetrics.maxConsecutiveMiss
    },
    evaluation: evaluateStrategy(dMetrics, config),
    strategyNotes: STRATEGY_NOTES,
    kellyLabels,
    gridSearch: {
      configCount: optimizer.configCount,
      splits: optimizer.splits,
      bestConfigLabel: optimizer.bestConfigLabel,
      defaultMetrics: optimizer.defaultMetrics,
      selectedMetrics: optimizer.selectedMetrics,
      replacementRulePassed: optimizer.replacementRulePassed
    },
    ranking,
    kellyPerformance,
    strategies: Object.fromEntries(
      Object.entries(result.strategyPeriods).map(([sid, value]) => [
        sid,
        {
          name: DEFAULT_STRATEGIES[sid] || sid,
          note: STRATEGY_NOTES[sid] || "",
          mode: sid === "D" ? "zhuge" : sid === "H12" ? "tianluo" : sid === "M" ? "huisuan" : null,
          metrics: value.metrics,
          series: value.metrics.series
        }
      ])
    )
  };
  const predictionHistory = {
    generated_at: backtest.generated_at,
    strategy: `${config.branding.mainStrategy} · ${config.branding.flowName}`,
    records: buildPredictionHistory(result, config)
  };
  const predictions = render_prediction(history, result, temporalProductionConfig, optimizer);
  return { predictions, backtest, predictionHistory };
}

function main() {
  const history = JSON.parse(readFileSync(HIST, "utf-8"));
  const all = computeAll(history);
  writeFileSync(PRED, JSON.stringify(all.predictions, null, 2), "utf-8");
  writeFileSync(BACKTEST, JSON.stringify(all.backtest, null, 2), "utf-8");
  writeFileSync(PHR, JSON.stringify(all.predictionHistory, null, 2), "utf-8");
  const top = all.backtest.ranking[0];
  console.log(`Backtest saved: ${history.length} periods, top strategy ${top.strategyId} (${top.name}), ROI ${(top.metrics.roi * 100).toFixed(2)}%`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
