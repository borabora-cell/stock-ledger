// 비밀번호 찾기 — 문자 인증번호 → 확인 → 새 비밀번호
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, browser } from './helpers.js';

let t; let sms;
let outbox = [];
before(async () => {
  // 전체 하루 상한은 reset-cap.test.js 에서 따로 본다 — 여기서는 걸리지 않게 넉넉히
  t = await startApp({ SMS_DAILY_LIMIT: '1000' });
  ({ sms } = await import('../lib/sms.js'));
});
after(() => t.close());

// 실제 문자 대신 보낸 것을 모아 둔다 (mode 는 키 없는 로컬 실행 그대로)
beforeEach(() => {
  outbox = [];
  sms.mode = 'console';
  sms.send = async (to, text) => { outbox.push({ to, text }); };
});

let seq = 0;
/** 새 사용자를 가입시키고 그 브라우저를 돌려준다 */
async function makeUser(phone = '010-1234-5678', password = 'oldpass11') {
  const username = `user${++seq}`;
  const b = browser(t.base);
  const r = await b('/auth/register', { username, password, phone });
  assert.equal(r.ok, true, r.error);
  return { username, password, b };
}

const codeIn = (msg) => /\d{6}/.exec(msg.text)[0];
const otherCode = (code) => String((Number(code) + 1) % 1e6).padStart(6, '0');
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

/** 같은 사람의 지난 발송을 2분 전으로 돌려 재발송 대기(60초)를 넘긴다 */
const skipCooldown = (username) => t.db.run(
  'UPDATE password_resets SET sent_at = ? WHERE user_id = (SELECT id FROM users WHERE username = ?)',
  isoAgo(120_000), username);

/** 문자 받기 → 인증 → 토큰 */
async function getToken(u) {
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  const v = await b('/auth/reset/verify', { username: u.username, code: codeIn(outbox.at(-1)) });
  assert.equal(v.ok, true, v.error);
  return { b, token: v.token };
}

/* ─────────── 문자 보내기 ─────────── */

test('아이디와 번호가 맞으면 등록된 번호로 6자리 인증번호 문자를 보낸다', async () => {
  const u = await makeUser('010-1234-5678');
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, phone: '01012345678' });
  assert.equal(r.ok, true, r.error);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, '01012345678');
  assert.match(outbox[0].text, /\d{6}/);
  assert.equal(r.sentTo, '010-****-5678'); // 화면에는 가린 번호만 보여 준다
});

test('아이디는 대소문자·앞뒤 공백과 상관없이 찾는다', async () => {
  const u = await makeUser();
  const r = await browser(t.base)('/auth/reset/request', { username: ` ${u.username.toUpperCase()} `, phone: '010-1234-5678' });
  assert.equal(r.ok, true, r.error);
  assert.equal(outbox.length, 1);
});

test('번호가 다르면 문자를 보내지 않는다', async () => {
  const u = await makeUser('010-1234-5678');
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, phone: '010-9999-9999' });
  assert.equal(r.ok, false);
  assert.equal(outbox.length, 0);
});

test('없는 아이디도 번호가 틀렸을 때와 같은 오류로 답한다', async () => {
  const u = await makeUser('010-1234-5678');
  const b = browser(t.base);
  const wrongPhone = await b('/auth/reset/request', { username: u.username, phone: '010-9999-9999' });
  const noUser = await b('/auth/reset/request', { username: 'nobody-here', phone: '010-9999-9999' });
  assert.equal(noUser.status, wrongPhone.status);
  assert.equal(noUser.error, wrongPhone.error);
  assert.equal(outbox.length, 0);
});

test('번호를 등록하지 않은 사용자에게는 보내지 않는다', async () => {
  const u = await makeUser('010-1234-5678');
  await t.db.run('UPDATE users SET phone = NULL WHERE username = ?', u.username);
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, phone: '' });
  assert.equal(r.ok, false);
  assert.equal(outbox.length, 0);
});

test('키가 없는 로컬 실행이면 응답에 devMode 를 알려 준다', async () => {
  const u = await makeUser();
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, phone: '01012345678' });
  assert.equal(r.devMode, true);
});

test('1분 안에 다시 받으려 하면 거절하고 문자를 보내지 않는다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  const again = await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  assert.equal(again.status, 429);
  assert.equal(outbox.length, 1);
});

test('한 사람은 하루 5통까지만 받는다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  for (let i = 0; i < 5; i++) {
    const r = await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
    assert.equal(r.ok, true, `${i + 1}번째: ${r.error}`);
    await skipCooldown(u.username);
  }
  const sixth = await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  assert.equal(sixth.status, 429);
  assert.equal(outbox.length, 5);
});

test('문자 발송이 설정되지 않은 배포 환경이면 503 으로 알린다', async () => {
  const u = await makeUser();
  sms.mode = null;
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, phone: '01012345678' });
  assert.equal(r.status, 503);
  assert.equal(outbox.length, 0);
});

test('문자 발송이 실패하면 오류를 알리고, 기다리지 않고 다시 받을 수 있다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  sms.send = async () => { throw new Error('발신번호 미등록'); };
  const logged = [];
  const realError = console.error;
  console.error = (e) => logged.push(e); // 서버가 남기는 오류 기록을 시험 출력에서 뺀다
  const failed = await b('/auth/reset/request', { username: u.username, phone: '01012345678' })
    .finally(() => { console.error = realError; });
  assert.match(String(logged[0]), /발신번호 미등록/); // 원인은 서버 기록에 남는다
  assert.equal(failed.ok, false);
  assert.ok(failed.status >= 500);

  sms.send = async (to, text) => { outbox.push({ to, text }); };
  const retry = await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  assert.equal(retry.ok, true, retry.error);
  assert.equal(outbox.length, 1);
});

/* ─────────── 인증번호 확인 ─────────── */

test('틀린 인증번호로는 토큰을 받을 수 없다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  const r = await b('/auth/reset/verify', { username: u.username, code: otherCode(codeIn(outbox[0])) });
  assert.equal(r.ok, false);
  assert.equal(r.token, undefined);
});

test('5번 틀리면 맞는 인증번호도 받지 않는다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  const code = codeIn(outbox[0]);
  for (let i = 0; i < 5; i++) await b('/auth/reset/verify', { username: u.username, code: otherCode(code) });
  const r = await b('/auth/reset/verify', { username: u.username, code });
  assert.equal(r.ok, false);
  assert.equal(r.token, undefined);
});

test('4번 틀려도 5번째에 맞으면 통과한다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  const code = codeIn(outbox[0]);
  for (let i = 0; i < 4; i++) await b('/auth/reset/verify', { username: u.username, code: otherCode(code) });
  const r = await b('/auth/reset/verify', { username: u.username, code });
  assert.equal(r.ok, true, r.error);
});

test('유효 시간이 지난 인증번호는 받지 않는다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  await t.db.run(`UPDATE password_resets SET expires_at = ?
                   WHERE user_id = (SELECT id FROM users WHERE username = ?)`, isoAgo(1000), u.username);
  const r = await b('/auth/reset/verify', { username: u.username, code: codeIn(outbox[0]) });
  assert.equal(r.ok, false);
});

test('새 인증번호를 받으면 이전 번호는 쓸 수 없다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  await skipCooldown(u.username);
  await b('/auth/reset/request', { username: u.username, phone: '01012345678' });
  const [first, second] = outbox.map(codeIn);
  if (first === second) return; // 백만분의 일 확률로 같은 번호가 나오면 이 시험은 의미가 없다

  assert.equal((await b('/auth/reset/verify', { username: u.username, code: first })).ok, false);
  assert.equal((await b('/auth/reset/verify', { username: u.username, code: second })).ok, true);
});

test('인증번호는 다른 사람 아이디로는 통하지 않는다', async () => {
  const a = await makeUser();
  const other = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: a.username, phone: '01012345678' });
  const r = await b('/auth/reset/verify', { username: other.username, code: codeIn(outbox[0]) });
  assert.equal(r.ok, false);
});

/* ─────────── 새 비밀번호 ─────────── */

test('인증되면 새 비밀번호로 바뀌고 그 자리에서 로그인된다', async () => {
  const u = await makeUser();
  const { b, token } = await getToken(u);

  const r = await b('/auth/reset/confirm', { token, password: 'newpass22' });
  assert.equal(r.ok, true, r.error);
  assert.equal((await b('/auth/me')).user.username, u.username);

  const oldLogin = await browser(t.base)('/auth/login', { username: u.username, password: u.password });
  assert.equal(oldLogin.ok, false);
  const newLogin = await browser(t.base)('/auth/login', { username: u.username, password: 'newpass22' });
  assert.equal(newLogin.ok, true);
});

test('비밀번호를 바꾸면 다른 기기의 로그인은 모두 끊긴다', async () => {
  const u = await makeUser(); // u.b 는 가입하면서 로그인된 기기
  assert.equal((await u.b('/auth/me')).ok, true);

  const { b, token } = await getToken(u);
  await b('/auth/reset/confirm', { token, password: 'newpass22' });

  assert.equal((await u.b('/auth/me')).status, 401);
});

test('토큰은 한 번만 쓸 수 있다', async () => {
  const u = await makeUser();
  const { b, token } = await getToken(u);
  await b('/auth/reset/confirm', { token, password: 'newpass22' });
  const again = await browser(t.base)('/auth/reset/confirm', { token, password: 'hacked333' });
  assert.equal(again.ok, false);
  const login = await browser(t.base)('/auth/login', { username: u.username, password: 'newpass22' });
  assert.equal(login.ok, true);
});

test('유효 시간이 지난 토큰으로는 바꿀 수 없다', async () => {
  const u = await makeUser();
  const { b, token } = await getToken(u);
  await t.db.run('UPDATE password_resets SET token_expires_at = ? WHERE reset_token = ?', isoAgo(1000), token);
  const r = await b('/auth/reset/confirm', { token, password: 'newpass22' });
  assert.equal(r.ok, false);
  const login = await browser(t.base)('/auth/login', { username: u.username, password: u.password });
  assert.equal(login.ok, true);
});

test('새 비밀번호가 8자 미만이면 거절하고, 같은 토큰으로 다시 할 수 있다', async () => {
  const u = await makeUser();
  const { b, token } = await getToken(u);
  const short = await b('/auth/reset/confirm', { token, password: 'short' });
  assert.equal(short.status, 400);
  const r = await b('/auth/reset/confirm', { token, password: 'longenough1' });
  assert.equal(r.ok, true, r.error);
});

test('인증 전 단계의 기록으로는 비밀번호를 바꿀 수 없다 (빈 토큰)', async () => {
  const u = await makeUser();
  await browser(t.base)('/auth/reset/request', { username: u.username, phone: '01012345678' });
  const r = await browser(t.base)('/auth/reset/confirm', { token: '', password: 'newpass22' });
  assert.equal(r.ok, false);
});
