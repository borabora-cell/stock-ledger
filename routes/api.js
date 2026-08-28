import express from 'express';
import multer from 'multer';
import { db } from '../lib/db.js';
import { matchSell, summarizeMatches, remainingAfter } from '../lib/match.js';
import { round2, todayKST } from '../lib/util.js';

const router = express.Router();

// 캡처는 파일이 아니라 DB 에 담는다 → 서버리스(읽기 전용 파일시스템)에서도 동작
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

/** 업로드된 캡처를 저장하고 id 를 돌려준다 */
async function saveScreenshot(file) {
  if (!file) return null;
  const r = await db.run(
    'INSERT INTO screenshots (mime, data) VALUES (?, ?)',
    file.mimetype, file.buffer.toString('base64')
  );
  return r.lastInsertRowid;
}

/** 종목의 매입 lot 과 잔여수량을 계산한다 */
async function getLots(stockId) {
  const rows = await db.all(`
    SELECT t.id, t.unit_price, t.quantity, t.txn_date,
           t.quantity - COALESCE(SUM(m.matched_qty), 0) AS remaining_qty
      FROM transactions t
      LEFT JOIN sale_matches m ON m.buy_txn_id = t.id
     WHERE t.stock_id = ? AND t.type = 'buy'
     GROUP BY t.id
     ORDER BY t.txn_date, t.id
  `, stockId);
  return rows.map((r) => ({
    id: r.id, unitPrice: r.unit_price, quantity: r.quantity,
    remainingQty: r.remaining_qty, buyDate: r.txn_date,
  }));
}

/* ─────────── 종목 목록 / 등록 ─────────── */

router.get('/stocks', async (req, res, next) => {
  try {
    const stocks = await db.all('SELECT id, name, created_at FROM stocks ORDER BY id DESC');
    const out = [];
    for (const s of stocks) {
      const lots = await getLots(s.id);
      const holding = lots.filter((l) => l.remainingQty > 0);
      const holdingQty = holding.reduce((sum, l) => sum + l.remainingQty, 0);
      const totalCost = holding.reduce((sum, l) => sum + l.remainingQty * l.unitPrice, 0);
      const avgPrice = holdingQty > 0 ? totalCost / holdingQty : 0;
      const agg = await db.get(`
        SELECT COALESCE(SUM(realized_pl), 0) AS realized_pl, COUNT(*) AS cnt
          FROM transactions WHERE stock_id = ?
      `, s.id);
      out.push({
        id: s.id, name: s.name,
        holdingQty, avgPrice: round2(avgPrice), totalCost: round2(totalCost),
        realizedPl: round2(agg.realized_pl), txnCount: agg.cnt,
      });
    }
    res.json({ ok: true, stocks: out, today: todayKST() });
  } catch (e) { next(e); }
});

router.post('/stocks', async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ ok: false, error: '종목명을 입력해 주세요.' });
    const r = await db.run('INSERT INTO stocks (name) VALUES (?)', name);
    res.json({ ok: true, id: r.lastInsertRowid, name });
  } catch (e) { next(e); }
});

router.delete('/stocks/:id', async (req, res, next) => {
  try {
    await db.run('DELETE FROM stocks WHERE id = ?', Number(req.params.id));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ─────────── 종목 상세 ─────────── */

router.get('/stocks/:id', async (req, res, next) => {
  try {
    const stockId = Number(req.params.id);
    const stock = await db.get('SELECT id, name FROM stocks WHERE id = ?', stockId);
    if (!stock) return res.status(404).json({ ok: false, error: '종목을 찾을 수 없습니다.' });

    const lots = await getLots(stockId);
    const holding = lots.filter((l) => l.remainingQty > 0);
    const holdingQty = holding.reduce((sum, l) => sum + l.remainingQty, 0);
    const totalCost = holding.reduce((sum, l) => sum + l.remainingQty * l.unitPrice, 0);
    const avgPrice = holdingQty > 0 ? totalCost / holdingQty : 0;

    const agg = await db.get(`
      SELECT COALESCE(SUM(realized_pl), 0) AS realized_pl,
             COALESCE(SUM(CASE WHEN type='sell' THEN total_amount ELSE 0 END), 0) AS sold_amount
        FROM transactions WHERE stock_id = ?
    `, stockId);

    const txns = await db.all(`
      SELECT id, type, txn_date, quantity, unit_price, total_amount,
             screenshot_id, realized_pl, realized_pl_pct, memo, created_at
        FROM transactions WHERE stock_id = ?
       ORDER BY txn_date DESC, id DESC
    `, stockId);

    const sellIds = txns.filter((t) => t.type === 'sell').map((t) => t.id);
    const matchesByTxn = {};
    if (sellIds.length) {
      const placeholders = sellIds.map(() => '?').join(',');
      const rows = await db.all(`
        SELECT m.sell_txn_id, m.matched_qty, m.cost_unit_price, b.txn_date AS buy_date
          FROM sale_matches m JOIN transactions b ON b.id = m.buy_txn_id
         WHERE m.sell_txn_id IN (${placeholders})
         ORDER BY m.id
      `, ...sellIds);
      for (const r of rows) {
        (matchesByTxn[r.sell_txn_id] ??= []).push({
          qty: r.matched_qty, unitPrice: r.cost_unit_price, buyDate: r.buy_date,
        });
      }
    }

    res.json({
      ok: true,
      stock,
      summary: {
        holdingQty, avgPrice: round2(avgPrice), totalCost: round2(totalCost),
        realizedPl: round2(agg.realized_pl),
        realizedPlPct: agg.sold_amount > 0
          ? round2((agg.realized_pl / (agg.sold_amount - agg.realized_pl)) * 100) : 0,
      },
      lots: lots.map((l) => ({
        id: l.id, buyDate: l.buyDate, unitPrice: l.unitPrice,
        quantity: l.quantity, remainingQty: l.remainingQty,
      })),
      transactions: txns.map((t) => ({
        ...t,
        screenshot_url: t.screenshot_id ? `/api/screenshots/${t.screenshot_id}` : null,
        matches: matchesByTxn[t.id] || null,
      })),
    });
  } catch (e) { next(e); }
});

/* ─────────── 캡처 이미지 ─────────── */

router.get('/screenshots/:id', async (req, res, next) => {
  try {
    const row = await db.get('SELECT mime, data FROM screenshots WHERE id = ?', Number(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: '이미지를 찾을 수 없습니다.' });
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(Buffer.from(row.data, 'base64'));
  } catch (e) { next(e); }
});

/* ─────────── 거래 추가 ─────────── */

router.post('/stocks/:id/transactions', upload.single('screenshot'), async (req, res, next) => {
  try {
    const stockId = Number(req.params.id);
    const stock = await db.get('SELECT id FROM stocks WHERE id = ?', stockId);
    if (!stock) return res.status(404).json({ ok: false, error: '종목을 찾을 수 없습니다.' });

    const type = req.body?.type === 'sell' ? 'sell' : 'buy';
    const txnDate = String(req.body?.txn_date || todayKST()).slice(0, 10);
    const quantity = Math.round(Number(req.body?.quantity || 0));
    let unitPrice = Number(req.body?.unit_price || 0);
    let totalAmount = Number(req.body?.total_amount || 0);
    const memo = String(req.body?.memo || '').trim().slice(0, 200) || null;

    if (quantity <= 0) return res.status(400).json({ ok: false, error: '수량을 입력해 주세요.' });
    if (totalAmount > 0 && !unitPrice) unitPrice = totalAmount / quantity;
    if (unitPrice > 0 && !totalAmount) totalAmount = unitPrice * quantity;
    if (unitPrice <= 0 || totalAmount <= 0) {
      return res.status(400).json({ ok: false, error: '단가 또는 총 금액을 입력해 주세요.' });
    }
    unitPrice = round2(unitPrice);
    totalAmount = round2(totalAmount);

    // 매도는 매칭이 실패할 수 있으니, 캡처를 저장하기 전에 먼저 검증한다
    let matches = null;
    let sum = null;
    if (type === 'sell') {
      const lots = await getLots(stockId);
      try {
        matches = matchSell(lots, quantity);
      } catch (e) {
        if (e.code === 'INSUFFICIENT_QTY') return res.status(400).json({ ok: false, error: e.message });
        throw e;
      }
      sum = summarizeMatches(matches, unitPrice);
    }

    const screenshotId = await saveScreenshot(req.file);

    if (type === 'buy') {
      const r = await db.run(`
        INSERT INTO transactions (stock_id, type, txn_date, quantity, unit_price, total_amount, screenshot_id, memo)
        VALUES (?, 'buy', ?, ?, ?, ?, ?, ?)
      `, stockId, txnDate, quantity, unitPrice, totalAmount, screenshotId, memo);
      return res.json({ ok: true, id: r.lastInsertRowid, type });
    }

    const sellResult = await db.run(`
      INSERT INTO transactions (stock_id, type, txn_date, quantity, unit_price, total_amount, screenshot_id, realized_pl, realized_pl_pct, memo)
      VALUES (?, 'sell', ?, ?, ?, ?, ?, ?, ?, ?)
    `, stockId, txnDate, quantity, unitPrice, totalAmount, screenshotId,
      round2(sum.realizedPl), round2(sum.realizedPlPct), memo);

    const sellTxnId = sellResult.lastInsertRowid;
    await db.batch(matches.map((m) => ({
      sql: `INSERT INTO sale_matches (sell_txn_id, buy_txn_id, matched_qty, cost_unit_price, proceeds_unit_price, realized_pl)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [sellTxnId, m.lotId, m.qty, m.unitPrice, unitPrice, round2(m.qty * (unitPrice - m.unitPrice))],
    })));

    res.json({
      ok: true, id: sellTxnId, type,
      realizedPl: round2(sum.realizedPl), realizedPlPct: round2(sum.realizedPlPct),
      matches: matches.map((m) => ({ qty: m.qty, unitPrice: m.unitPrice, buyDate: m.buyDate })),
    });
  } catch (e) { next(e); }
});

router.delete('/transactions/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const txn = await db.get('SELECT id, type, screenshot_id FROM transactions WHERE id = ?', id);
    if (!txn) return res.status(404).json({ ok: false, error: '거래를 찾을 수 없습니다.' });

    if (txn.type === 'buy') {
      const used = await db.get('SELECT COALESCE(SUM(matched_qty),0) AS n FROM sale_matches WHERE buy_txn_id = ?', id);
      if (used.n > 0) {
        return res.status(400).json({
          ok: false,
          error: '이미 매도에 사용된 매입 내역은 삭제할 수 없습니다. 먼저 관련 매도 내역을 삭제해 주세요.',
        });
      }
    }
    await db.run('DELETE FROM transactions WHERE id = ?', id); // sale_matches 는 FK CASCADE 로 함께 삭제됨
    if (txn.screenshot_id) await db.run('DELETE FROM screenshots WHERE id = ?', txn.screenshot_id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ─────────── 매도 시뮬레이션 ─────────── */

router.post('/stocks/:id/simulate', async (req, res, next) => {
  try {
    const stockId = Number(req.params.id);
    const stock = await db.get('SELECT id, name FROM stocks WHERE id = ?', stockId);
    if (!stock) return res.status(404).json({ ok: false, error: '종목을 찾을 수 없습니다.' });

    const quantity = Math.round(Number(req.body?.quantity || 0));
    const mode = req.body?.mode === 'unit' ? 'unit' : 'total';
    const value = Number(req.body?.value || 0);
    if (quantity <= 0) return res.status(400).json({ ok: false, error: '매도 수량을 입력해 주세요.' });
    if (value <= 0) return res.status(400).json({ ok: false, error: '금액을 입력해 주세요.' });

    const unitPrice = mode === 'unit' ? value : value / quantity;
    const totalAmount = mode === 'unit' ? value * quantity : value;

    const lots = await getLots(stockId);
    let matches;
    try {
      matches = matchSell(lots, quantity);
    } catch (e) {
      if (e.code === 'INSUFFICIENT_QTY') return res.status(400).json({ ok: false, error: e.message });
      throw e;
    }
    const sum = summarizeMatches(matches, unitPrice);
    const after = remainingAfter(lots, matches);

    res.json({
      ok: true,
      quantity, unitPrice: round2(unitPrice), totalAmount: round2(totalAmount),
      matches: matches.map((m) => ({ qty: m.qty, unitPrice: m.unitPrice, buyDate: m.buyDate })),
      realizedPl: round2(sum.realizedPl), realizedPlPct: round2(sum.realizedPlPct),
      after: { holdingQty: after.totalQty, avgPrice: round2(after.avgPrice) },
    });
  } catch (e) { next(e); }
});

export default router;
