import express from 'express';
import { db } from '../lib/db.js';
import {
  SESSION_COOKIE, SIGNUP_CODE,
  hashPassword, verifyPassword,
  createSession, deleteSession, getSessionUser,
  readCookie, setSessionCookie, clearSessionCookie,
} from '../lib/auth.js';

const router = express.Router();

// 비밀번호 추측 시도 제한 (한 인스턴스 기준 IP 당 분당 10회)
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, start: now };
  if (now - rec.start > 60_000) { rec.count = 0; rec.start = now; }
  rec.count++;
  hits.set(ip, rec);
  if (hits.size > 5000) hits.clear();
  if (rec.count > 10) {
    return res.status(429).json({ ok: false, error: '시도가 너무 잦습니다. 잠시 후 다시 해주세요.' });
  }
  next();
}

const cleanUsername = (v) => String(v || '').trim().toLowerCase();

/** 로그인 화면에서 필요한 정보 (가입 코드가 필요한지 등) */
router.get('/auth/config', async (req, res, next) => {
  try {
    const row = await db.get('SELECT COUNT(*) AS n FROM users');
    res.json({ ok: true, signupCodeRequired: !!SIGNUP_CODE, hasUsers: row.n > 0 });
  } catch (e) { next(e); }
});

/** 지금 로그인한 사용자 */
router.get('/auth/me', async (req, res, next) => {
  try {
    const user = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!user) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    res.json({ ok: true, user });
  } catch (e) { next(e); }
});

router.post('/auth/register', rateLimit, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const code = String(req.body?.code || '').trim();

    if (SIGNUP_CODE && code !== SIGNUP_CODE) {
      return res.status(403).json({ ok: false, error: '가입 코드가 올바르지 않습니다.' });
    }
    if (!/^[a-z0-9_.-]{3,20}$/.test(username)) {
      return res.status(400).json({ ok: false, error: '아이디는 영문·숫자 3~20자로 만들어 주세요.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: '비밀번호는 8자 이상으로 만들어 주세요.' });
    }

    const dup = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (dup) return res.status(409).json({ ok: false, error: '이미 사용 중인 아이디입니다.' });

    const r = await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)',
      username, hashPassword(password));

    const token = await createSession(r.lastInsertRowid);
    setSessionCookie(res, req, token);
    res.json({ ok: true, user: { id: r.lastInsertRowid, username } });
  } catch (e) { next(e); }
});

router.post('/auth/login', rateLimit, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body?.username);
    const password = String(req.body?.password || '');

    const user = await db.get('SELECT id, username, password_hash FROM users WHERE username = ?', username);
    // 아이디가 없는지 비밀번호가 틀린지 구분해서 알려주지 않는다
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }

    const token = await createSession(user.id);
    setSessionCookie(res, req, token);
    res.json({ ok: true, user: { id: user.id, username: user.username } });
  } catch (e) { next(e); }
});

router.post('/auth/logout', async (req, res, next) => {
  try {
    await deleteSession(readCookie(req, SESSION_COOKIE));
    clearSessionCookie(res, req);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** 비밀번호 변경 (현재 비밀번호 확인 후, 다른 기기 세션은 모두 끊는다) */
router.post('/auth/password', rateLimit, async (req, res, next) => {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    const me = await getSessionUser(token);
    if (!me) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });

    const current = String(req.body?.current || '');
    const next_ = String(req.body?.next || '');
    if (next_.length < 8) {
      return res.status(400).json({ ok: false, error: '새 비밀번호는 8자 이상으로 만들어 주세요.' });
    }

    const row = await db.get('SELECT password_hash FROM users WHERE id = ?', me.id);
    if (!verifyPassword(current, row.password_hash)) {
      return res.status(401).json({ ok: false, error: '현재 비밀번호가 올바르지 않습니다.' });
    }

    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next_), me.id);
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', me.id, token);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
