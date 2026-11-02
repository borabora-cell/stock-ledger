// 비밀번호 찾기 — 전체 하루 문자 상한 (상한을 1통으로 띄운 별도 프로세스)
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, browser } from './helpers.js';

let t; let sms;
before(async () => {
  t = await startApp({ SMS_DAILY_LIMIT: '1' });
  ({ sms } = await import('../lib/sms.js'));
});
after(() => t.close());

test('하루 전체 발송 상한에 닿으면 다른 사람에게도 보내지 않는다', async () => {
  const outbox = [];
  sms.send = async (to, text) => { outbox.push({ to, text }); };

  for (const username of ['capa', 'capb']) {
    await browser(t.base)('/auth/register', { username, password: 'password1', phone: '01012345678' });
  }
  const first = await browser(t.base)('/auth/reset/request', { username: 'capa', phone: '01012345678' });
  assert.equal(first.ok, true, first.error);

  const second = await browser(t.base)('/auth/reset/request', { username: 'capb', phone: '01012345678' });
  assert.equal(second.status, 429);
  assert.equal(outbox.length, 1);
});
