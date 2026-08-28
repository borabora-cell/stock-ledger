// 매도 매칭 엔진
// 규칙: 평균단가가 아니라, 남아있는 매입 건 중 "단가가 가장 낮은 것부터" 소진한다.
// → 이익이 나는 매입건이 최대한 먼저 반영되고, 전부 손실 상황이면 손실이 가장 작은 건이 먼저 나가
//   전체 손실을 최소화한다.

/**
 * @param {{id:number, unitPrice:number, remainingQty:number, buyDate:string}[]} lots
 * @param {number} sellQty
 * @returns {{lotId:number, qty:number, unitPrice:number, buyDate:string}[]}
 */
export function matchSell(lots, sellQty) {
  const sorted = lots
    .filter((l) => l.remainingQty > 0)
    .sort((a, b) => a.unitPrice - b.unitPrice
      || new Date(a.buyDate) - new Date(b.buyDate)
      || a.id - b.id);

  const available = sorted.reduce((s, l) => s + l.remainingQty, 0);
  if (available < sellQty) {
    const err = new Error(`보유 수량이 부족합니다. (보유 ${available}주, 매도 요청 ${sellQty}주)`);
    err.code = 'INSUFFICIENT_QTY';
    throw err;
  }

  const matches = [];
  let need = sellQty;
  for (const lot of sorted) {
    if (need <= 0) break;
    const take = Math.min(lot.remainingQty, need);
    matches.push({ lotId: lot.id, qty: take, unitPrice: lot.unitPrice, buyDate: lot.buyDate });
    need -= take;
  }
  return matches;
}

/** 매칭 결과로 실현손익을 계산한다 */
export function summarizeMatches(matches, sellUnitPrice) {
  const totalQty = matches.reduce((s, m) => s + m.qty, 0);
  const costBasis = matches.reduce((s, m) => s + m.qty * m.unitPrice, 0);
  const proceeds = totalQty * sellUnitPrice;
  const realizedPl = proceeds - costBasis;
  const realizedPlPct = costBasis > 0 ? (realizedPl / costBasis) * 100 : 0;
  return { totalQty, costBasis, proceeds, realizedPl, realizedPlPct };
}

/** 매칭을 적용한 뒤 남는 보유 현황(수량·평균단가)을 계산한다 */
export function remainingAfter(lots, matches) {
  const consumed = new Map();
  for (const m of matches) consumed.set(m.lotId, (consumed.get(m.lotId) || 0) + m.qty);

  const after = lots
    .map((l) => ({ ...l, remainingQty: l.remainingQty - (consumed.get(l.id) || 0) }))
    .filter((l) => l.remainingQty > 0);

  const totalQty = after.reduce((s, l) => s + l.remainingQty, 0);
  const totalCost = after.reduce((s, l) => s + l.remainingQty * l.unitPrice, 0);
  const avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
  return { lots: after, totalQty, avgPrice };
}
