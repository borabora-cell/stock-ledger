// 휴대폰 번호 등록 — 비밀번호 찾기 문자를 받을 번호
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, browser } from './helpers.js';

let t;
before(async () => { t = await startApp(); });
after(() => t.close());

test('휴대폰 번호 없이는 가입할 수 없다', async () => {
  const b = browser(t.base);
  const r = await b('/auth/register', { username: 'nophone', password: 'password1' });
  assert.equal(r.status, 400);
  assert.equal(r.ok, false);
});

test('휴대폰 번호 형식이 아니면 가입할 수 없다', async () => {
  const b = browser(t.base);
  const r = await b('/auth/register', { username: 'badphone', password: 'password1', phone: '02-123-4567' });
  assert.equal(r.status, 400);
});

test('가입한 번호는 숫자만 저장되고, 내 정보에는 가운데를 가려 보여준다', async () => {
  const b = browser(t.base);
  const r = await b('/auth/register', { username: 'mom', password: 'password1', phone: '010-1234-5678' });
  assert.equal(r.ok, true);

  const row = await t.db.get('SELECT phone FROM users WHERE username = ?', 'mom');
  assert.equal(row.phone, '01012345678');

  const me = await b('/auth/me');
  assert.equal(me.user.phone, '010-****-5678');
});

test('번호가 없는 기존 사용자는 내 정보에 phone 이 null 이다', async () => {
  const b = browser(t.base);
  await b('/auth/register', { username: 'old', password: 'password1', phone: '01011112222' });
  await t.db.run("UPDATE users SET phone = NULL WHERE username = 'old'");
  const me = await b('/auth/me');
  assert.equal(me.user.phone, null);
});

test('번호 변경은 현재 비밀번호가 맞아야 한다', async () => {
  const b = browser(t.base);
  await b('/auth/register', { username: 'dad', password: 'password1', phone: '01011112222' });

  const wrong = await b('/auth/phone', { password: 'nope-nope', phone: '010-9999-8888' });
  assert.equal(wrong.status, 401);
  assert.equal((await t.db.get("SELECT phone FROM users WHERE username='dad'")).phone, '01011112222');

  const okay = await b('/auth/phone', { password: 'password1', phone: '010-9999-8888' });
  assert.equal(okay.ok, true);
  assert.equal((await t.db.get("SELECT phone FROM users WHERE username='dad'")).phone, '01099998888');
  assert.equal((await b('/auth/me')).user.phone, '010-****-8888');
});

test('번호 변경은 로그인해야 한다', async () => {
  const b = browser(t.base);
  const r = await b('/auth/phone', { password: 'password1', phone: '01099998888' });
  assert.equal(r.status, 401);
});

test('번호 변경도 형식이 틀리면 거절한다', async () => {
  const b = browser(t.base);
  await b('/auth/register', { username: 'aunt', password: 'password1', phone: '01011112222' });
  const r = await b('/auth/phone', { password: 'password1', phone: '1234' });
  assert.equal(r.status, 400);
  assert.equal((await t.db.get("SELECT phone FROM users WHERE username='aunt'")).phone, '01011112222');
});
