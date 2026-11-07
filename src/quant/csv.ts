import { readFileSync } from 'node:fs';
import type { Bar, Series } from './types.js';

const ALIASES: Record<'t' | 'o' | 'h' | 'l' | 'c' | 'v', string[]> = {
  t: ['timestamp', 'time', 'date', 'datetime', 'open_time', 'opentime', 'utc'],
  o: ['open', 'o'],
  h: ['high', 'h'],
  l: ['low', 'l'],
  c: ['close', 'c', 'price'],
  v: ['volume', 'vol', 'v', 'basevolume'],
};

function toTimestamp(value: string): number | null {
  const text = value.trim().replace(/^"|"$/g, '');
  if (/^\d{10}$/.test(text)) return Number(text) * 1000;
  if (/^\d{13}$/.test(text)) return Number(text);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const parsed = Date.parse(text.includes('T') ? text : `${text}T00:00:00Z`);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * 读取任意来源的 OHLCV CSV（交易所导出、TradingView、Dune 导出都行）。
 * 自动识别表头；无表头时按 date,open,high,low,close,volume 解析。
 */
export function loadCsvSeries(path: string, symbol: string): Series {
  const text = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV 内容不足');
  const delimiter = (lines[0]!.match(/;/g)?.length ?? 0) > (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const header = lines[0]!.split(delimiter).map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const hasHeader = header.some((h) => ALIASES.t.includes(h)) && header.some((h) => ALIASES.c.includes(h));
  const indexOf = (key: keyof typeof ALIASES): number => {
    for (const alias of ALIASES[key]) {
      const at = header.indexOf(alias);
      if (at >= 0) return at;
    }
    return -1;
  };
  const map = hasHeader
    ? { t: indexOf('t'), o: indexOf('o'), h: indexOf('h'), l: indexOf('l'), c: indexOf('c'), v: indexOf('v') }
    : { t: 0, o: 1, h: 2, l: 3, c: 4, v: 5 };
  if (map.t < 0 || map.c < 0) throw new Error('CSV 缺少时间或收盘价列');
  const bars: Bar[] = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i += 1) {
    const cells = lines[i]!.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ''));
    const t = toTimestamp(cells[map.t] ?? '');
    const c = Number(cells[map.c]);
    if (t === null || !Number.isFinite(c) || c <= 0) continue;
    const o = Number(cells[map.o] ?? c);
    const h = Number(cells[map.h] ?? c);
    const l = Number(cells[map.l] ?? c);
    const v = Number(cells[map.v] ?? 0);
    bars.push({
      t,
      o: Number.isFinite(o) && o > 0 ? o : c,
      h: Number.isFinite(h) && h > 0 ? h : c,
      l: Number.isFinite(l) && l > 0 ? l : c,
      c,
      v: Number.isFinite(v) ? v : 0,
    });
  }
  bars.sort((a, b) => a.t - b.t);
  const deduped = bars.filter((bar, i) => i === 0 || bar.t !== bars[i - 1]!.t);
  if (deduped.length < 30) throw new Error(`CSV 有效行数不足：${deduped.length}`);
  return { symbol, exchange: 'csv', timeframe: '1d', bars: deduped };
}
