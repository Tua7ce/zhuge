import os, re
d = r"C:\Users\zhouy\OneDrive\文档\跑马"

# Fix 1: fetch-data.mjs TC mapping (Traditional->Simplified Chinese)
fd = open(d + "/scripts/fetch-data.mjs", "r", encoding="utf-8")
c = fd.read()
fd.close()
c = c.replace('var TC = {"马":"马","龙":"龙","鸡":"鸡","猪":"猪"};', 'var TC = {"馬":"马","龍":"龙","雞":"鸡","豬":"猪"};')
c = c.replace('return{s:n,z:zs}', 'return{s:n,z:zs}')
# Also fix the second place where TC might appear
c = c.replace('{"马":"马","龙":"龙","鸡":"鸡","猪":"猪"}', '{"馬":"马","龍":"龙","雞":"鸡","豬":"猪"}')
fd = open(d + "/scripts/fetch-data.mjs", "w", encoding="utf-8")
fd.write(c)
fd.close()
print("Fixed TC mapping in fetch-data.mjs")

# Fix 2: index.astro - add set:html for number rendering
idx = open(d + "/src/pages/index.astro", "r", encoding="utf-8")
c = idx.read()
idx.close()

# Fix number rendering
c = c.replace('<div class=num-row>{hasData ? renderNums(tn) : "<p style=color:var(--text2);font-size:14px>暂无预测数据</p>"}</div>',
              '<div class=num-row set:html={hasData ? renderNums(tn) : "<p style=color:var(--text2);font-size:14px>暂无预测数据</p>"}></div>')

c = c.replace('{hasData&&z3.length>0?renderNums(z3):"<span style=color:var(--text2);font-size:13px>暂无</span>"}',
              '<Fragment set:html={hasData&&z3.length>0?renderNums(z3):"<span style=color:var(--text2);font-size:13px>暂无</span>"} />')

c = c.replace('{hasData&&z4.length>0?renderNums(z4):"<span style=color:var(--text2);font-size:13px>暂无</span>"}',
              '<Fragment set:html={hasData&&z4.length>0?renderNums(z4):"<span style=color:var(--text2);font-size:13px>暂无</span>"} />')

c = c.replace('{hasData&&z5.length>0?renderNums(z5):"<span style=color:var(--text2);font-size:13px>暂无</span>"}',
              '<Fragment set:html={hasData&&z5.length>0?renderNums(z5):"<span style=color:var(--text2);font-size:13px>暂无</span>"} />')

# Fix history table rendering
c = c.replace('{latest10.map(function(h){return"<tr>...</tr>"}).join("")}',
              '<Fragment set:html={latest10 && latest10.length > 0 ? latest10.map(function(h){var ns=h.numbers[6];var zs=h.zodiacs[6];var regBalls=h.numbers.slice(0,6).map(function(n,i){var c=nc[color(n)]||"#888";return"<span class=ball-sm style=background:"+c+">"+pad(n)+"</span>";}).join("");var specBall="<span class=ball-sm style=background:"+(nc[color(ns)]||"#888")+";border:2px solid var(--gold)>"+pad(ns)+"</span>";return"<tr><td>"+h.issue+"</td><td>"+h.date+"</td><td>"+regBalls+"</td><td>"+specBall+"<span class=zod-sm>"+zs+"</span></td></tr>";}).join("") : ""} />')

idx = open(d + "/src/pages/index.astro", "w", encoding="utf-8")
idx.write(c)
idx.close()
print("Fixed index.astro templates")

print("Rebuilding...")
