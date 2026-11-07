import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEFAULT_COST_MODEL, roundTripBps } from './costs.js';
import { loadCsvSeries } from './csv.js';
import { fetchSeriesViaBca } from './bca-source.js';
import { alignSeries, fetchSeries, seriesHealth } from './data.js';
import { backtest, type Aligned } from './engine.js';
import { initialState, loadState, runPaperCycle, saveState } from './paper.js';
import { renderReport } from './report.js';
import { syntheticSeries } from './synthetic.js';
import { walkforward } from './walkforward.js';
import type { BacktestResult, CostModel, StrategyId, StrategyParams } from './types.js';

type Config = {
  symbols: string[];
  strategy: StrategyId;
  capital: number;
  timeframe: string;
  source: 'bca' | 'ccxt' | 'synthetic';
  exchange?: string;
  limit: number;
  cacheDir: string;
  outputDir: string;
  statePath: string;
  params: StrategyParams;
  costs: CostModel;
  risk: { maxDrawdownStop: number };
};

const DEFAULTS: Config = {
  symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
  strategy: 'tsmom',
  capital: 100_000,
  timeframe: '1d',
  source: 'ccxt',
  limit: 1200,
  cacheDir: '.quant/cache',
  outputDir: '.quant/out',
  statePath: '.quant/state.json',
  params: {
    lookback: 60, exitLookback: 20, volWindow: 30, targetVol: 0.2,
    maxWeight: 0.5, maxGross: 1.0, rebalanceDays: 5, regimeSma: 200,
  },
  costs: DEFAULT_COST_MODEL,
  risk: { maxDrawdownStop: 0.25 },
};

function loadConfig(path = 'quant.config.json'): Config {
  const file = resolve(path);
  if (!existsSync(file)) return DEFAULTS;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
  return {
    ...DEFAULTS, ...raw,
    params: { ...DEFAULTS.params, ...(raw.params ?? {}) },
    costs: { ...DEFAULTS.costs, ...(raw.costs ?? {}) },
    risk: { ...DEFAULTS.risk, ...(raw.risk ?? {}) },
  };
}

function flags(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i += 1; } else out[key] = 'true';
  }
  return out;
}

/** 从文件名推断标的：BTCUSDT-1d.csv → BTCUSDT，BTC_USDT.csv → BTC/USDT。 */
export function csvSymbolOf(path: string): string {
  const bare = path.replace(/^.*[\\/]/, '').replace(/\.csv$/i, '');
  const head = bare.split('-')[0] ?? bare;
  return /^[A-Za-z]{2,10}_[A-Za-z]{2,10}$/.test(head) ? head.toUpperCase().replace('_', '/') : head.toUpperCase();
}

async function buildAligned(config: Config, refresh: boolean, csvPath?: string): Promise<Aligned> {
  if (csvPath) {
    // --csv 支持逗号分隔的多个文件，按顺序对应 --symbols；未给 --symbols 时用文件名推断。
    const paths = csvPath.split(',').map((p) => p.trim()).filter(Boolean);
    const series = paths.map((path, i) => loadCsvSeries(path, config.symbols[i] ?? csvSymbolOf(path)));
    return alignSeries(series);
  }
  if (config.source === 'synthetic') {
    const series = syntheticSeries({ symbols: config.symbols, days: config.limit });
    return alignSeries(series);
  }
  const series = [];
  for (const symbol of config.symbols) {
    const one = config.source === 'bca'
      ? await fetchSeriesViaBca({ symbol, timeframe: config.timeframe, limit: config.limit, exchange: config.exchange })
      : await fetchSeries({
        symbol, timeframe: config.timeframe, limit: config.limit,
        exchange: config.exchange, cacheDir: config.cacheDir, refresh,
      });
    series.push(one);
  }
  return alignSeries(series);
}

function summarise(result: BacktestResult, source: string) {
  const m = result.metrics;
  return [
    `数据源       ${source}`,
    `区间         ${m.start} → ${m.end}（${m.days} 天）`,
    `年化收益     ${(m.cagr * 100).toFixed(2)}%`,
    `年化波动     ${(m.vol * 100).toFixed(2)}%`,
    `夏普 / Sortino ${m.sharpe.toFixed(2)} / ${m.sortino.toFixed(2)}`,
    `最大回撤     ${(m.maxDrawdown * 100).toFixed(2)}%`,
    `Calmar       ${m.calmar.toFixed(2)}`,
    `胜率 / 笔数   ${(m.winRate * 100).toFixed(0)}% / ${m.tradeCount}`,
    `平均仓位     ${(m.avgExposure * 100).toFixed(0)}%`,
    `成本合计     $${result.ledger.totalUsd.toFixed(0)}（占初始资金 ${(result.ledger.dragPct * 100).toFixed(2)}%）`,
  ].join('\n');
}

async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const opts = flags(rest);
  const config = loadConfig(opts.config ?? 'quant.config.json');
  if (opts.strategy) config.strategy = opts.strategy as StrategyId;
  if (opts.source) config.source = opts.source as Config['source'];
  if (opts.symbols) config.symbols = opts.symbols.split(',').map((s) => s.trim()).filter(Boolean);
  if (opts.csv && !opts.symbols) {
    config.symbols = opts.csv.split(',').map((p) => p.trim()).filter(Boolean).map(csvSymbolOf);
  }
  if (opts.limit) config.limit = Math.max(60, Number(opts.limit));
  mkdirSync(config.outputDir, { recursive: true });

  if (command === 'doctor') {
    console.log(`数据源模式：${config.source}`);
    console.log(`成本口径：单边 ${config.costs.feeBps} bps 手续费 + ${config.costs.slippageBps} bps 滑点，往返 ${roundTripBps(config.costs)} bps`);
    if (config.source === 'synthetic') {
      console.log('当前为合成数据，仅用于验证引擎；真实回测请加 --source ccxt。');
      return;
    }
    for (const symbol of config.symbols) {
      try {
        const series = config.source === 'bca'
          ? await fetchSeriesViaBca({ symbol, timeframe: config.timeframe, limit: 120, exchange: config.exchange })
          : await fetchSeries({ symbol, timeframe: config.timeframe, limit: 120, cacheDir: config.cacheDir });
        console.log(`✓ ${symbol}  ${series.exchange}  ${seriesHealth(series).bars} 根`);
      } catch (error) {
        console.log(`✗ ${symbol}  ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    console.log('\n若全部失败：当前网络无法访问交易所公开端点。可设置 BCA_CCXT_PROXY，或换一台可访问 okx / kraken / coinbase 的机器再跑真实回测。');
    return;
  }

  if (command === 'fetch') {
    for (const symbol of config.symbols) {
      const series = await fetchSeries({
        symbol, timeframe: config.timeframe, limit: config.limit,
        exchange: config.exchange, cacheDir: config.cacheDir, refresh: opts.refresh === 'true',
      });
      console.log(JSON.stringify(seriesHealth(series)));
    }
    return;
  }

  if (command === 'backtest') {
    const aligned = await buildAligned(config, opts.refresh === 'true', opts.csv);
    const result = backtest({
      strategy: config.strategy, params: config.params, symbols: config.symbols,
      aligned, capital: config.capital, costs: config.costs,
      apiCalls: config.symbols.length * 2 + 2, dataSource: opts.csv ? 'csv' : config.source,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(config.outputDir, `backtest-${config.strategy}-${stamp}.json`);
    writeFileSync(jsonPath, JSON.stringify(result, null, 2));
    const dataSourceLabel = opts.csv ? 'csv' : config.source === 'synthetic' ? 'synthetic' : `ccxt/${config.exchange ?? 'auto'}`;
    const htmlPath = join(config.outputDir, `backtest-${config.strategy}-${stamp}.html`);
    writeFileSync(htmlPath, renderReport({ result }, {
      dataSource: dataSourceLabel,
      exchange: config.exchange,
      warnings: config.source === 'synthetic' && !opts.csv
        ? ['合成数据结果不能用于判断策略是否盈利；请用真实数据重跑。']
        : [],
    }));
    console.log(summarise(result, dataSourceLabel));
    console.log(`\nJSON  ${jsonPath}\nHTML  ${htmlPath}`);
    return;
  }

  if (command === 'walkforward') {
    const aligned = await buildAligned(config, opts.refresh === 'true', opts.csv);
    const wf = walkforward({
      strategy: config.strategy, base: config.params, aligned, symbols: config.symbols,
      capital: config.capital, costs: config.costs, apiCalls: config.symbols.length * 2 + 2,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const htmlPath = join(config.outputDir, `walkforward-${config.strategy}-${stamp}.html`);
    writeFileSync(htmlPath, renderReport({ walkforward: wf }, {
      dataSource: opts.csv ? 'csv' : config.source === 'synthetic' ? 'synthetic' : `ccxt/${config.exchange ?? 'auto'}`,
    }));
    writeFileSync(join(config.outputDir, `walkforward-${config.strategy}-${stamp}.json`), JSON.stringify(wf, null, 2));
    for (const cell of wf.cells) {
      console.log(JSON.stringify(cell.params), 'IS', cell.isSharpe.toFixed(2), 'OOS', cell.oosSharpe.toFixed(2));
    }
    console.log('\n' + wf.note);
    console.log(`HTML  ${htmlPath}`);    return;
  }

  if (command === 'paper') {
    const aligned = await buildAligned(config, opts.refresh === 'true', opts.csv);
    const state = loadState(config.statePath) ?? initialState({
      strategy: config.strategy, params: config.params, symbols: config.symbols, capital: config.capital,
    });
    const cycle = runPaperCycle({
      state, aligned, symbols: config.symbols, costs: config.costs,
      maxDrawdownStop: config.risk.maxDrawdownStop, apiCalls: config.symbols.length,
    });
    saveState(config.statePath, cycle.state);
    console.log(`paper 周期完成：净值 $${cycle.latest.equity.toFixed(2)}，本次成交 ${cycle.filled.length} 笔`);
    console.log(cycle.note);
    if (cycle.filled.length) {
      for (const trade of cycle.filled) {
        console.log(`  ${new Date(trade.t).toISOString().slice(0, 10)} ${trade.side === 'buy' ? '买入' : '卖出'} ${trade.symbol} ${trade.notional.toFixed(2)} @ ${trade.price} 成本 $${(trade.feeUsd + trade.slippageUsd).toFixed(2)}`);
      }
    }
    console.log(`状态  ${config.statePath}`);
    return;
  }

  console.log(`BCA Quant EA

用法：quant <命令> [--config quant.config.json] [--source ccxt|synthetic] [--strategy tsmom|donchian|meanrev]

  doctor       检查数据通道与成本口径
  fetch        拉取并缓存真实 K 线
  backtest     回测，输出 JSON + HTML 报告
  walkforward  样本内选参 + 样本外验证
  paper        跑一个 paper 交易周期（状态持久化，不接触真实资金）

默认成本：手续费 ${config.costs.feeBps} bps/边，滑点 ${config.costs.slippageBps} bps/边。
风险提示：任何策略都可能亏损，回测结果不代表未来收益。`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
