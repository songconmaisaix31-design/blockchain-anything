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
```

## 3. 数据源

| source | 说明 | 用途 |
| --- | --- | --- |
| `bca` | 调用仓库内 `ccxt_ohlcv` 工具，复用 PR #19 的多交易所兜底与结构化错误 | 默认，和 MCP 工具同一实现 |
| `ccxt` | 直接用 ccxt 拉取并缓存到 `.quant/cache` | 离线复用缓存 |
| `csv` | `--csv path.csv` 导入任意 OHLCV | 网络受限时最实用 |
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
npm run quant -- backtest --csv data/btc.csv --symbol BTC/USDT
npm run check:quant                     # 引擎自检
```

常用参数：`--source bca|ccxt|synthetic`、`--strategy tsmom|donchian|meanrev`、`--symbols BTC/USDT,ETH/USDT`、`--limit 1200`、`--csv <path>`。

产物在 `.quant/out/`：`backtest-*.json`（机器可读）、`backtest-*.html`（人工看）。paper 状态在 `.quant/state.json`。

## 6. 当前验证状态（务必看清）

| 项 | 状态 |
| --- | --- |
| 引擎自检 | **7/7 PASS** —— 含「篡改未来价格不影响历史净值」的前视检验、成本单调性、期末清仓、确定性、仓位上限、台账自洽、paper 跨周期成交 |
| 真实数据回测 | **未完成**：当前环境所有交易所公开端点（okx / kraken / coinbase / binance / coingecko）均不可达，DNS 与 TLS 均失败 |
| 合成数据回测 | 可运行，但**结果不构成盈利证据**；合成行情没有可利用的真实 edge，跑出负收益是正常的 |

所以：**没有真实数据的样本外结果之前，不要下「这个 EA 能赚钱」的结论。**

## 7. 拿到真实数据后怎么验证

1. 换一台能访问交易所的网络，或设置 `BCA_CCXT_PROXY`。
2. `npm run quant -- doctor`，确认至少一家交易所返回 K 线。
3. `npm run quant -- backtest --source bca --strategy tsmom`，看**成本占比**与**最大回撤**，不要只看年化。
4. `npm run quant -- walkforward --source bca`，以**样本外 Sharpe** 为准。样本内很好、样本外崩掉，就是过拟合。
5. 在 `quant.config.json` 里把手续费改成你账户的真实 VIP 费率，再跑一遍；如果收益消失，说明策略在赚「手续费假设」的钱。
6. 通过后先跑 paper（`npm run quant -- paper`）至少 4–8 周，对比 paper 与回测的滑点差异，再谈实盘。

没有网络时，用 `--csv` 导入任意来源的历史数据同样可以完成 3–6 步。

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
