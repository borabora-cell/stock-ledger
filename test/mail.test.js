// 메일 발송 — 보내는 메일의 모양, SMTP 설정, 설정이 없을 때의 동작
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, smtpOptions, maskEmail } from '../lib/mail.js';

const keys = { user: 'family.ledger@gmail.com', pass: 'abcdefghijklmnop' };

test('설정이 있으면 Gmail 계정 이름으로 받는 사람·제목·본문을 담아 보낸다', async () => {
  // jsonTransport: 실제로 보내지 않고 만들어진 메일을 돌려준다
  const mail = createMailer({ ...keys, transport: { jsonTransport: true } });
  assert.equal(mail.mode, 'smtp');

  const info = await mail.send({ to: 'mom@example.com', subject: '인증번호', text: '123456' });
  const msg = JSON.parse(info.message);
  assert.deepEqual(msg.to, [{ address: 'mom@example.com', name: '' }]);
  assert.deepEqual(msg.from, { address: 'family.ledger@gmail.com', name: '주식가계부' });
  assert.equal(msg.subject, '인증번호');
  assert.equal(msg.text, '123456');
});

test('SMTP 기본값은 Gmail 465번(암호화 연결)이고, 오래 매달리지 않게 시간 제한을 둔다', () => {
  const o = smtpOptions({ ...keys });
  assert.equal(o.host, 'smtp.gmail.com');
  assert.equal(o.port, 465);
  assert.equal(o.secure, true);
  assert.deepEqual(o.auth, { user: 'family.ledger@gmail.com', pass: 'abcdefghijklmnop' });
  assert.ok(o.connectionTimeout > 0 && o.connectionTimeout <= 15_000);
});

test('587번처럼 465 가 아닌 포트는 STARTTLS(secure: false) 로 연결한다', () => {
  const o = smtpOptions({ ...keys, host: 'smtp.naver.com', port: 587 });
  assert.equal(o.host, 'smtp.naver.com');
  assert.equal(o.secure, false);
});

test('앱 비밀번호를 띄어쓰기째 붙여 넣어도 공백을 빼고 쓴다', () => {
  // Google 은 앱 비밀번호를 «abcd efgh ijkl mnop» 처럼 4자리씩 띄어 보여준다
  const o = smtpOptions({ user: keys.user, pass: ' abcd efgh ijkl mnop ' });
  assert.equal(o.auth.pass, 'abcdefghijklmnop');
});

test('설정이 없는 로컬 실행에서는 메일 대신 서버 창에 내용을 찍는다', async () => {
  const lines = [];
  const mail = createMailer({ log: (s) => lines.push(s) });
  assert.equal(mail.mode, 'console');

  await mail.send({ to: 'mom@example.com', subject: '인증번호', text: '인증번호 654321' });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /mom@example\.com/);
  assert.match(lines[0], /654321/);
});

test('설정이 없는 배포 환경에서는 보낼 수 없다고 알린다', async () => {
  const mail = createMailer({ deployed: true });
  assert.equal(mail.mode, null);
  await assert.rejects(mail.send({ to: 'mom@example.com', subject: 's', text: 't' }));
});

test('계정과 비밀번호 중 하나라도 빠지면 SMTP 로 보내지 않는다', () => {
  assert.equal(createMailer({ user: keys.user }).mode, 'console');
  assert.equal(createMailer({ pass: keys.pass, deployed: true }).mode, null);
});

test('이메일 가리기: 앞 두 글자만 남긴다 (짧은 주소는 한 글자)', () => {
  assert.equal(maskEmail('family@example.com'), 'fa****@example.com');
  assert.equal(maskEmail('ab@x.kr'), 'a*@x.kr');
  assert.equal(maskEmail('a@x.kr'), 'a*@x.kr');
  assert.equal(maskEmail(null), null);
});
