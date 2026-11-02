// 비밀번호 찾기 — 메일 인증번호 → 확인 → 새 비밀번호
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, browser } from './helpers.js';

let t; let mail;
let outbox = [];
before(async () => {
  // 전체 하루 상한은 reset-cap.test.js 에서 따로 본다 — 여기서는 걸리지 않게 넉넉히
  t = await startApp({ MAIL_DAILY_LIMIT: '1000' });
  ({ mail } = await import('../lib/mail.js'));
});
after(() => t.close());

// 실제 메일 대신 보낸 것을 모아 둔다 (mode 는 설정 없는 로컬 실행 그대로)
beforeEach(() => {
  outbox = [];
  mail.mode = 'console';
  mail.send = async (msg) => { outbox.push(msg); };
});

let seq = 0;
/** 새 사용자를 가입시키고 그 브라우저를 돌려준다 */
async function makeUser(email = 'family@example.com', password = 'oldpass11') {
  const username = `user${++seq}`;
  const b = browser(t.base);
  const r = await b('/auth/register', { username, password, email });
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

/** 메일 받기 → 인증 → 토큰 */
async function getToken(u) {
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  const v = await b('/auth/reset/verify', { username: u.username, code: codeIn(outbox.at(-1)) });
  assert.equal(v.ok, true, v.error);
  return { b, token: v.token };
}

/* ─────────── 메일 보내기 ─────────── */

test('아이디와 이메일이 맞으면 등록된 주소로 6자리 인증번호 메일을 보낸다', async () => {
  const u = await makeUser('family@example.com');
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  assert.equal(r.ok, true, r.error);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'family@example.com');
  assert.match(outbox[0].text, /\d{6}/);
  assert.equal(r.sentTo, 'fa****@example.com'); // 화면에는 가린 번호만 보여 준다
});

test('아이디·이메일은 대소문자·앞뒤 공백과 상관없이 찾는다', async () => {
  const u = await makeUser();
  const r = await browser(t.base)('/auth/reset/request', { username: ` ${u.username.toUpperCase()} `, email: ' FAMILY@Example.com ' });
  assert.equal(r.ok, true, r.error);
  assert.equal(outbox.length, 1);
});

test('이메일이 다르면 메일을 보내지 않는다', async () => {
  const u = await makeUser('family@example.com');
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, email: 'other@example.com' });
  assert.equal(r.ok, false);
  assert.equal(outbox.length, 0);
});

test('없는 아이디도 이메일이 틀렸을 때와 같은 오류로 답한다', async () => {
  const u = await makeUser('family@example.com');
  const b = browser(t.base);
  const wrongEmail = await b('/auth/reset/request', { username: u.username, email: 'other@example.com' });
  const noUser = await b('/auth/reset/request', { username: 'nobody-here', email: 'other@example.com' });
  assert.equal(noUser.status, wrongEmail.status);
  assert.equal(noUser.error, wrongEmail.error);
  assert.equal(outbox.length, 0);
});

test('이메일을 등록하지 않은 사용자에게는 보내지 않는다', async () => {
  const u = await makeUser('family@example.com');
  await t.db.run('UPDATE users SET email = NULL WHERE username = ?', u.username);
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, email: '' });
  assert.equal(r.ok, false);
  assert.equal(outbox.length, 0);
});

test('메일 설정이 없는 로컬 실행이면 응답에 devMode 를 알려 준다', async () => {
  const u = await makeUser();
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  assert.equal(r.devMode, true);
});

test('1분 안에 다시 받으려 하면 거절하고 메일을 보내지 않는다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  const again = await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  assert.equal(again.status, 429);
  assert.equal(outbox.length, 1);
});

test('한 사람은 하루 5통까지만 받는다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  for (let i = 0; i < 5; i++) {
    const r = await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
    assert.equal(r.ok, true, `${i + 1}번째: ${r.error}`);
    await skipCooldown(u.username);
  }
  const sixth = await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  assert.equal(sixth.status, 429);
  assert.equal(outbox.length, 5);
});

test('메일 발송이 설정되지 않은 배포 환경이면 503 으로 알린다', async () => {
  const u = await makeUser();
  mail.mode = null;
  const r = await browser(t.base)('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  assert.equal(r.status, 503);
  assert.equal(outbox.length, 0);
});

test('메일 발송이 실패하면 오류를 알리고, 기다리지 않고 다시 받을 수 있다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  mail.send = async () => { throw new Error('SMTP 연결 실패'); };
  const logged = [];
  const realError = console.error;
  console.error = (e) => logged.push(e); // 서버가 남기는 오류 기록을 시험 출력에서 뺀다
  const failed = await b('/auth/reset/request', { username: u.username, email: 'family@example.com' })
    .finally(() => { console.error = realError; });
  assert.match(String(logged[0]), /SMTP 연결 실패/); // 원인은 서버 기록에 남는다
  assert.equal(failed.ok, false);
  assert.ok(failed.status >= 500);

  mail.send = async (msg) => { outbox.push(msg); };
  const retry = await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  assert.equal(retry.ok, true, retry.error);
  assert.equal(outbox.length, 1);
});

/* ─────────── 인증번호 확인 ─────────── */

test('틀린 인증번호로는 토큰을 받을 수 없다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  const r = await b('/auth/reset/verify', { username: u.username, code: otherCode(codeIn(outbox[0])) });
  assert.equal(r.ok, false);
  assert.equal(r.token, undefined);
});

test('5번 틀리면 맞는 인증번호도 받지 않는다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  const code = codeIn(outbox[0]);
  for (let i = 0; i < 5; i++) await b('/auth/reset/verify', { username: u.username, code: otherCode(code) });
  const r = await b('/auth/reset/verify', { username: u.username, code });
  assert.equal(r.ok, false);
  assert.equal(r.token, undefined);
});

test('4번 틀려도 5번째에 맞으면 통과한다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  const code = codeIn(outbox[0]);
  for (let i = 0; i < 4; i++) await b('/auth/reset/verify', { username: u.username, code: otherCode(code) });
  const r = await b('/auth/reset/verify', { username: u.username, code });
  assert.equal(r.ok, true, r.error);
});

test('유효 시간이 지난 인증번호는 받지 않는다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  await t.db.run(`UPDATE password_resets SET expires_at = ?
                   WHERE user_id = (SELECT id FROM users WHERE username = ?)`, isoAgo(1000), u.username);
  const r = await b('/auth/reset/verify', { username: u.username, code: codeIn(outbox[0]) });
  assert.equal(r.ok, false);
});

test('새 인증번호를 받으면 이전 번호는 쓸 수 없다', async () => {
  const u = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  await skipCooldown(u.username);
  await b('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  const [first, second] = outbox.map(codeIn);
  if (first === second) return; // 백만분의 일 확률로 같은 번호가 나오면 이 시험은 의미가 없다

  assert.equal((await b('/auth/reset/verify', { username: u.username, code: first })).ok, false);
  assert.equal((await b('/auth/reset/verify', { username: u.username, code: second })).ok, true);
});

test('인증번호는 다른 사람 아이디로는 통하지 않는다', async () => {
  const a = await makeUser();
  const other = await makeUser();
  const b = browser(t.base);
  await b('/auth/reset/request', { username: a.username, email: 'family@example.com' });
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
  await browser(t.base)('/auth/reset/request', { username: u.username, email: 'family@example.com' });
  const r = await browser(t.base)('/auth/reset/confirm', { token: '', password: 'newpass22' });
  assert.equal(r.ok, false);
});
