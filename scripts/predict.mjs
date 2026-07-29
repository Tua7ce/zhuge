import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ZODIAC_NAMES, ZODIAC_TO_NUMBERS, getZodiac, getSize, getColor } from "./zodiac.mjs";

var __dirname = dirname(fileURLToPath(import.meta.url));
var D = join(__dirname, "..", "src", "data");
var HIST = join(D, "history.json");
var PRED = join(D, "predictions.json");

var history = JSON.parse(readFileSync(HIST, "utf-8"));
if (history.length === 0) {
  writeFileSync(PRED, JSON.stringify({error:"no_data",generated_at:new Date().toISOString()}), "utf-8");
  console.log("No data"); process.exit(0);
}

var specials = history.map(function(h){return h.numbers[6];});
var last = specials[specials.length - 1];
var total = history.length;
var latestIssue = history[history.length - 1].issue;
var nextIssue = latestIssue + 1;

// === Scoring 1: Frequency (total) ===
var freqT={};for(var n=1;n<=49;n++)freqT[n]=0;
specials.forEach(function(s){freqT[s]++;});
var maxFT = Math.max.apply(null, Object.values(freqT));

// === Scoring 2: Frequency (last 50) ===
var recent = specials.slice(-50);
var freqR={};for(var n=1;n<=49;n++)freqR[n]=0;
recent.forEach(function(s){freqR[s]++;});
var maxFR = Math.max.apply(null, Object.values(freqR));

// === Scoring 3: Omission ===
var omit={};
for(var n=1;n<=49;n++){
  var idx=-1;for(var i=specials.length-1;i>=0;i--){if(specials[i]===n){idx=i;break;}}
  omit[n]=idx>=0?specials.length-1-idx:specials.length;
}
var maxOmit = Math.max.apply(null, Object.values(omit));

// === Scoring 4: Zodiac Markov (12x12) ===
var prevZ=getZodiac(last);
var zodMk={};ZODIAC_NAMES.forEach(function(z){zodMk[z]=1;});
var zodTotal=12;
for(var i=0;i<specials.length-1;i++){
  var from=getZodiac(specials[i]),to=getZodiac(specials[i+1]);
  if(from===prevZ){zodMk[to]++;zodTotal++;}
}
ZODIAC_NAMES.forEach(function(z){zodMk[z]/=zodTotal;});

// === Scoring 5: Zodiac frequency & omission ===
var zodF={};ZODIAC_NAMES.forEach(function(z){zodF[z]={freq:0};});
specials.forEach(function(s){zodF[getZodiac(s)].freq++;});
var maxZF = Math.max.apply(null, ZODIAC_NAMES.map(function(z){return zodF[z].freq;}));

var zodO={};
ZODIAC_NAMES.forEach(function(z){
  var idx=-1;for(var i=specials.length-1;i>=0;i--){if(getZodiac(specials[i])===z){idx=i;break;}}
  zodO[z]=idx>=0?specials.length-1-idx:specials.length;
});
var maxZO = Math.max.apply(null, Object.values(zodO));

// === Final scores: freqT*0.20 + freqR*0.15 + omit*0.20 + zodMk*0.15 + zodF*0.15 + zodO*0.15 ===
var scores={};
for(var n=1;n<=49;n++){
  var z=getZodiac(n);
  scores[n] = (freqT[n]/maxFT)*0.20 + (freqR[n]/maxFR)*0.15 + (omit[n]/maxOmit)*0.20 + zodMk[z]*0.15 + (zodF[z].freq/maxZF)*0.15 + (zodO[z]/maxZO)*0.15;
}

var sorted = Object.keys(scores).map(function(n){return{number:+n,score:scores[n],zodiac:getZodiac(+n),color:getColor(+n)};}).sort(function(a,b){return b.score-a.score;});
var top7 = sorted.slice(0,7);
var top10 = sorted.slice(0,10);

// Zodiac ranking
var zodRank = ZODIAC_NAMES.map(function(z){
  var nums=ZODIAC_TO_NUMBERS[z];var ts=0;nums.forEach(function(n){ts+=scores[n];});
  return{zodiac:z,score:ts/nums.length};
}).sort(function(a,b){return b.score-a.score;});

function bestNum(z){
  var nums=ZODIAC_TO_NUMBERS[z]||[];var best=null;
  nums.forEach(function(n){
    var sc=sorted.find(function(s){return s.number===n;});
    if(sc&&(!best||sc.score>best.score))best=sc;
  });
  return best;
}

var z3=zodRank.slice(0,3).map(function(z){return bestNum(z.zodiac);}).filter(function(x){return x;});
var z4=zodRank.slice(0,4).map(function(z){return bestNum(z.zodiac);}).filter(function(x){return x;});
var z5=zodRank.slice(0,5).map(function(z){return bestNum(z.zodiac);}).filter(function(x){return x;});

// === Budget Strategies ===
var STAKE=10, PAYOUT=47;
function calcStrat(budget,fz,extraN){
  var zList=zodRank.slice(0,fz).map(function(z){return z.zodiac;});
  var covered=[];
  zList.forEach(function(z){
    ZODIAC_TO_NUMBERS[z].forEach(function(n){if(covered.indexOf(n)<0)covered.push(n);});
  });
  var extra=0;
  sorted.forEach(function(s){
    if(extra>=extraN||covered.length>=49)return;
    if(covered.indexOf(s.number)<0){covered.push(s.number);extra++;}
  });
  while(covered.length<49&&covered.length*STAKE<budget){
    var found=false;
    sorted.forEach(function(s){
      if(covered.length*STAKE>=budget||covered.length>=49)return;
      if(covered.indexOf(s.number)<0){covered.push(s.number);found=true;}
    });
    if(!found)break;
  }
  var cost=covered.length*STAKE;
  return{cost:cost,nums:covered.length,prob:((covered.length/49)*100).toFixed(1),profit:PAYOUT*STAKE-cost,zodiacs:zList};
}

var budgets={};
[100,200,300,400].forEach(function(b){
  var ps=[];
  for(var fz=0;fz<=5;fz++){
    var costZ=fz*40;
    if(costZ<b)ps.push(calcStrat(b,fz,Math.floor((b-costZ)/STAKE)));
  }
  ps.sort(function(a,b2){return b2.nums-a.nums;});
  budgets[b]=ps.slice(0,5);
});

var output = {
  generated_at: new Date().toISOString(),
  nextIssue: nextIssue, latestIssue: latestIssue,
  totalPeriods: total, latestSpecial: last, latestZodiac: getZodiac(last),
  topNumbers: top7, topZodiacs: zodRank.slice(0,5),
  zodiacCombos: {"3zod3num":z3,"4zod4num":z4,"5zod5num":z5},
  budgetStrategies: budgets
};
writeFileSync(PRED, JSON.stringify(output,null,2), "utf-8");
console.log("Predictions saved for issue "+nextIssue);
