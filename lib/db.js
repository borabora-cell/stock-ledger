// 데이터베이스 (libSQL)
//  - 로컬 실행   : data/stock.db 파일
//  - 클라우드 배포 : Turso (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)
// 두 경우 모두 같은 SQL 을 쓴다.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'stock.db');

const REMOTE_URL = (process.env.TURSO_DATABASE_URL || '').trim();
export const IS_REMOTE = /^(libsql|wss?|https?):/i.test(REMOTE_URL);

/** 서버리스인데 클라우드 DB 주소가 없다 → 환경변수 설정이 아직 안 된 상태 */
export const NEEDS_SETUP = !!process.env.VERCEL && !IS_REMOTE;

if (!IS_REMOTE && !NEEDS_SETUP) mkdirSync(DATA_DIR, { recursive: true });

// 원격일 때는 네이티브 모듈이 필요 없는 web 빌드를 쓴다 (서버리스 번들 안정성)
const { createClient } = IS_REMOTE
  ? await import('@libsql/client/web')
  : await import('@libsql/client');

export const client = createClient(
  IS_REMOTE
    ? { url: REMOTE_URL, authToken: process.env.TURSO_AUTH_TOKEN || undefined }
    : { url: 'file:' + (NEEDS_SETUP ? '/tmp/setup.db' : DB_PATH.replace(/\\/g, '/')) }
);

export const DB_LABEL = IS_REMOTE
  ? `Turso (${REMOTE_URL.replace(/^libsql:\/\//, '')})`
  : DB_PATH;

/* ─────────── 값 변환 ─────────── */

const normArgs = (args) => args.map((v) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
});

function toObjects(rs) {
  const cols = rs.columns;
  return rs.rows.map((row) => {
    const o = {};
    for (let i = 0; i < cols.length; i++) o[cols[i]] = row[i];
    return o;
  });
}

const toRunResult = (rs) => ({
  changes: Number(rs.rowsAffected ?? 0),
  lastInsertRowid: rs.lastInsertRowid === undefined || rs.lastInsertRowid === null
    ? 0 : Number(rs.lastInsertRowid),
});

async function exec(sql, args = []) {
  return client.execute({ sql, args: normArgs(args) });
}

export const db = {
  async all(sql, ...args) { return toObjects(await exec(sql, args)); },
  async get(sql, ...args) { return (await this.all(sql, ...args))[0]; },
  async run(sql, ...args) { return toRunResult(await exec(sql, args)); },

  /** 여러 쓰기를 원자적으로 실행한다 */
  async batch(statements) {
    const list = statements.filter(Boolean).map((s) => ({
      sql: s.sql, args: normArgs(s.args || []),
    }));
    if (!list.length) return [];
    return client.batch(list, 'write');
  },
};

/* ─────────── 스키마 ─────────── */

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 비밀번호 찾기. 메일로 보낸 인증번호(해시)와, 인증을 통과하면 받는 일회용 토큰.
-- 시각은 모두 ISO 문자열(UTC) 이라 문자열 비교로 앞뒤를 가린다.
CREATE TABLE IF NOT EXISTS password_resets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash        TEXT NOT NULL,
  attempts         INTEGER NOT NULL DEFAULT 0,
  sent_at          TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  reset_token      TEXT UNIQUE,
  token_expires_at TEXT,
  used_at          TEXT
);

CREATE TABLE IF NOT EXISTS stocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL DEFAULT 0,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_id          INTEGER NOT NULL REFERENCES stocks(id) ON DELETE CASCADE,
  type              TEXT NOT NULL CHECK (type IN ('buy','sell')),
  txn_date          TEXT NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price        REAL NOT NULL,
  total_amount      REAL NOT NULL,
  screenshot_id     INTEGER,
  realized_pl       REAL,
  realized_pl_pct   REAL,
  memo              TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 거래 증빙 캡처. 파일시스템 대신 DB 에 담아 서버리스 배포에서도 그대로 동작한다.
CREATE TABLE IF NOT EXISTS screenshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  mime       TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sale_matches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  sell_txn_id         INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  buy_txn_id          INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  matched_qty         INTEGER NOT NULL,
  cost_unit_price     REAL NOT NULL,
  proceeds_unit_price REAL NOT NULL,
  realized_pl         REAL NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_txn_stock ON transactions(stock_id);
CREATE INDEX IF NOT EXISTS idx_match_sell ON sale_matches(sell_txn_id);
CREATE INDEX IF NOT EXISTS idx_match_buy ON sale_matches(buy_txn_id);
CREATE INDEX IF NOT EXISTS idx_session_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_sent ON password_resets(sent_at);
`;

/** 이미 만들어진 DB 에 열을 더할 때 (SQLite 는 ADD COLUMN IF NOT EXISTS 가 없다) */
async function ensureColumn(table, column, ddl) {
  const info = toObjects(await client.execute(`PRAGMA table_info(${table})`));
  if (!info.some((c) => c.name === column)) {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

async function initSchema() {
  await client.executeMultiple(SCHEMA);
  // 로그인 기능이 없던 버전의 DB 를 올려받는 경우
  await ensureColumn('stocks', 'user_id', 'user_id INTEGER NOT NULL DEFAULT 0');
  // 비밀번호 찾기 인증번호를 받을 이메일 (소문자). 이 열이 생기기 전에 가입한 사용자는 NULL
  await ensureColumn('users', 'email', 'email TEXT');
  // 열이 생긴 뒤에야 인덱스를 만들 수 있다
  await client.execute('CREATE INDEX IF NOT EXISTS idx_stock_user ON stocks(user_id)');
}

let readyPromise;
export function ready() {
  if (!readyPromise) readyPromise = initSchema();
  return readyPromise;
}
