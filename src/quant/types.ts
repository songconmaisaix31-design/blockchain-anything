export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

export type Series = { symbol: string; exchange: string; timeframe: string; bars: Bar[] };

/** 单边成本口径。fee 与 slippage 都以 bps 计，回测和实盘共用同一套模型。 */
export type CostModel = {
  feeBps: number;
  slippageBps: number;
  apiCostUsdPerCall: number;
  note?: string;
};

export type StrategyId = 'tsmom' | 'donchian' | 'meanrev';

export type StrategyParams = {
  /** 动量回看天数 / 突破通道长度 */
  lookback: number;
  /** 退出通道长度（donchian 用） */
  exitLookback: number;
  /** 波动率估计窗口 */
  volWindow: number;
  /** 年化目标波动率，0 表示不做波动率目标 */
  targetVol: number;
  /** 单资产最大权重 */
  maxWeight: number;
  /** 组合最大总仓位（gross） */
  maxGross: number;
  /** 调仓间隔（交易日） */
  rebalanceDays: number;
  /** 长期均线过滤，0 表示关闭 */
  regimeSma: number;
};

export type Trade = {
  t: number;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  notional: number;
  feeUsd: number;
  slippageUsd: number;
  reason: string;
};

export type EquityPoint = { t: number; equity: number; gross: number; cash: number; drawdown: number };

export type CostLedger = {
  feesUsd: number;
  slippageUsd: number;
  apiUsd: number;
  totalUsd: number;
  /** 成交名义金额合计（单边） */
  turnoverUsd: number;
  tradeCount: number;
  /** 总成本 / 初始资金 */
  dragPct: number;
};

export type Metrics = {
  start: string;
  end: string;
  days: number;
  totalReturn: number;
  cagr: number;
  vol: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  winRate: number;
  profitFactor: number;
  avgExposure: number;
  turnoverPerYear: number;
  tradeCount: number;
};

export type BacktestResult = {
  strategy: StrategyId;
  params: StrategyParams;
  symbols: string[];
  initialCapital: number;
  equity: EquityPoint[];
  trades: Trade[];
  ledger: CostLedger;
  metrics: Metrics;
  monthlyReturns: { month: string; ret: number }[];
  perSymbol: { symbol: string; trades: number; pnlUsd: number; feesUsd: number }[];
};

export type GridCell = {
  params: Partial<StrategyParams>;
  isSharpe: number;
  isCagr: number;
  isMaxDD: number;
  oosSharpe: number;
  oosCagr: number;
  oosMaxDD: number;
};

export type WalkforwardResult = {
  strategy: StrategyId;
  splitDate: string;
  inSampleDays: number;
  outOfSampleDays: number;
  cells: GridCell[];
  chosen: GridCell | null;
  note: string;
};

export type PaperState = {
  version: number;
  updatedAt: string;
  strategy: StrategyId;
  params: StrategyParams;
  capital: number;
  cash: number;
  positions: { symbol: string; qty: number; avgPrice: number; weight: number }[];
  lastBar: Record<string, number>;
  pending: { symbol: string; side: 'buy' | 'sell'; weight: number; targetNotional: number }[];
  fills: Trade[];
  equity: EquityPoint[];
  ledger: CostLedger;
};
