import { test } from "node:test";
import assert from "node:assert/strict";
import {
  zodiac_model,
  build_candidate_pool,
  conditional_probability,
  number_model,
  probability_calibration,
  bankroll_manager,
  metrics,
  runBacktest,
  apply_zodiac_repeat_penalty,
  apply_number_repeat_penalty,
  select_stable_parameter,
  temporal_factor_study,
  ev_period,
  netWinForN,
  render_prediction,
  clamp
} from "./engine.mjs";
import { MODEL_CONFIG } from "./model-config.mjs";
import { ZODIAC_TO_NUMBERS } from "./zodiac.mjs";

function seededHistory(count = 200, seed = 42) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  const out = [];
  for (let i = 1; i <= count; i++) {
    const numbers = [];
    for (let k = 0; k < 7; k++) numbers.push(1 + Math.floor(rand() * 49));
    out.push({ issue: 2026000 + i, date: "2026-01-01", numbers, zodiacs: [], time: "" });
  }
  return out;
}

test("生肖分量都在 0~1 且公式有界", () => {
  const specials = seededHistory(120).map((h) => h.numbers[6]);
  const rows = zodiac_model(specials);
  assert.equal(rows.length, 12);
  for (const r of rows) {
    assert.ok(r.frequencyScore >= 0 && r.frequencyScore <= 1);
    assert.ok(r.omissionScore >= 0 && r.omissionScore <= 1);
    assert.ok(r.recentTrendScore >= 0 && r.recentTrendScore <= 1);
    assert.ok(r.gapScore >= 0 && r.gapScore <= 1);
    assert.ok(r.score >= 0 && r.score <= 1);
  }
});

test("候选池严格等于 TopK 生肖号码并集", () => {
  const specials = seededHistory(120).map((h) => h.numbers[6]);
  const rows = zodiac_model(specials);
  const pool = build_candidate_pool(rows, 3);
  const expected = new Set();
  for (let k = 0; k < 3; k++) {
    for (const n of ZODIAC_TO_NUMBERS[rows[k].zodiac]) expected.add(n);
  }
  assert.deepEqual([...pool].sort((a, b) => a - b), [...expected].sort((a, b) => a - b));
});

test("条件概率使用 Laplace 平滑且不含 0/1", () => {
  const specials = seededHistory(120).map((h) => h.numbers[6]);
  const p = conditional_probability(specials);
  for (let n = 1; n <= 49; n++) {
    assert.ok(p[n] > 0 && p[n] < 1, `number ${n} got ${p[n]}`);
  }
});

test("数字评分与分量都在安全区间", () => {
  const specials = seededHistory(120).map((h) => h.numbers[6]);
  const z = zodiac_model(specials);
  const scores = number_model(specials, z);
  assert.equal(scores.length, 49);
  for (const s of scores) {
    assert.ok(s.score >= 0 && s.score <= 1);
    for (const c of Object.values(s.components)) {
      assert.ok(c >= 0 && c <= 1, `component ${c}`);
    }
  }
});

test("时序因子是软惩罚且不删除目标", () => {
  const specials = seededHistory(120).map((h) => h.numbers[6]);
  const zodiacRows = zodiac_model(specials);
  const previousZodiac = zodiacRows[0].zodiac;
  const zCfg = structuredClone(MODEL_CONFIG);
  zCfg.temporal.enableZodiacRepeatPenalty = true;
  zCfg.temporal.zodiacRepeatPenalty = 0.30;
  const zodiacAdjusted = apply_zodiac_repeat_penalty(zodiacRows, previousZodiac, zCfg);
  assert.equal(zodiacAdjusted.length, 12);
  const zBase = zodiacRows.find((r) => r.zodiac === previousZodiac);
  const zAdj = zodiacAdjusted.find((r) => r.zodiac === previousZodiac);
  assert.ok(Math.abs(zAdj.score - zBase.score * 0.7) < 1e-9);
  assert.ok(zodiacAdjusted.every((r) => r.zodiac));

  const numberRows = number_model(specials, zodiacRows);
  const previousSpecial = specials[specials.length - 1];
  const nCfg = structuredClone(MODEL_CONFIG);
  nCfg.temporal.enableNumberRepeatPenalty = true;
  nCfg.temporal.numberRepeatFactor = 0.25;
  const numberAdjusted = apply_number_repeat_penalty(numberRows, previousSpecial, nCfg);
  assert.equal(numberAdjusted.length, 49);
  const nBase = numberRows.find((r) => r.number === previousSpecial);
  const nAdj = numberAdjusted.find((r) => r.number === previousSpecial);
  assert.ok(Math.abs(nAdj.score - nBase.score * 0.25) < 1e-9);
  assert.ok(numberAdjusted.some((r) => r.number === previousSpecial));
});

test("启用时序因子后仍无未来数据泄漏", () => {
  const history = seededHistory(80, 7);
  const cfg = structuredClone(MODEL_CONFIG);
  cfg.temporal.enableZodiacRepeatPenalty = true;
  cfg.temporal.enableNumberRepeatPenalty = true;
  cfg.temporal.zodiacRepeatPenalty = 0.30;
  cfg.temporal.numberRepeatFactor = 0.25;
  const i = 60;
  const full = runBacktest(history, cfg, { strategies: ["D"], useCalibration: false });
  const truncated = runBacktest(history.slice(0, i + 1), cfg, { strategies: ["D"], useCalibration: false });
  const a = full.strategyPeriods.D.records[i - 30];
  const b = truncated.strategyPeriods.D.records[i - 30];
  assert.deepEqual(a.picks, b.picks);
  assert.equal(a.pAny, b.pAny);
  assert.equal(a.profit, b.profit);
});

test("稳定平台选择中间值并拒绝单点平台", () => {
  const baselineSegmentRois = [0.1, 0.1, 0.1];
  const rows = [
    { value: 0.05, metrics: { roi: 0.2 }, segmentRois: [0.25, 0.05, 0.05] },
    { value: 0.20, metrics: { roi: 0.2 }, segmentRois: [0.25, 0.25, 0.25] },
    { value: 0.25, metrics: { roi: 0.2 }, segmentRois: [0.25, 0.25, 0.25] },
    { value: 0.30, metrics: { roi: 0.2 }, segmentRois: [0.25, 0.25, 0.25] },
    { value: 0.40, metrics: { roi: 0.2 }, segmentRois: [0.25, 0.25, 0.25] },
    { value: 0.50, metrics: { roi: 0.2 }, segmentRois: [0.25, 0.25, 0.25] },
    { value: 0.80, metrics: { roi: 0.2 }, segmentRois: [0.25, 0.05, 0.05] }
  ];
  const selected = select_stable_parameter(rows, baselineSegmentRois);
  assert.equal(selected.reason, "stable_platform");
  assert.equal(selected.selectedValue, 0.30);

  const tiny = select_stable_parameter(rows.slice(0, 2), baselineSegmentRois);
  assert.equal(tiny.reason, "plateau_too_small");
  assert.equal(tiny.selectedValue, null);
});

test("时序因子研究确定且输出完整", () => {
  const history = seededHistory(70, 11);
  const a = temporal_factor_study(history);
  const b = temporal_factor_study(history);
  assert.equal(a.sensitivity.zodiacRepeatPenalty.length, 11);
  assert.equal(a.sensitivity.numberRepeatFactor.length, 11);
  assert.deepEqual(a.selection, b.selection);
  assert.deepEqual(a.experiments.A.development, b.experiments.A.development);
  assert.ok(["ACTIVE", "CANDIDATE", "REJECTED"].includes(a.status));
  assert.ok(a.impact.zodiac.full.periods > 0);
  assert.ok(a.impact.number.full.periods > 0);
  assert.ok(a.naturalRates.totalTransitions > 0);
  assert.ok(a.productionTemporal.enableZodiacRepeatPenalty === false || a.productionTemporal.enableZodiacRepeatPenalty === true);
});

test("无未来数据泄漏：截断未来不影响当期预测", () => {
  const history = seededHistory(80, 7);
  const i = 60;
  const full = runBacktest(history, undefined, { strategies: ["D"], useCalibration: false });
  const truncated = runBacktest(history.slice(0, i + 1), undefined, { strategies: ["D"], useCalibration: false });
  const a = full.strategyPeriods.D.records[i - 30];
  const b = truncated.strategyPeriods.D.records[i - 30];
  assert.deepEqual(a.picks, b.picks);
  assert.equal(a.pAny, b.pAny);
  assert.equal(a.profit, b.profit);
});

test("指标计算正确", () => {
  const records = [];
  for (let i = 0; i < 10; i++) {
    const hit = i < 2;
    records.push({
      issue: 100 + i,
      stake: 100,
      hit,
      profit: hit ? 370 : -100,
      bankroll: 1000 + (hit ? 370 : -100) * (i + 1)
    });
  }
  const m = metrics(records);
  assert.equal(m.hitRate, 0.2);
  assert.equal(m.cumulativeNet, 2 * 370 - 8 * 100);
  assert.equal(m.maxConsecutiveMiss, 8);
  assert.equal(m.currentConsecutiveMiss, 8);
  assert.equal(m.maxDrawdown, 800);
  assert.equal(m.maxDrawdownRate, 0.8);
  assert.equal(m.currentDrawdown, 800);
  assert.equal(m.finalBankroll, 940);
});

test("资金管理：Kelly 封顶 150，连败保护降到 60", () => {
  const high = bankroll_manager({ pAny: 0.9, mode: "kelly", kellyFraction: 0.5, currentMissStreak: 0, consecutiveWins: 0 });
  assert.equal(high.stake, 150);
  const protectedStake = bankroll_manager({ pAny: 0.9, mode: "kelly", kellyFraction: 0.5, currentMissStreak: 10, consecutiveWins: 0, previousStake: 150 });
  assert.equal(protectedStake.stake, 60);
  const low = bankroll_manager({ pAny: 0.05, mode: "kelly", kellyFraction: 0.25, currentMissStreak: 0, consecutiveWins: 0 });
  assert.equal(low.stake, 50);
});

test("真实奖付结构：8/10/12码收益正确", () => {
  assert.equal(netWinForN(8), 390);
  assert.equal(netWinForN(10), 370);
  assert.equal(netWinForN(12), 350);
  assert.equal(ev_period(1, 80), 390);
  assert.equal(ev_period(0, 80), -80);
  assert.equal(ev_period(1, 100), 370);
  assert.equal(ev_period(0, 100), -100);
  assert.equal(ev_period(1, 120), 350);
  assert.equal(ev_period(0, 120), -120);
});

test("回测包含天罗与慧算且成本口径一致", () => {
  const history = seededHistory(90, 5);
  const run = runBacktest(history, undefined, { strategies: ["D", "H12", "M"], useCalibration: false });
  const d0 = run.strategyPeriods.D.records[0];
  const h0 = run.strategyPeriods.H12.records[0];
  const m = run.strategyPeriods.M;
  assert.equal(h0.stake, 120);
  assert.ok([-120, 350].includes(h0.profit));
  assert.equal(d0.stake, 100);
  assert.ok([-100, 370].includes(d0.profit));
  assert.ok(m.records.length > 0);
  assert.ok(m.records[0].chosenN >= 8 && m.records[0].chosenN <= 12);
  assert.ok(m.records.every((r) => r.chosenN >= 5 && r.chosenN <= 12));
});

test("渲染输出模式与预算同源同步", () => {
  const history = seededHistory(90, 3);
  const run = runBacktest(history, undefined, { strategies: ["D", "M"], useCalibration: true });
  const pred = render_prediction(history, run, undefined, { activeConfigLabel: "default" });
  assert.deepEqual(Object.keys(pred.modes), ["tianluo", "zhuge", "huisuan"]);
  assert.equal(pred.modes.zhuge.name, "诸葛策略");
  assert.equal(pred.modes.tianluo.name, "天罗模式");
  assert.equal(pred.modes.huisuan.name, "慧算模式");
  assert.equal(pred.modes.tianluo.numberCount, 12);
  assert.equal(pred.modes.tianluo.stake, 120);
  assert.equal(pred.modes.tianluo.hitNet, 350);
  assert.equal(pred.modes.tianluo.missLoss, -120);
  const b100 = pred.budgets["100"].fixed;
  assert.equal(b100.stake, 100);
  assert.equal(b100.numberCount, 10);
  assert.equal(b100.perCode, 10);
  assert.equal(b100.hitNet, 370);
  assert.equal(b100.missLoss, -100);
  const b120 = pred.budgets["120"].fixed;
  assert.equal(b120.stake, 120);
  assert.equal(b120.numberCount, 12);
  assert.equal(b120.hitNet, 350);
});

test("Isotonic 校准单调且有界", () => {
  const pairs = [];
  for (let i = 0; i < 200; i++) {
    const score = (i % 100) / 100;
    pairs.push({ score, hit: score > 0.6 && i % 3 === 0 ? 1 : 0 });
  }
  const calib = probability_calibration(pairs, "isotonic");
  let prev = 0;
  for (let s = 0.05; s <= 1; s += 0.05) {
    const p = calib.predict(s);
    assert.ok(p >= prev);
    assert.ok(p >= 0.001 && p <= 0.999);
    prev = p;
  }
});

test("回测结果确定且包含主策略", () => {
  const history = seededHistory(70, 11);
  const a = runBacktest(history, undefined, { strategies: ["D"], useCalibration: false });
  const b = runBacktest(history, undefined, { strategies: ["D"], useCalibration: false });
  assert.deepEqual(a.strategyPeriods.D.metrics, b.strategyPeriods.D.metrics);
  assert.ok(a.strategyPeriods.D.records.length > 0);
});

test("clamp 工具函数", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});
