import { strict as assert } from 'node:assert';
import { DEFAULT_COST_MODEL } from '../src/quant/costs.js';
import { alignSeries } from '../src/quant/data.js';
import { backtest } from '../src/quant/engine.js';
import { initialState, runPaperCycle } from '../src/quant/paper.js';
import { syntheticSeries } from '../src/quant/synthetic.js';
import type { Bar, CostModel, StrategyParams } from '../src/quant/types.js';

const symbols = ['BTC/USDT', 'ETH/USDT'];
const params: StrategyParams = {
  lookback: 40, exitLookback: 15, volWindow: 20, targetVol: 0.2,
  maxWeight: 0.5, maxGross: 1.0, rebalanceDays: 5, regimeSma: 100,
};
const base = alignSeries(syntheticSeries({ symbols, days: 600, seed: 7 }));
let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

// 1) 前视偏差：篡改 cut 之后的所有价格，cut 之前的净值必须逐点一致。
check('无前视偏差：未来价格篡改不影响过去净值', () => {
  const cut = 400;
  const tampered = {
    timestamps: base.timestamps,
    bars: new Map([...base.bars].map(([symbol, bars]) => [symbol, bars.map((bar, i) => (
      i >= cut ? { ...bar, o: bar.o * 3, h: bar.h * 3, l: bar.l * 3, c: bar.c * 3 } : bar
    ))])),
  };
  const a = backtest({ strategy: 'tsmom', params, symbols, aligned: base, capital: 100_000, costs: DEFAULT_COST_MODEL });
  const b = backtest({ strategy: 'tsmom', params, symbols, aligned: tampered, capital: 100_000, costs: DEFAULT_COST_MODEL });
  for (let i = 0; i < cut; i += 1) {
    assert.ok(Math.abs(a.equity[i]!.equity - b.equity[i]!.equity) < 1e-6,
      `第 ${i} 点净值受未来数据影响：${a.equity[i]!.equity} vs ${b.equity[i]!.equity}`);
  }
});

// 2) 成本单调性：成本越高，期末净值越低。
check('成本单调性：手续费越高收益越低', () => {
  const cheap: CostModel = { ...DEFAULT_COST_MODEL, feeBps: 2, slippageBps: 1 };
  const expensive: CostModel = { ...DEFAULT_COST_MODEL, feeBps: 40, slippageBps: 25 };
  const a = backtest({ strategy: 'tsmom', params, symbols, aligned: base, capital: 100_000, costs: cheap });
  const b = backtest({ strategy: 'tsmom', params, symbols, aligned: base, capital: 100_000, costs: expensive });
  const last = (r: typeof a) => r.equity[r.equity.length - 1]!.equity;
  assert.ok(last(b) < last(a), `高成本期末 ${last(b)} 应低于低成本 ${last(a)}`);
  assert.ok(b.ledger.totalUsd > a.ledger.totalUsd, '高成本台账应更大');
});

// 3) 期末清仓后 gross 为 0，净值等于现金。
check('期末清仓：净值等于现金且无持仓', () => {
  const result = backtest({ strategy: 'donchian', params, symbols, aligned: base, capital: 50_000, costs: DEFAULT_COST_MODEL });
  const lastPoint = result.equity[result.equity.length - 1]!;
  assert.ok(Math.abs(lastPoint.equity - lastPoint.cash) < 1e-6, '期末净值应等于现金');
  assert.equal(lastPoint.gross, 0, '期末不应有持仓');
});

// 4) 确定性：同样输入两次结果完全一致。
check('确定性：相同输入输出一致', () => {
  const a = backtest({ strategy: 'meanrev', params, symbols, aligned: base, capital: 100_000, costs: DEFAULT_COST_MODEL });
  const b = backtest({ strategy: 'meanrev', params, symbols, aligned: base, capital: 100_000, costs: DEFAULT_COST_MODEL });
  assert.equal(a.equity[a.equity.length - 1]!.equity, b.equity[b.equity.length - 1]!.equity);
  assert.equal(a.metrics.tradeCount, b.metrics.tradeCount);
});

// 5) 仓位上限：任意时点 gross 不超过 maxGross 的 1.5 倍（价格漂移允许小幅越界）。
check('组合总仓位受 maxGross 约束', () => {
  const result = backtest({ strategy: 'tsmom', params, symbols, aligned: base, capital: 100_000, costs: DEFAULT_COST_MODEL });
  for (const point of result.equity) {
    if (point.equity <= 0) continue;
    assert.ok(point.gross / point.equity <= params.maxGross * 1.5 + 1e-9, `总仓位越界：${(point.gross / point.equity).toFixed(2)}`);
  }
});

// 6) 成本台账自洽。
check('成本台账：分项之和等于合计', () => {
  const result = backtest({ strategy: 'tsmom', params, symbols, aligned: base, capital: 100_000, costs: DEFAULT_COST_MODEL, apiCalls: 6 });
  const { ledger } = result;
  assert.ok(Math.abs(ledger.feesUsd + ledger.slippageUsd + ledger.apiUsd - ledger.totalUsd) < 1e-9);
  assert.ok(ledger.tradeCount > 0);
});

// 7) paper 状态机：第一轮生成目标，下一轮出现新 K 线后按开盘价成交。
check('paper 状态机：跨周期挂单并在新 K 线开盘成交', () => {
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < 320; i += 1) {
    const open = price;
    price = price * 1.002 * (1 + Math.sin(i) * 0.0008);
    bars.push({
      t: Date.UTC(2024, 0, 1) + i * 86_400_000,
      o: open, h: Math.max(open, price) * 1.001, l: Math.min(open, price) * 0.999, c: price, v: 1000,
    });
  }
  const full = { timestamps: bars.map((b) => b.t), bars: new Map([['BTC/USDT', bars]]) };
  const short = {
    timestamps: full.timestamps.slice(0, 319),
    bars: new Map([['BTC/USDT', bars.slice(0, 319)]]),
  };
  const paperParams: StrategyParams = { ...params, lookback: 20, regimeSma: 0, targetVol: 0.2, maxWeight: 0.5 };
  let state = initialState({ strategy: 'tsmom', params: paperParams, symbols: ['BTC/USDT'], capital: 100_000 });
  const first = runPaperCycle({ state, aligned: short, symbols: ['BTC/USDT'], costs: DEFAULT_COST_MODEL });
  state = first.state;
  assert.ok(state.pending.length > 0, '第一轮应生成 pending 目标');
  const second = runPaperCycle({ state, aligned: full, symbols: ['BTC/USDT'], costs: DEFAULT_COST_MODEL });
  assert.ok(second.filled.length > 0, '第二轮应在新 K 线开盘成交');
  assert.ok((second.state.positions[0]?.qty ?? 0) > 0, '应建立多头仓位');
  assert.ok(second.state.ledger.feesUsd > 0, '成交应计入手续费');
});

console.log(`\nquant 自检通过：${passed}/7`);
