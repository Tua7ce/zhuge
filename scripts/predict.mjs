import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { MODEL_CONFIG } from "./model-config.mjs";
import { computeAll } from "./backtest.mjs";

const D = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data");
const HIST = join(D, "history.json");
const PRED = join(D, "predictions.json");
const BACKTEST = join(D, "backtest.json");
const PHR = join(D, "prediction-history.json");

function main() {
  const history = JSON.parse(readFileSync(HIST, "utf-8"));
  if (!history.length) {
    writeFileSync(PRED, JSON.stringify({ error: "no_data", generated_at: new Date().toISOString() }), "utf-8");
    console.log("No data");
    return;
  }
  const all = computeAll(history, MODEL_CONFIG);
  writeFileSync(PRED, JSON.stringify(all.predictions, null, 2), "utf-8");
  writeFileSync(BACKTEST, JSON.stringify(all.backtest, null, 2), "utf-8");
  writeFileSync(PHR, JSON.stringify(all.predictionHistory, null, 2), "utf-8");
  const top = all.predictions.topNumbers[0];
  console.log(`Predictions saved for issue ${all.predictions.nextIssue}; top number ${String(top.number).padStart(2, "0")} (${top.zodiac})`);
}

main();
