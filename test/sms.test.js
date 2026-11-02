// 문자 발송 — 솔라피 요청 형식과 실패 판정, 키가 없을 때의 동작
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { createSms } from '../lib/sms.js';

// 솔라피 대신 요청을 받아 기록하고, 정해 둔 응답을 돌려주는 가짜 서버
let fake; let fakeUrl; let lastReq; let reply;
before(async () => {
  fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      lastReq = { method: req.method, path: req.url, headers: req.headers, body: JSON.parse(raw) };
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeUrl = `http://127.0.0.1:${fake.address().port}/messages/v4/send-many/detail`;
});
after(() => new Promise((r) => fake.close(r)));

// 솔라피 send-many/detail 성공 응답 (SDK 의 sendManyDetailResponse 구조)
const okBody = {
  groupInfo: { groupId: 'G1', status: 'SENDING', count: { total: 1, registeredFailed: 0, registeredSuccess: 1 } },
  failedMessageList: [],
};
const keys = { apiKey: 'KEY123', apiSecret: 'SECRET456', from: '0212345678' };

test('키가 있으면 솔라피에 받는 번호·보내는 번호·내용을 담아 보낸다', async () => {
  reply = { status: 200, body: okBody };
  const sms = createSms({ ...keys, url: fakeUrl });
  assert.equal(sms.mode, 'solapi');

  await sms.send('01012345678', '[주식가계부] 인증번호 123456');

  assert.equal(lastReq.method, 'POST');
  assert.equal(lastReq.path, '/messages/v4/send-many/detail');
  assert.deepEqual(lastReq.body, {
    messages: [{ to: '01012345678', from: '0212345678', text: '[주식가계부] 인증번호 123456' }],
  });
});

test('솔라피 인증 헤더는 date+salt 를 비밀키로 HMAC-SHA256 서명한다', async () => {
  reply = { status: 200, body: okBody };
  await createSms({ ...keys, url: fakeUrl }).send('01012345678', 'hi');

  const m = /^HMAC-SHA256 apiKey=KEY123, date=(\S+), salt=([0-9a-zA-Z]{12,64}), signature=([0-9a-f]{64})$/
    .exec(lastReq.headers.authorization);
  assert.ok(m, `헤더 형식이 다름: ${lastReq.headers.authorization}`);
  const [, date, salt, signature] = m;
  assert.ok(Math.abs(Date.parse(date) - Date.now()) < 60_000, `date 가 지금 시각이 아님: ${date}`);
  const want = crypto.createHmac('sha256', 'SECRET456').update(date + salt).digest('hex');
  assert.equal(signature, want);
});

test('솔라피가 실패 목록을 돌려주면 그 사유로 오류를 낸다', async () => {
  reply = {
    status: 200,
    body: {
      groupInfo: { groupId: 'G2', status: 'FAILED', count: { total: 1, registeredFailed: 1, registeredSuccess: 0 } },
      failedMessageList: [{ to: '01012345678', from: '0212345678', type: 'SMS', statusCode: '1062', statusMessage: '발신번호 미등록' }],
    },
  };
  await assert.rejects(
    createSms({ ...keys, url: fakeUrl }).send('01012345678', 'hi'),
    /발신번호 미등록/,
  );
});

test('솔라피가 4xx 로 답하면 errorMessage 로 오류를 낸다', async () => {
  reply = { status: 400, body: { errorCode: 'ValidationError', errorMessage: '잘못된 요청입니다.' } };
  await assert.rejects(
    createSms({ ...keys, url: fakeUrl }).send('01012345678', 'hi'),
    /잘못된 요청입니다/,
  );
});

test('키가 없는 로컬 실행에서는 문자 대신 서버 창에 내용을 찍는다', async () => {
  const lines = [];
  const sms = createSms({ log: (s) => lines.push(s) });
  assert.equal(sms.mode, 'console');

  await sms.send('01012345678', '인증번호 654321');

  assert.equal(lines.length, 1);
  assert.match(lines[0], /01012345678/);
  assert.match(lines[0], /654321/);
});

test('키가 없는 배포 환경에서는 보낼 수 없다고 알린다', async () => {
  const sms = createSms({ deployed: true });
  assert.equal(sms.mode, null);
  await assert.rejects(sms.send('01012345678', 'hi'));
});

test('키 셋 중 하나라도 빠지면 솔라피로 보내지 않는다', () => {
  assert.equal(createSms({ apiKey: 'K', apiSecret: 'S' }).mode, 'console');
  assert.equal(createSms({ apiKey: 'K', from: '0212345678', deployed: true }).mode, null);
});
