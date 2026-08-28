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
    SELECT u.id, u.username, s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?
  `, token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await db.run('DELETE FROM sessions WHERE token = ?', token);
    return null;
  }
  return { id: row.id, username: row.username };
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

/** 로그인한 사용자만 통과시킨다. req.user 에 {id, username} 을 넣어준다. */
export async function requireAuth(req, res, next) {
  try {
    const user = await getSessionUser(readCookie(req, SESSION_COOKIE));
    if (!user) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    req.user = user;
    next();
  } catch (e) { next(e); }
}
