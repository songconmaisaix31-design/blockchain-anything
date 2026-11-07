import type { BacktestResult, Metrics, WalkforwardResult } from './types.js';

export type ReportMeta = {
  dataSource: string;
  generatedAt?: string;
  exchange?: string;
  warnings?: string[];
  costBps?: { fee: number; slippage: number };
};

const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const usd = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function equitySvg(result: BacktestResult) {
  const points = result.equity;
  if (points.length < 2) return '<p>数据不足</p>';
  const width = 860; const height = 260; const pad = 36;
  const values = points.map((p) => p.equity);
  const min = Math.min(...values); const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  const ddLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${(height - pad + p.drawdown * 90).toFixed(1)}`).join(' ');
  const start = new Date(points[0]!.t).toISOString().slice(0, 10);
  const end = new Date(points[points.length - 1]!.t).toISOString().slice(0, 10);
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="净值曲线">
  <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#0f766e" stop-opacity="0.28"/><stop offset="100%" stop-color="#0f766e" stop-opacity="0.02"/>
  </linearGradient></defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>
  ${[0, 0.25, 0.5, 0.75, 1].map((r) => `<line x1="${pad}" x2="${width - pad}" y1="${(pad + r * (height - pad * 2)).toFixed(1)}" y2="${(pad + r * (height - pad * 2)).toFixed(1)}" stroke="#e5e7eb" stroke-width="1"/>`).join('')}
  <path d="${area}" fill="url(#eq)"/>
  <path d="${line}" fill="none" stroke="#0f766e" stroke-width="2"/>
  <path d="${ddLine}" fill="none" stroke="#b91c1c" stroke-width="1.2" opacity="0.75"/>
  <text x="${pad}" y="${height - 10}" font-size="11" fill="#6b7280">${start}</text>
  <text x="${width - pad}" y="${height - 10}" font-size="11" fill="#6b7280" text-anchor="end">${end}</text>
  <text x="${pad}" y="20" font-size="11" fill="#6b7280">净值 ${usd(max)} / ${usd(min)} ｜ 红线为回撤</text>
</svg>`;
}

function metricCard(label: string, value: string, tone: 'neutral' | 'good' | 'bad' = 'neutral') {
  const color = tone === 'good' ? '#0f766e' : tone === 'bad' ? '#b91c1c' : '#111827';
  return `<div class="card"><div class="label">${esc(label)}</div><div class="value" style="color:${color}">${esc(value)}</div></div>`;
}

function metricsBlock(m: Metrics) {
  return `<div class="grid">
    ${metricCard('年化收益 CAGR', pct(m.cagr), m.cagr >= 0 ? 'good' : 'bad')}
    ${metricCard('夏普 Sharpe', m.sharpe.toFixed(2), m.sharpe >= 1 ? 'good' : m.sharpe < 0 ? 'bad' : 'neutral')}
    ${metricCard('最大回撤', pct(m.maxDrawdown), 'bad')}
    ${metricCard('年化波动', pct(m.vol))}
    ${metricCard('Calmar', m.calmar.toFixed(2))}
    ${metricCard('胜率', pct(m.winRate, 0))}
    ${metricCard('平均仓位', pct(m.avgExposure, 0))}
    ${metricCard('成交笔数', String(m.tradeCount))}
  </div>`;
}

function costBlock(result: BacktestResult) {
  const { ledger } = result;
  const rows: [string, string][] = [
    ['手续费', usd(ledger.feesUsd)],
    ['滑点', usd(ledger.slippageUsd)],
    ['数据/API 成本', usd(ledger.apiUsd)],
    ['合计', usd(ledger.totalUsd)],
    ['占初始资金', pct(ledger.dragPct, 2)],
    ['换手名义金额', usd(ledger.turnoverUsd)],
  ];
  return `<table><thead><tr><th>成本项</th><th class="num">金额</th></tr></thead><tbody>
  ${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`).join('')}
  </tbody></table>`;
}

function monthlyBlock(result: BacktestResult) {
  const cells = result.monthlyReturns.map((m) => {
    const color = m.ret >= 0 ? '#0f766e' : '#b91c1c';
    return `<div class="m"><span>${esc(m.month)}</span><b style="color:${color}">${(m.ret * 100).toFixed(1)}%</b></div>`;
  });
  return `<div class="months">${cells.join('')}</div>`;
}

function tradesBlock(result: BacktestResult) {
  const rows = result.trades.slice(-25).reverse().map((t) => `<tr>
    <td>${new Date(t.t).toISOString().slice(0, 10)}</td><td>${esc(t.symbol)}</td>
    <td>${t.side === 'buy' ? '买入' : '卖出'}</td><td class="num">${t.price.toFixed(2)}</td>
    <td class="num">${usd(t.notional)}</td><td class="num">${usd(t.feeUsd + t.slippageUsd)}</td><td>${esc(t.reason)}</td></tr>`).join('');
  return `<table><thead><tr><th>日期</th><th>标的</th><th>方向</th><th class="num">价格</th><th class="num">名义</th><th class="num">成本</th><th>原因</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderReport(input: { result?: BacktestResult; walkforward?: WalkforwardResult }, meta: ReportMeta): string {
  const generatedAt = meta.generatedAt ?? new Date().toISOString();
  const synthetic = /synthetic/i.test(meta.dataSource);
  const warnings = meta.warnings ?? [];
  const feeText = meta.costBps ? `${meta.costBps.fee} bps/边` : '按单边 bps 计';
  const slipText = meta.costBps ? `${meta.costBps.slippage} bps/边` : '按单边 bps 计';
  const wf = input.walkforward;
  const wfBlock = wf ? `<h2>样本内 / 样本外</h2>
    <p class="muted">切分点 ${esc(wf.splitDate)}，样本内 ${wf.inSampleDays} 根，样本外 ${wf.outOfSampleDays} 根。</p>
    <table><thead><tr><th>参数</th><th class="num">IS Sharpe</th><th class="num">IS CAGR</th><th class="num">OOS Sharpe</th><th class="num">OOS CAGR</th><th class="num">OOS MaxDD</th></tr></thead><tbody>
    ${wf.cells.map((c) => `<tr${wf.chosen === c ? ' class="chosen"' : ''}><td>${esc(JSON.stringify(c.params))}</td>
      <td class="num">${c.isSharpe.toFixed(2)}</td><td class="num">${pct(c.isCagr)}</td>
      <td class="num">${c.oosSharpe.toFixed(2)}</td><td class="num">${pct(c.oosCagr)}</td><td class="num">${pct(c.oosMaxDD)}</td></tr>`).join('')}
    </tbody></table><p class="note">${esc(wf.note)}</p>` : '';

  const result = input.result;
  const body = result ? `
    ${metricsBlock(result.metrics)}
    <h2>净值与回撤</h2>
    ${equitySvg(result)}
    <div class="two">
      <div><h2>成本台账</h2>${costBlock(result)}</div>
      <div><h2>分标的</h2><table><thead><tr><th>标的</th><th class="num">平仓次数</th><th class="num">已实现盈亏</th><th class="num">成本</th></tr></thead><tbody>
      ${result.perSymbol.map((s) => `<tr><td>${esc(s.symbol)}</td><td class="num">${s.trades}</td><td class="num" style="color:${s.pnlUsd >= 0 ? '#0f766e' : '#b91c1c'}">${usd(s.pnlUsd)}</td><td class="num">${usd(s.feesUsd)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>
    ${wfBlock}
    <h2>月度收益</h2>${monthlyBlock(result)}
    <h2>最近成交</h2>${tradesBlock(result)}
  ` : wfBlock;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BCA Quant EA 回测报告</title>
<style>
  :root{color-scheme:light}
  body{margin:0;background:#f8fafc;color:#111827;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:32px 20px 64px}
  h1{font-size:22px;margin:0 0 6px} h2{font-size:15px;margin:32px 0 12px;color:#0f172a}
  .muted{color:#6b7280;font-size:13px;margin:0 0 8px}
  .banner{border-radius:10px;padding:12px 14px;font-size:13px;margin:16px 0;line-height:1.6}
  .warn{background:#fef2f2;border:1px solid #fecaca;color:#7f1d1d}
  .ok{background:#ecfdf5;border:1px solid #a7f3d0;color:#064e3b}
  .grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px}
  .card .label{font-size:12px;color:#6b7280} .card .value{font-size:19px;font-weight:650;margin-top:4px}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-size:13px}
  th,td{padding:8px 10px;border-bottom:1px solid #f1f5f9;text-align:left} th{background:#f8fafc;color:#475569;font-weight:600;font-size:12px}
  .num{text-align:right;font-variant-numeric:tabular-nums} tr.chosen{background:#f0fdfa}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
  .months{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;font-size:12px}
  .m{display:flex;justify-content:space-between;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px}
  .note{font-size:12px;color:#6b7280;line-height:1.6}
  footer{margin-top:40px;font-size:12px;color:#6b7280;line-height:1.7;border-top:1px solid #e5e7eb;padding-top:16px}
  @media(max-width:720px){.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.months{grid-template-columns:repeat(3,1fr)}}
</style></head><body><div class="wrap">
<h1>BCA Quant EA · 回测报告</h1>
<p class="muted">策略 ${esc(result?.strategy ?? wf?.strategy ?? '-')} ｜ 数据源 ${esc(meta.dataSource)}${meta.exchange ? ` ｜ 交易所 ${esc(meta.exchange)}` : ''} ｜ 生成于 ${esc(generatedAt)}</p>
${synthetic ? `<div class="banner warn"><b>合成数据（SYNTHETIC）</b>：本报告用确定性生成的行情验证引擎的成交时序、成本与风控逻辑，<b>不能</b>作为策略盈利能力的证据。真实结论必须在真实历史数据上跑样本外验证。</div>`
  : `<div class="banner ok">真实历史数据：${esc(meta.dataSource)}。回测已计入手续费、滑点与数据成本；历史表现不代表未来收益。</div>`}
${warnings.map((w) => `<div class="banner warn">${esc(w)}</div>`).join('')}
${body}
<footer>成本口径：手续费 ${feeText}，滑点 ${slipText}，数据成本按 BCA credits 估算。回测采用「收盘决策、次日开盘成交」，不包含前视偏差；期末按最后收盘价强制平仓。<br>
本报告不构成投资建议。任何策略都存在亏损可能，历史回测无法保证未来收益。</footer>
</div></body></html>`;
}
