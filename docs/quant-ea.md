# BCA Quant EA

一条可回测、可 paper 交易、成本可对账的加密量化执行体，建在 BCA 的工具层之上。

> **先读这一段**：本项目**不承诺盈利**。仓库里的策略是「有时序动量证据、低换手、成本敏感」的候选方案，不是收益保证。任何声称稳定盈利的 EA 都值得怀疑。是否真的赚钱，只能在**真实历史数据的样本外**上验证，而且过去赚钱也不代表未来赚钱。

## 1. 它解决什么问题

回测赚钱、实盘亏钱，绝大多数不是信号问题，而是**成本没算全**：手续费、点差、滑点/冲击、资金费率、gas、MEV、失败交易、以及查数据本身的 API 成本。

这个 EA 把成本当成一等公民：

- 每笔成交都按「单边手续费 + 单边滑点」扣成本，台账分项可查；
- 决策在**收盘**、成交在**次日开盘**，不做「当根 K 线收盘价成交」这种前视；
- 期末强制平仓，PnL 全部落地，不留浮盈美化；
- 报告同时给出 `成本合计` 与 `占初始资金比例`，方便判断策略是不是在给交易所打工。

## 2. 架构

```
src/quant/
  data.ts        CCXT 多交易所兜底 + 磁盘缓存（okx → kraken → coinbase）
  bca-source.ts  直接复用仓库 ccxt_ohlcv 工具（PR #19），与 MCP 走同一套路由与错误信封
  csv.ts         任意 OHLCV CSV 导入（交易所导出 / TradingView / Dune）
  indicators.ts  SMA / stdev / ATR / Donchian / RSI
  costs.ts       成本模型 + 用真实订单簿估算冲击成本
  strategies.ts  tsmom（时序动量+波动率目标）/ donchian（通道突破）/ meanrev（均值回归）
  engine.ts      组合回测：次日开盘成交、免交易带、成本台账、指标
  walkforward.ts 样本内选参 → 样本外验证
  paper.ts       paper 交易状态机（跨周期挂单、熔断、状态持久化）
  report.ts      HTML 报告（净值、回撤、月度收益、成本、成交）
  cli.ts         命令行入口
scripts/check-quant.ts  引擎自检（7 项）
scripts/fetch-binance-archive.sh  公开归档日线下载（绕开交易所 API 地域限制）
```

## 3. 数据源

| source | 说明 | 用途 |
| --- | --- | --- |
| `bca` | 调用仓库内 `ccxt_ohlcv` 工具，复用 PR #19 的多交易所兜底与结构化错误 | 默认，和 MCP 工具同一实现 |
| `ccxt` | 直接用 ccxt 拉取并缓存到 `.quant/cache` | 离线复用缓存 |
| `csv` | `--csv a.csv,b.csv,c.csv` 导入任意 OHLCV，多标的按逗号分隔（标的名从文件名推断） | 网络受限时最实用，也是当前真实回测所用通道 |
| `synthetic` | 确定性合成行情（牛熊切换 + 波动聚集） | **只用于验证引擎，不是收益证据** |

## 4. 成本与风控口径

默认成本（`quant.config.json`，可改）：

- 手续费 `15 bps/边`（交易所公开 taker 费率量级）
- 滑点 `3 bps/边`（保守估计，可用真实订单簿标定）
- 数据成本 `$0.000878/次`（BCA credits 估算）

风控：

- 单资产权重上限 `maxWeight`，组合总仓位上限 `maxGross`；
- 波动率目标 `targetVol`：波动越高、仓位越小；
- 免交易带：相对偏离不足 20% 且绝对额不足资金 1% 不动，避免为微小偏离付手续费；
- paper 熔断：回撤超过 `risk.maxDrawdownStop`（默认 25%）强制清仓并停止开新仓；
- 全部工具只读行情，**不加载交易凭据、不下单**。

## 5. 用法

```bash
npm run quant -- doctor                 # 检查数据通道与成本口径
npm run quant -- fetch                  # 拉取并缓存真实 K 线
npm run quant -- backtest               # 回测，输出 JSON + HTML
npm run quant -- walkforward            # 样本内选参 + 样本外验证
npm run quant -- paper                  # 跑一个 paper 周期（状态落盘，不碰真钱）
npm run quant -- backtest --csv data/btc.csv --symbols BTC/USDT
npm run quant -- backtest --csv data/btc.csv,data/eth.csv,data/sol.csv   # 多标的组合
npm run check:quant                     # 引擎自检

scripts/fetch-binance-archive.sh        # 下载 Binance 公开归档日线 → CSV（无需 API Key）
```

常用参数：`--source bca|ccxt|synthetic`、`--strategy tsmom|donchian|meanrev`、`--symbols BTC/USDT,ETH/USDT`、`--limit 1200`、`--csv <path[,path...]>`。

产物在 `.quant/out/`：`backtest-*.json`（机器可读）、`backtest-*.html`（人工看）。paper 状态在 `.quant/state.json`。

## 6. 当前验证状态（已用真实历史数据跑过）

数据：Binance 公开归档（`data.binance.vision`）现货日线，`BTCUSDT` / `ETHUSDT` / `SOLUSDT`。
三品种按时间取交集后为 **2020-08-11 → 2025-11-30，共 1937 天**（SOL 上市晚，是对齐后的起点）。
成本：手续费 15 bps/边 + 滑点 3 bps/边 + 数据 API 成本，全部计入净值。

### 6.1 全区间回测（已扣成本）

| 策略 | 年化 | 年化波动 | Sharpe | 最大回撤 | 笔数 | 成本合计（占初始资金） |
| --- | --- | --- | --- | --- | --- | --- |
| tsmom（动量 + 波动率目标） | **34.0%** | 31.9% | **1.08** | -32.0% | 174 | $19,197（19.2%） |
| donchian（通道突破） | 8.3% | 54.3% | 0.42 | -50.7% | 74 | $4,122（4.1%） |
| meanrev（均值回归） | 8.7% | 32.5% | 0.42 | -38.9% | 267 | $26,514（26.5%） |

`tsmom` 全区间 19.2% 的成本 ≈ 每年 3.6%，这就是「回测赚钱实盘亏钱」最常丢掉的那部分。

### 6.2 样本内选参 → 样本外验证（split = 2024-04-27，OOS 582 天）

| 策略 | 选中参数（按 IS Sharpe） | IS Sharpe | **OOS Sharpe** | OOS 年化 | OOS 最大回撤 |
| --- | --- | --- | --- | --- | --- |
| tsmom | `lookback=30, targetVol=0.25` | 1.69 | **+0.42** | +8.2% | -24.0% |
| donchian | `lookback=60, targetVol=0.15` | 0.68 | **+1.01** | +31.6% | -22.9% |
| meanrev | `lookback=30, targetVol=0.15` | 0.45 | **-0.18** | -9.4% | -36.7% |

### 6.3 怎么读这些数字

- **tsmom 的 12 组参数样本外全部为正**（OOS Sharpe 0.34–0.58），说明动量信号在这段样本外不依赖某个特定参数；但 IS 挑出来的最优组合（0.42）并不是 OOS 最优（`lookback=60, targetVol=0.20` 为 0.58），说明**参数选择本身不稳定**，应按 OOS 区间表现取稳健区间而非最优点。
- **donchian 选中的参数 OOS 1.01、回撤仅 -22.9%**，全区间却只有 0.42，说明它吃的是 2024-2025 这段趋势；`lookback=120` 的 OOS 掉到 0.06，**参数敏感性很高**，不要只信一个点。
- **meanrev 样本外为负**，在所有参数下一致为负 —— 直接淘汰，保留在代码里作为负对照（能跑出负结果，才说明这套引擎不是「什么都赚」）。
- **诚实边界**：三套策略 × 12 组参数都是在**同一段样本外**上比较的，所以这些 OOS 数字对「策略/参数选择」这一步已不再是干净的样本外。真正的新样本外只能靠向前推进的 paper / 实盘累积。

### 6.4 仍然未验证的部分

| 项 | 状态 |
| --- | --- |
| 引擎自检 | **7/7 PASS**（含前视检验：篡改未来价格不影响历史净值） |
| 真实数据回测 / 样本外 | **已完成**（上表），数据来源为交易所公开归档 |
| 交易所实时 API 通道 | 本机网络对 okx / kraken / coinbase / binance API 全部不可达（DNS/TLS 失败），`--source bca|ccxt` 未能在本机跑通；已用归档数据绕开 |
| 资金费率 / 永续合约 | 未建模（当前为现货只做多） |
| 实盘下单 | 未接入，只有 paper |

**结论口径**：可以说的是一句有边界的话 ——「在 2020-08 至 2025-11 的 Binance 现货日线上、扣掉 15+3 bps 双边成本后，动量与通道突破两类策略的样本外 Sharpe 为正（0.4–1.0 量级），均值回归为负」。不能说「这个 EA 会赚钱」。

## 7. 复现与下一步验证

```bash
# 1) 取真实历史数据（走公开归档，不需要 API Key，不受 API 451 影响）
SYMBOLS="BTCUSDT ETHUSDT SOLUSDT" START=2019-01 END=2025-11 OUT=.quant/data \
  bash scripts/fetch-binance-archive.sh

# 2) 回测（多标的用逗号分隔，标的名从文件名推断）
npm run quant -- backtest --csv .quant/data/BTCUSDT-1d.csv,.quant/data/ETHUSDT-1d.csv,.quant/data/SOLUSDT-1d.csv --strategy tsmom

# 3) 样本外验证
npm run quant -- walkforward --csv .quant/data/BTCUSDT-1d.csv,.quant/data/ETHUSDT-1d.csv,.quant/data/SOLUSDT-1d.csv --strategy tsmom
```

再往下：

1. 把 `quant.config.json` 的手续费改成你账户的真实 VIP 费率再跑一遍；收益消失 = 策略在赚手续费假设的钱。
2. 换更长历史 / 更多标的（`SYMBOLS="BTCUSDT ETHUSDT BNBUSDT XRPUSDT"`）看结论是否还在。
3. 用 `--source bca` 在可访问交易所的网络（或设 `BCA_CCXT_PROXY`）跑一次，确认实时通道与归档数据结论一致。
4. 通过后先跑 paper（`npm run quant -- paper`）至少 4–8 周，对比 paper 与回测的滑点差异，再谈实盘。


## 8. 部署

- Windows：任务计划程序，每天 UTC 00:05 执行 `npm run quant -- paper`；
- Linux：cron `5 0 * * * cd /path/to/repo && npm run quant -- paper >> .quant/paper.log 2>&1`；
- 每次运行只处理一根新 K 线，重复运行是幂等的（没有新 K 线就不成交）；
- 状态文件建议纳入备份；不要把它提交进仓库（`.quant/` 已在 `.gitignore`）。

## 9. 已知限制

- 只做多 / 空仓（spot 语义），不做空、不做杠杆；
- 日频，不处理分钟级执行与排队；
- 未接入资金费率（现货无资金费；做永续需扩展成本模型）；
- 未接入真实下单接口，paper 成交按次日开盘价 + 成本模拟；
- 合成数据只用于引擎验证，不能用于选参。

## 10. 边界

本模块不含投资建议。加密资产波动极大，任何策略都可能出现超过回测最大回撤的亏损。请只用可承受损失的资金，并在实盘前完成独立的样本外验证。
