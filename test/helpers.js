// 시험용: 임시 DB 로 앱을 띄우고, 쿠키를 기억하는 «브라우저»를 만든다.
// node --test 는 시험 파일마다 따로 프로세스를 띄우므로 파일끼리 DB 가 섞이지 않는다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function startApp(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-ledger-test-'));
  for (const k of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'VERCEL', 'RENDER', 'SIGNUP_CODE',
    'SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT', 'MAIL_DAILY_LIMIT']) delete process.env[k];
  Object.assign(process.env, { DATA_DIR: dir, DB_PATH: path.join(dir, 'test.db') }, env);

  const { default: app } = await import('../app.js');
  const { db } = await import('../lib/db.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base, db,
    close: () => new Promise((r) => server.close(r)),
  };
}

// 요청마다 다른 IP 로 보낸다 — IP 당 분당 10회 제한에 시험이 걸리지 않게
let ipSeq = 0;
const nextIp = () => { ipSeq++; return `10.9.${ipSeq >> 8}.${ipSeq & 255}`; };

/** 쿠키를 기억하는 브라우저 하나. call(경로, 본문) → {status, ...응답JSON} */
export function browser(base) {
  let cookie = '';
  return async function call(p, body) {
    const res = await fetch(`${base}/api${p}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': nextIp(),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      cookie = kv.endsWith('=') ? '' : kv;
    }
    return { status: res.status, ...(await res.json()) };
  };
}
