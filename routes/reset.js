// 비밀번호 찾기 — 등록된 휴대폰으로 인증번호 문자 → 확인 → 새 비밀번호
//   1) POST /auth/reset/request {username, phone}  아이디와 번호가 맞으면 6자리 인증번호 문자
//   2) POST /auth/reset/verify  {username, code}   번호가 맞으면 일회용 토큰
//   3) POST /auth/reset/confirm {token, password}  비밀번호 변경 → 모든 기기 로그아웃 → 이 기기 로그인
// 문자는 건당 요금이 나가므로, 등록된 번호로만 보내고 보내는 횟수를 막아 둔다.
import crypto from 'node:crypto';
import express from 'express';
import { db } from '../lib/db.js';
import { setPassword, createSession, setSessionCookie, rateLimit, cleanUsername } from '../lib/auth.js';
import { sms, normalizePhone, maskPhone } from '../lib/sms.js';

const CODE_MIN = 10;       // 인증번호 유효 시간(분)
const TOKEN_MIN = 10;      // 인증 뒤 새 비밀번호를 정할 수 있는 시간(분)
const RESEND_SEC = 60;     // 다시 받기 간격(초)
const MAX_ATTEMPTS = 5;    // 인증번호를 넣어 볼 수 있는 횟수
const PER_USER_DAILY = 5;  // 한 사람이 24시간 동안 받을 수 있는 문자
// 전체 24시간 상한 — 누구나 가입할 수 있는 주소라면 가입을 여러 번 해 문자를 쏘게 만드는 것을 막는다
const DAILY_TOTAL = Number(process.env.SMS_DAILY_LIMIT) || 30;

const DAY = 864e5;
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fail = (res, status, error) => res.status(status).json({ ok: false, error });

const EXPIRED = '인증번호가 만료되었습니다. 인증번호를 다시 받아 주세요.';
const TOO_MANY = `인증번호를 ${MAX_ATTEMPTS}번 틀렸습니다. 인증번호를 다시 받아 주세요.`;
const TOKEN_GONE = '인증 시간이 지났습니다. 처음부터 다시 해 주세요.';

const router = express.Router();

router.post('/auth/reset/request', rateLimit, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body?.username);
    const phone = normalizePhone(req.body?.phone);
    if (!username || !phone) return fail(res, 400, '아이디와 휴대폰 번호를 확인해 주세요.');
    if (sms.mode === null) {
      return fail(res, 503, '문자 발송이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.');
    }

    const user = await db.get('SELECT id, phone FROM users WHERE username = ?', username);
    // 아이디가 없는지 번호가 다른지 구분해서 알려주지 않는다
    if (!user || user.phone !== phone) {
      return fail(res, 404, '아이디와 휴대폰 번호가 맞는 계정이 없습니다.');
    }

    await db.run('DELETE FROM password_resets WHERE sent_at < ?', iso(-2 * DAY)); // 지난 기록 정리

    // 지난 24시간: 이 사람의 마지막 발송 시각·발송 수, 전체 발송 수
    const recent = await db.get(`
      SELECT MAX(CASE WHEN user_id = ?1 THEN sent_at END) AS last,
             COALESCE(SUM(user_id = ?1), 0)               AS mine,
             COUNT(*)                                     AS total
        FROM password_resets WHERE sent_at > ?2`, user.id, iso(-DAY));
    const wait = recent.last
      ? Math.ceil((Date.parse(recent.last) + RESEND_SEC * 1000 - Date.now()) / 1000) : 0;
    if (wait > 0) return fail(res, 429, `${wait}초 뒤에 다시 받을 수 있습니다.`);
    if (recent.mine >= PER_USER_DAILY) {
      return fail(res, 429, '오늘은 인증번호를 더 받을 수 없습니다. 내일 다시 해 주세요.');
    }
    if (recent.total >= DAILY_TOTAL) {
      return fail(res, 429, '오늘 보낼 수 있는 문자를 모두 보냈습니다. 내일 다시 해 주세요.');
    }

    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    const r = await db.run(
      'INSERT INTO password_resets (user_id, code_hash, sent_at, expires_at) VALUES (?, ?, ?, ?)',
      user.id, sha256(code), iso(), iso(CODE_MIN * 60_000));
    try {
      await sms.send(phone, `[주식가계부] 비밀번호 찾기 인증번호 [${code}]`);
    } catch (e) {
      // 보내지 못한 건은 횟수·대기 시간에 넣지 않는다
      await db.run('DELETE FROM password_resets WHERE id = ?', r.lastInsertRowid);
      console.error(e);
      return fail(res, 502, '문자를 보내지 못했습니다. 잠시 후 다시 해 주세요.');
    }

    res.json({
      ok: true,
      sentTo: maskPhone(phone),
      expiresInSec: CODE_MIN * 60,
      resendInSec: RESEND_SEC,
      devMode: sms.mode === 'console', // 로컬: 문자 대신 서버 창에 찍었다
    });
  } catch (e) { next(e); }
});

router.post('/auth/reset/verify', rateLimit, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body?.username);
    const code = String(req.body?.code || '').replace(/\D/g, '');

    // 가장 최근에 보낸 번호만 받는다 (새로 받으면 이전 번호는 무효)
    const rec = await db.get(`
      SELECT r.id, r.code_hash, r.attempts, r.expires_at, r.reset_token
        FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE u.username = ?
       ORDER BY r.id DESC LIMIT 1`, username);
    if (!rec || rec.reset_token || rec.expires_at < iso()) return fail(res, 400, EXPIRED);

    // 넣어 본 횟수를 먼저 하나 올린다 — 동시에 여러 번 넣어 횟수 제한을 피하지 못하게
    const claim = await db.run(
      'UPDATE password_resets SET attempts = attempts + 1 WHERE id = ? AND attempts < ?', rec.id, MAX_ATTEMPTS);
    if (!claim.changes) return fail(res, 429, TOO_MANY);

    if (!sameHash(sha256(code), rec.code_hash)) {
      const left = MAX_ATTEMPTS - rec.attempts - 1;
      return fail(res, 400, left > 0 ? `인증번호가 맞지 않습니다. (${left}번 남음)` : TOO_MANY);
    }

    const token = crypto.randomBytes(32).toString('hex');
    await db.run('UPDATE password_resets SET reset_token = ?, token_expires_at = ? WHERE id = ?',
      token, iso(TOKEN_MIN * 60_000), rec.id);
    res.json({ ok: true, token });
  } catch (e) { next(e); }
});

router.post('/auth/reset/confirm', rateLimit, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');

    const rec = token && await db.get(`
      SELECT r.id, r.token_expires_at, u.id AS user_id, u.username
        FROM password_resets r JOIN users u ON u.id = r.user_id
       WHERE r.reset_token = ? AND r.used_at IS NULL`, token);
    if (!rec || rec.token_expires_at < iso()) return fail(res, 400, TOKEN_GONE);
    if (password.length < 8) return fail(res, 400, '새 비밀번호는 8자 이상으로 만들어 주세요.');

    // 토큰을 먼저 쓴 것으로 표시한다 — 같은 토큰으로 두 번 바꾸지 못하게
    const claim = await db.run(
      'UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL', iso(), rec.id);
    if (!claim.changes) return fail(res, 400, TOKEN_GONE);

    await setPassword(rec.user_id, password); // 모든 기기 로그아웃
    setSessionCookie(res, req, await createSession(rec.user_id));
    res.json({ ok: true, user: { id: rec.user_id, username: rec.username } });
  } catch (e) { next(e); }
});

export default router;
