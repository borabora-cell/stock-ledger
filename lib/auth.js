// 사용자 인증 — 비밀번호 해시(scrypt)와 DB 세션.
// 세션을 DB 에 두면 서버가 여러 대여도, 서버리스로 배포해도 그대로 동작한다.
import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'sl_session';

/** 가입에 코드가 필요하면 SIGNUP_CODE 환경변수를 넣는다 (공개 배포용) */
export const SIGNUP_CODE = (process.env.SIGNUP_CODE || '').trim();

/* ─────────── 비밀번호 ─────────── */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(password, salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** 이 사용자의 지금 비밀번호가 맞는지 */
export async function passwordMatches(userId, password) {
  const row = await db.get('SELECT password_hash FROM users WHERE id = ?', userId);
  return !!row && verifyPassword(String(password || ''), row.password_hash);
}

/** 비밀번호를 바꾸고 로그인을 모두 끊는다. keepToken 을 주면 그 세션(지금 기기)만 남긴다 */
export function setPassword(userId, password, keepToken = '') {
  return db.batch([
    { sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [hashPassword(password), userId] },
    { sql: 'DELETE FROM sessions WHERE user_id = ? AND token != ?', args: [userId, keepToken] },
  ]);
}

/* ─────────── 세션 ─────────── */

const expiryISO = () => new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
    token, userId, expiryISO());
  return token;
}

export async function getSessionUser(token) {
  if (!token) return null;
  const row = await db.get(`
    SELECT u.id, u.username, u.email, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?
  `, token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  // email 은 가리지 않은 주소다 — 응답에 실을 때는 maskEmail 을 거친다
  return { id: row.id, username: row.username, email: row.email };
}

export async function deleteSession(token) {
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', token);
}

/* ─────────── 쿠키 ─────────── */

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const isHttps = (req) => req.secure || req.headers['x-forwarded-proto'] === 'https';

export function setSessionCookie(res, req, token) {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  if (isHttps(req)) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

export function clearSessionCookie(res, req) {
  const bits = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isHttps(req)) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

/* ─────────── 미들웨어 ─────────── */

export const cleanUsername = (v) => String(v || '').trim().toLowerCase();

// 비밀번호·인증번호 추측 시도 제한 (한 인스턴스 기준 IP 당 분당 10회)
const hits = new Map();
export function rateLimit(req, res, next) {
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

/** 로그인한 사용자만 통과시킨다. req.user 에 {id, username, email} 을 넣어준다. */
export async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!user) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}
