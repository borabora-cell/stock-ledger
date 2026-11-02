// 이메일 주소와 메일 발송
//
// 메일은 Gmail SMTP 로 보낸다 (무료. 하루 한도와 설정 방법은 README 「비밀번호 찾기」).
//   SMTP_USER : 보내는 Gmail 주소
//   SMTP_PASS : 그 계정의 «앱 비밀번호» 16자리 (2단계 인증을 켜야 만들 수 있다)
//   SMTP_HOST · SMTP_PORT : Gmail 이 아닌 메일(네이버 등)을 쓸 때만 바꾼다
// 둘(주소·앱 비밀번호) 중 하나라도 없으면
//   - 로컬 실행 : 메일 대신 서버 창에 내용을 찍는다 (설정 없이 시험해 보는 용도)
//   - 배포 환경 : 보낼 수 없다고 알린다 (서버 창을 볼 사람이 없으므로)
import nodemailer from 'nodemailer';

/** 앞뒤 공백을 빼고 소문자로 맞춘다. 이메일 형식이 아니면 null */
export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** family@example.com → fa****@example.com (화면에 보여줄 때) */
export function maskEmail(email) {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const keep = local.length > 2 ? 2 : 1;
  return `${local.slice(0, keep)}${'*'.repeat(Math.max(1, local.length - keep))}${email.slice(at)}`;
}

/** nodemailer SMTP 설정. 465 는 처음부터 암호화, 그 밖(587 등)은 STARTTLS */
export function smtpOptions({ host, port, user, pass }) {
  port = port || 465;
  return {
    host: host || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass: String(pass || '').replace(/\s/g, '') },
    // 메일 서버가 답이 없을 때 화면이 오래 멈춰 있지 않게 (nodemailer 기본값은 2분).
    // 정상이면 Gmail 발송은 1~2초면 끝난다.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 8_000,
  };
}

/**
 * @param {object} o
 * @param {object} [o.transport] nodemailer 전송 설정을 직접 줄 때 (시험에서는 jsonTransport)
 * @returns {{mode: 'smtp'|'console'|null, send: (m: {to: string, subject: string, text: string}) => Promise<any>}}
 *   mode null = 배포 환경인데 설정이 없어 보낼 수 없음
 */
export function createMailer({ host, port, user, pass, deployed = false, transport, log = console.log } = {}) {
  const mode = user && pass ? 'smtp' : deployed ? null : 'console';
  const transporter = mode === 'smtp'
    ? nodemailer.createTransport(transport || smtpOptions({ host, port, user, pass }))
    : null;
  return {
    mode,
    async send({ to, subject, text }) {
      if (transporter) return transporter.sendMail({ from: { name: '주식가계부', address: user }, to, subject, text });
      if (mode === 'console') return log(`\n  ✉️  [메일 미설정 — 실제로 보내지 않음] ${to} ← ${subject}\n      ${text.replace(/\n/g, '\n      ')}\n`);
      throw new Error('메일 발송이 설정되지 않았습니다.');
    },
  };
}

const env = (k) => (process.env[k] || '').trim();

export const mail = createMailer({
  host: env('SMTP_HOST'),
  port: Number(env('SMTP_PORT')),
  user: env('SMTP_USER'),
  pass: env('SMTP_PASS'),
  deployed: !!(process.env.VERCEL || process.env.RENDER),
});
