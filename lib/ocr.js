// 토스 "주문 내역" 화면 캡처에서 거래를 읽어낸다.
//
// 화면 구조상 한 장에 매수(구매)와 매도(판매)가 섞여 있고, 날짜는 행마다가 아니라
// 그룹 머리글로 한 번만 찍힌다. 그래서 두 번 훑는다.
//   1) 한국어 전체 인식 → "판매/구매 N주", "주당 N원" 줄과 그 세로 위치
//   2) 왼쪽 날짜 열만 숫자로 인식 → 날짜와 그 세로 위치
// 두 결과를 세로 위치로 맞물려 거래 목록을 만든다.
import os from 'node:os';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { DATA_DIR, IS_REMOTE } from './db.js';

/** 날짜 열이 차지하는 폭 (거래 글씨는 이보다 오른쪽에서 시작한다) */
const DATE_COL_RATIO = 0.17;

// 글꼴 학습 데이터(약 7MB)를 받아 두는 곳. 서버리스는 /tmp 만 쓸 수 있다.
const CACHE_PATH = IS_REMOTE ? path.join(os.tmpdir(), 'tessdata') : DATA_DIR;

let korWorker;
let numWorker;

async function getWorkers() {
  if (!korWorker) {
    korWorker = await createWorker('kor', 1, { cachePath: CACHE_PATH, logger: () => {} });
  }
  if (!numWorker) {
    numWorker = await createWorker('eng', 1, { cachePath: CACHE_PATH, logger: () => {} });
    await numWorker.setParameters({
      tessedit_char_whitelist: '0123456789.',
      tessedit_pageseg_mode: '11', // 흩어진 글자 (날짜가 띄엄띄엄 있다)
    });
  }
  return { kor: korWorker, num: numWorker };
}

export async function terminateOcr() {
  await korWorker?.terminate();
  await numWorker?.terminate();
  korWorker = null;
  numWorker = null;
}

/** JPEG/PNG 헤더에서 가로·세로를 읽는다 (이미지 라이브러리 없이) */
export function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) { // PNG
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  for (let i = 2; i < buf.length - 8;) { // JPEG
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const flattenLines = (data) => {
  const out = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) out.push({ text: l.text.trim(), bbox: l.bbox });
    }
  }
  return out;
};

const centerY = (bbox) => (bbox.y0 + bbox.y1) / 2;
const digits = (s) => Number(String(s).replace(/[^0-9]/g, '') || 0);

/**
 * "8.18" 처럼 연도가 없는 날짜에 연도를 채운다.
 * 오늘보다 미래가 되면 작년 것으로 본다 (1월에 12월 거래를 캡처한 경우).
 */
function withYear(month, day, today = new Date()) {
  const kst = new Date(today.getTime() + 9 * 36e5);
  let year = kst.getUTCFullYear();
  const asDate = (y) => new Date(Date.UTC(y, month - 1, day));
  // 하루 여유를 둬서 시차로 오늘 거래가 작년으로 밀리지 않게 한다
  if (asDate(year).getTime() > kst.getTime() + 864e5) year -= 1;
  const d = asDate(year);
  if (d.getUTCMonth() !== month - 1) return null; // 2.30 같은 값
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 왼쪽 열에서 날짜와 세로 위치를 뽑는다 */
async function readDates(worker, buf, width, height) {
  const { data } = await worker.recognize(
    buf,
    { rectangle: { left: 0, top: 0, width: Math.round(width * DATE_COL_RATIO), height } },
    { blocks: true }
  );
  const out = [];
  for (const line of flattenLines(data)) {
    const m = line.text.match(/(\d{1,2})\s*\.\s*(\d{1,2})/);
    if (!m) continue;
    const month = Number(m[1]);
    const day = Number(m[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const date = withYear(month, day);
    if (date) out.push({ date, y: centerY(line.bbox) });
  }
  return out.sort((a, b) => a.y - b.y);
}

/**
 * 캡처 한 장에서 거래를 읽어낸다.
 * @returns {{stockName: string|null, rows: {date: string|null, type: 'buy'|'sell', quantity: number, unitPrice: number}[]}}
 */
export async function parseTossScreenshot(buf) {
  const size = imageSize(buf);
  if (!size) throw new Error('이미지를 읽을 수 없습니다. JPG 또는 PNG 로 올려주세요.');

  const { kor, num } = await getWorkers();

  const { data } = await kor.recognize(buf, {}, { blocks: true });
  const lines = flattenLines(data);

  // 종목명: 화면 위쪽에 현재가와 함께 있는 한글 이름
  let stockName = null;
  for (const l of lines) {
    if (l.bbox.y1 > size.height * 0.15) break;
    const m = l.text.match(/^([가-힣A-Za-z0-9&.\- ]{2,20})$/);
    if (m && !/^\d/.test(m[1].trim())) { stockName = m[1].trim(); break; }
  }

  // "판매 20주" / "구매 10주" 줄과 "주당 282,500원" 줄을 각각 모은다
  const orders = [];
  const prices = [];
  for (const l of lines) {
    const t = l.text.replace(/\s+/g, ' ');
    const o = t.match(/(판매|매도|구매|매수)\s*([\d,]+)\s*주/);
    if (o) {
      const quantity = digits(o[2]);
      if (quantity > 0) {
        orders.push({
          type: (o[1] === '판매' || o[1] === '매도') ? 'sell' : 'buy',
          quantity, y: centerY(l.bbox),
        });
      }
      continue;
    }
    const p = t.match(/주\s*당\s*([\d,]{2,})\s*원/);
    if (p) {
      const unitPrice = digits(p[1]);
      if (unitPrice > 0) prices.push({ unitPrice, y: centerY(l.bbox) });
    }
  }

  orders.sort((a, b) => a.y - b.y);
  prices.sort((a, b) => a.y - b.y);

  const dates = await readDates(num, buf, size.width, size.height);

  // 주문 줄 바로 아래의 "주당" 줄이 그 주문의 단가다
  const rows = orders.map((o, i) => {
    const below = prices.filter((p) => p.y > o.y);
    const next = orders[i + 1];
    const price = below.find((p) => !next || p.y < next.y) || null;

    // 날짜는 그룹 머리글이라 세로 중앙에 한 번만 찍힌다 → 가장 가까운 것을 쓴다
    let date = null;
    let best = Infinity;
    for (const d of dates) {
      const gap = Math.abs(d.y - o.y);
      if (gap < best) { best = gap; date = d.date; }
    }

    return {
      date,
      type: o.type,
      quantity: o.quantity,
      unitPrice: price ? price.unitPrice : 0,
    };
  });

  return { stockName, rows };
}
