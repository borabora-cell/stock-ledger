import express from 'express';
import { db } from '../lib/db.js';
import {
  SESSION_COOKIE, SIGNUP_CODE,
  hashPassword, verifyPassword, passwordMatches, setPassword,
  createSession, deleteSession, getSessionUser,
  readCookie, setSessionCookie, clearSessionCookie,
  rateLimit, requireAuth, cleanUsername,
} from '../lib/auth.js';
import { normalizeEmail, maskEmail } from '../lib/mail.js';

const EMAIL_ERROR = '이메일 주소를 확인해 주세요. (예: name@naver.com)';
// 로그인은 살아 있으므로 401 이 아니라 403 (화면은 401 을 받으면 로그인 화면으로 보낸다)
const WRONG_CURRENT = '현재 비밀번호가 올바르지 않습니다.';

const router = express.Router();

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
    res.json({ ok: true, user: { ...user, email: maskEmail(user.email) } });
  } catch (e) { next(e); }
});

router.post('/auth/register', rateLimit, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body?.username);
    const password = String(req.body?.password || '');
    const code = String(req.body?.code || '').trim();
    const email = normalizeEmail(req.body?.email);

    if (SIGNUP_CODE && code !== SIGNUP_CODE) {
      return res.status(403).json({ ok: false, error: '가입 코드가 올바르지 않습니다.' });
    }
    if (!/^[a-z0-9_.-]{3,20}$/.test(username)) {
      return res.status(400).json({ ok: false, error: '아이디는 영문·숫자 3~20자로 만들어 주세요.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: '비밀번호는 8자 이상으로 만들어 주세요.' });
    }
    if (!email) return res.status(400).json({ ok: false, error: EMAIL_ERROR });

    const dup = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (dup) return res.status(409).json({ ok: false, error: '이미 사용 중인 아이디입니다.' });

    const r = await db.run('INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
      username, hashPassword(password), email);

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

    if (!(await passwordMatches(me.id, current))) {
      return res.status(403).json({ ok: false, error: WRONG_CURRENT });
    }

    await setPassword(me.id, next_, token);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/** 이메일 등록·변경 (비밀번호 찾기 인증번호를 받을 주소라 현재 비밀번호를 확인한다) */
router.post('/auth/email', rateLimit, requireAuth, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ ok: false, error: EMAIL_ERROR });

    if (!(await passwordMatches(req.user.id, req.body?.password))) {
      return res.status(403).json({ ok: false, error: WRONG_CURRENT });
    }

    await db.run('UPDATE users SET email = ? WHERE id = ?', email, req.user.id);
    res.json({ ok: true, email: maskEmail(email) });
  } catch (e) { next(e); }
});

export default router;
