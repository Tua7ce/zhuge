import { writeFileSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
var __dirname = dirname(fileURLToPath(import.meta.url));
var D = join(__dirname, "..", "src", "data");
var F = join(D, "history.json");
var API = "https://history.macaumarksix.com/history/macaujc2/y/2026";
var TC = {"馬":"马","龍":"龙","雞":"鸡","豬":"猪"};
async function main() {
  console.log("Fetching...");
  var resp = await fetch(API);
  var j = await resp.json();
  if (!j || !j.data) throw Error("bad API");
  var data = j.data.filter(function(d){return String(d.expect).startsWith("2026");});
  var seen={};data=data.filter(function(d){if(seen[d.expect])return false;seen[d.expect]=true;return true;});
  data.sort(function(a,b){return +a.expect - +b.expect;});
  var hist = data.map(function(d){
    var ns = d.openCode.split(",").map(Number);
    var zs = d.zodiac.split(",").map(function(s){return TC[s]||s;});
    return {issue:+d.expect,date:(d.openTime||"").split(" ")[0],numbers:ns,zodiacs:zs,time:d.openTime||""};
  });
  writeFileSync(F, JSON.stringify(hist,null,2), "utf-8");
  console.log("Saved " + hist.length + " periods");
}
main().catch(function(e){
  console.error("Fetch failed: "+e.message);
  if (existsSync(F)) {
    var c = JSON.parse(readFileSync(F,"utf-8"));
    console.log("Using cache: "+c.length+" periods");
  } else { writeFileSync(F,"[]","utf-8"); }
});
