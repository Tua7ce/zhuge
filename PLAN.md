# 六合彩特码预测分析网站 — 实现大纲

> 生成日期：2026-07-29

---

## 一、项目概况

构建一个纯静态预测分析网站，部署在 **Vercel**，通过 **GitHub Actions** 实现每日自动拉取数据 + 运行预测 + 触发生成新页面。前端用 **Astro** 输出静态 HTML，图表用 **ECharts**，预测脚本用 **Python**。

---

## 二、核心架构与数据流

```
外部API ──→ fetch_data.py ──→ public/data/history.json
                                         │
                                         ▼
                                  predict.py
                                         │
                                         ▼
                              public/predictions/result.json
                                         │
                                         ▼
                              Astro 构建 → 静态页面
```

- `fetch_data.py`：拉取API数据 → 去重 → 写入 `history.json`
- `predict.py`：读取 `history.json` → 三模型评分 → 综合 → 写入 `result.json`
- Astro 构建时读取上述两个 JSON → 渲染静态页面
- GitHub Actions 每天 UTC 18:00（北京时间凌晨2点）执行：拉取 → 预测 → commit → 触发 Vercel 重新构建

---

## 三、目录结构（建议）

```
/
├── public/
│   ├── data/history.json          # 原始历史数据（由 fetch 生成）
│   └── predictions/result.json    # 预测结果数据（由 predict 生成）
├── scripts/
│   ├── fetch_data.py              # 数据拉取
│   ├── predict.py                 # 预测算法（核心）
│   ├── zodiac.py                  # 生肖映射工具函数
│   └── config.py                  # 配置常量
├── src/
│   ├── pages/
│   │   ├── index.astro            # 首页（推荐 + 命中率）
│   │   └── charts.astro           # 图表页（走势 + 频率分布）
│   └── components/
│       ├── Recommendation.astro   # 推荐卡片组件
│       ├── HistoryTable.astro     # 开奖记录表格
│       └── Chart.astro            # ECharts 图表封装
├── .github/workflows/
│   └── update-data.yml            # 每日更新流水线
├── astro.config.mjs
├── package.json
├── requirements.txt               # Python 依赖
└── PLAN.md                        # 本文件
```

---

## 四、算法设计（最优先）

### 4.1 数据准备

从 `history.json` 提取特码号码（`special_number`），共 N 期。自动计算生肖映射（2026马年）。

### 4.2 三个评分模型

#### 模型 A：频率 + 遗漏分析（权重 40%）

| 子项 | 权重 | 说明 |
|------|------|------|
| 总频次分 | 40% | 归一化历史总出现次数 |
| 近50期频次分 | 30% | 近期出现趋势，加权更敏感 |
| 遗漏值分 | 30% | 当前连续未出现期数，遗漏越大分越高 |

综合公式：
```
A_score[i] = (freq_all[i]/max_freq_all) * 0.4 
           + (freq_recent[i]/max_freq_recent) * 0.3 
           + (omission[i]/max_omission) * 0.3
```

#### 模型 B：规则筛选（权重 20%）

基于 A 的候选池，按以下规则过滤/加分：

- **奇偶比**：近10期奇偶分布，倾向冷出的奇偶类别
- **大小比**：大数(25-49) vs 小数(1-24)，倾向冷出的大小区间
- **和值范围**：上期特码 +/- 一定范围（±6、±12等）

规则分 = 满足规则的比例 * 权重系数

#### 模型 C：一阶马尔可夫链（权重 40%）

- 构建 **49×49** 转移矩阵：`P[i→j] = count(i→j) / count(i→*)`
- 基于上一期特码 `prev_special`，查找 `P[prev_special][j]` 最高的数字
- 同样构建 **12×12** 生肖转移矩阵

```
C_score[i] = P[prev_special][i]  (归一化后)
```

### 4.3 综合评分

```
final_score[i] = A_score[i] * 0.40 + B_score[i] * 0.20 + C_score[i] * 0.40
```

输出：
- **纯数字推荐（Top 8）**：final_score 最高的8个数字
- **生肖推荐（Top 5）**：按所属生肖聚合分数，最高的5个生肖
- **3生肖+3数字、4生肖+4数字、5生肖+5数字**：生肖内取最高分数字配对
- **最佳推荐**：final_score 最高的1个数字

### 4.4 特码命中验证

每次新一期开奖后，对比推荐结果 vs 实际开奖：

```
命中率 = 命中次数 / 总推荐期数
```

记录在 `predictions/accuracy.json` 中。

---

## 五、前端展示（Astro 静态页面）

### 首页 `index.astro`

1. **顶部信息栏**：最新期号、数据范围、更新日期
2. **今日推荐卡片**：
   - 大号字体展示最佳推荐数字+生肖
   - 纯数字 Top 8（带生肖标注）
   - 生肖组合推荐（3+3 / 4+4 / 5+5）
3. **命中率追踪**：近N期的预测 vs 实际对比
4. **免责声明**：赌博违法，仅供参考

### 图表页 `charts.astro`

1. **特码走势图**（折线图）：近50期特码数字走势
2. **频率分布图**（柱状图）：1-49 每个数字的历史出现频次
3. **生肖分布图**（饼图/柱状图）：12生肖出现次数
4. **转移热力图**（可选）：上一期特码 → 本期特码的转移概率矩阵

### 开奖记录页（可合并到首页或 charts 页）

- 近期10期开奖详情表格
- 期号搜索、生肖筛选

---

## 六、GitHub Actions 流水线

```yaml
name: 每日数据更新

on:
  schedule:
    - cron: '0 18 * * *'   # UTC 18:00 = 北京时间 02:00
  workflow_dispatch:        # 可手动触发

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup-python
      - pip install -r requirements.txt
      - python scripts/fetch_data.py
      - python scripts/predict.py
      - git add public/data/ public/predictions/
      - git commit -m "每日数据更新 $(date +'%Y-%m-%d')"
      - git push  # 自动触发 Vercel 重新构建
```

---

## 七、部署方案（Vercel）

- 连接 GitHub 仓库
- 框架预设选择 Astro
- 构建命令：`npm run build`（Astro 输出到 `dist/`）
- 输出目录：`dist`
- 无需服务端运行时，纯静态文件

---

## 八、待确认的需求（需要你回答）

> 以下是我需要你明确的几个关键决策点，请逐条告诉我你的想法，或者直接选择选项。

### Q1：预测范围——只预测下一期，还是多期？

- A：只预测最新一期（昨天开奖→预测今天）
- **B：预测最近 3 期**（覆盖未来几天）
- C：其他（请说明）

### Q2：推荐数量——每种类别推荐几个？

- **A：纯数字 Top 8，3+3/4+4/5+5 各一组**（和上次一致）
- B：纯数字 Top 10，其他固定不变
- C：我自己想好再告诉你

### Q3：历史数据范围——用多少期数据训练模型？

- A：**全部 2026 年数据**（约 200+ 期）
- B：仅最近 100 期
- C：全部历史（含往年）

### Q4：图表需求——需要哪些图？

- A：**仅走势图 + 频率分布图**（简洁）
- B：走势图 + 频率分布 + 生肖分布 + 转移热力图（详细）
- C：你看着加，好看就行

### Q5：玄学/特殊规则——要不要保留任何规则型筛选逻辑？

- A：**不要**，纯概率统计（频率 + Markov）
- B：加上简单的奇偶/大小规律
- C：加上更多规则（间隔、波色、单双等）

### Q6：Astro 经验——你熟悉 Astro 吗？

- A：**熟悉，直接用**
- B：不太了解，尽量简洁，少用高级特性
- C：没概念，你决定

---

## 九、分期实施建议

| 阶段 | 内容 | 预估工作量 |
|------|------|-----------|
| **Phase 1** | Python 脚本：zodiac.py + fetch_data.py + predict.py | 高优先级 |
| **Phase 2** | Astro 前端页面 + 组件 | 中优先级 |
| **Phase 3** | GitHub Actions + Vercel 部署 | 中优先级 |
| **Phase 4** | ECharts 图表 + 命中率追踪 | 低优先级（可迭代） |

---

*此文档为规划文档，等你明确 Q1-Q6 后，我会生成完整代码。*
