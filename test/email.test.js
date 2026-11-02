// 이메일 등록 — 비밀번호 찾기 인증번호를 받을 주소
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, browser } from './helpers.js';

let t;
before(async () => { t = await startApp(); });
after(() => t.close());

test('이메일 없이는 가입할 수 없다', async () => {
  const b = browser(t.base);
  const r = await b('/auth/register', { username: 'nomail', password: 'password1' });
  assert.equal(r.status, 400);
  assert.equal(r.ok, false);
});

test('이메일 형식이 아니면 가입할 수 없다', async () => {
  const b = browser(t.base);
  const r = await b('/auth/register', { username: 'badmail', password: 'password1', email: 'mom@naver' });
  assert.equal(r.status, 400);
});

test('가입한 이메일은 앞뒤 공백·대문자를 정리해 저장하고, 내 정보에는 가려서 보여준다', async () => {
  const b = browser(t.base);
  const r = await b('/auth/register', { username: 'mom', password: 'password1', email: ' Family@Example.COM ' });
  assert.equal(r.ok, true, r.error);

  const row = await t.db.get('SELECT email FROM users WHERE username = ?', 'mom');
  assert.equal(row.email, 'family@example.com');

  const me = await b('/auth/me');
  assert.equal(me.user.email, 'fa****@example.com');
});

test('이메일이 없는 기존 사용자는 내 정보에 email 이 null 이다', async () => {
  const b = browser(t.base);
  await b('/auth/register', { username: 'old', password: 'password1', email: 'old@example.com' });
  await t.db.run("UPDATE users SET email = NULL WHERE username = 'old'");
  const me = await b('/auth/me');
  assert.equal(me.user.email, null);
});

test('이메일 변경은 현재 비밀번호가 맞아야 한다', async () => {
  const b = browser(t.base);
  await b('/auth/register', { username: 'dad', password: 'password1', email: 'dad@example.com' });

  const wrong = await b('/auth/email', { password: 'nope-nope', email: 'dad2@example.com' });
  // 401 은 화면에서 「로그인 풀림」으로 보고 로그인 화면으로 보내 버리므로 403 이어야 한다
  assert.equal(wrong.status, 403);
  assert.equal((await t.db.get("SELECT email FROM users WHERE username='dad'")).email, 'dad@example.com');

  const okay = await b('/auth/email', { password: 'password1', email: 'Dad2@Example.com' });
  assert.equal(okay.ok, true, okay.error);
  assert.equal((await t.db.get("SELECT email FROM users WHERE username='dad'")).email, 'dad2@example.com');
  assert.equal((await b('/auth/me')).user.email, 'da**@example.com');
});

test('비밀번호 변경에서 현재 비밀번호가 틀리면 403 (로그인 화면으로 튕기지 않게)', async () => {
  const b = browser(t.base);
  await b('/auth/register', { username: 'uncle', password: 'password1', email: 'uncle@example.com' });
  const wrong = await b('/auth/password', { current: 'nope-nope', next: 'password2' });
  assert.equal(wrong.status, 403);
  assert.equal((await b('/auth/me')).ok, true); // 로그인은 그대로
});

test('이메일 변경은 로그인해야 한다', async () => {
  const b = browser(t.base);
  const r = await b('/auth/email', { password: 'password1', email: 'x@example.com' });
  assert.equal(r.status, 401);
});

test('이메일 변경도 형식이 틀리면 거절한다', async () => {
  const b = browser(t.base);
  await b('/auth/register', { username: 'aunt', password: 'password1', email: 'aunt@example.com' });
  const r = await b('/auth/email', { password: 'password1', email: 'not-an-email' });
  assert.equal(r.status, 400);
  assert.equal((await t.db.get("SELECT email FROM users WHERE username='aunt'")).email, 'aunt@example.com');
});
