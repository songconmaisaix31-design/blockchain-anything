#!/usr/bin/env bash
# 从 Binance 公开数据归档下载日线 K 线，合并成 BCA Quant 可直接吃的 CSV。
#
# 为什么用它：交易所 API（api.binance.com / www.okx.com）常见 451 地域封锁或 DNS 不可达，
# 但归档是独立对象存储（data.binance.vision），通常仍可访问，且不需要 API Key、不计入限频。
#
# 用法：
#   scripts/fetch-binance-archive.sh
#   SYMBOLS="BTCUSDT ETHUSDT" START=2019-01 END=2025-11 OUT=.quant/data scripts/fetch-binance-archive.sh
#
# 产物：$OUT/<SYMBOL>-1d.csv，列顺序 timestamp_ms,open,high,low,close,volume（无表头），
# 与 `npm run quant -- backtest --csv` 的默认解析一致。
set -euo pipefail

SYMBOLS=${SYMBOLS:-"BTCUSDT ETHUSDT SOLUSDT"}
START=${START:-2019-01}
END=${END:-$(date -u +%Y-%m)}
OUT=${OUT:-.quant/data}
BASE=${BASE:-https://data.binance.vision/data/spot/monthly/klines}

mkdir -p "$OUT"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

sy=${START%-*}; sm=${START#*-}
ey=${END%-*};   em=${END#*-}
sy=$((10#$sy)); sm=$((10#$sm)); ey=$((10#$ey)); em=$((10#$em))

for sym in $SYMBOLS; do
  raw="$tmp/$sym.raw"
  : > "$raw"
  total=$(( (ey * 12 + em) - (sy * 12 + sm) + 1 ))
  i=0
  while [ "$i" -lt "$total" ]; do
    idx=$(( sy * 12 + sm - 1 + i ))
    y=$(( idx / 12 ))
    m=$(( idx % 12 + 1 ))
    mm=$(printf '%02d' "$m")
    file="$sym-1d-$y-$mm.zip"
    url="$BASE/$sym/1d/$file"
    if curl -fsS --max-time 30 -o "$tmp/$file" "$url" 2>/dev/null; then
      # 2025 起归档改用微秒时间戳，统一折算成毫秒；列只保留 t,o,h,l,c,v
      unzip -p "$tmp/$file" 2>/dev/null | tr -d '\r' | awk -F, '
        length($1)==16 && $1 ~ /^[0-9]+$/ {printf "%.0f,%s,%s,%s,%s,%s\n", $1/1000, $2,$3,$4,$5,$6; next}
        length($1)==13 && $1 ~ /^[0-9]+$/ {printf "%s,%s,%s,%s,%s,%s\n", $1,$2,$3,$4,$5,$6}
      ' >> "$raw"
      printf '  %s ok\n' "$file" >&2
    else
      printf '  %s 缺失，跳过\n' "$file" >&2
    fi
    i=$((i+1))
  done
  sort -t, -k1,1n -u "$raw" > "$OUT/$sym-1d.csv"
  rows=$(wc -l < "$OUT/$sym-1d.csv")
  printf '%s\t%s 根\t%s\n' "$sym" "$rows" "$OUT/$sym-1d.csv"
done

echo "完成。回测示例："
echo "  npm run quant -- backtest --csv $OUT/BTCUSDT-1d.csv,$OUT/ETHUSDT-1d.csv,$OUT/SOLUSDT-1d.csv --strategy tsmom"
