// 휴대폰 번호와 문자 발송
//
// 문자는 솔라피(SOLAPI) REST API 로 보낸다. 건당 요금이 나가는 유료 서비스다.
//   SOLAPI_API_KEY · SOLAPI_API_SECRET · SMS_FROM(솔라피에 등록한 발신번호)
// 셋이 다 있어야 실제로 보낸다. 없으면
//   - 로컬 실행 : 문자 대신 서버 창에 내용을 찍는다 (무료로 시험해 보는 용도)
//   - 배포 환경 : 보낼 수 없다고 알린다 (서버 창을 볼 사람이 없으므로)
// 호출 형식은 솔라피 공식 Node SDK(solapi-nodejs) 의 authenticator.ts · messageService.ts 를 따랐다.
import crypto from 'node:crypto';

const SOLAPI_URL = 'https://api.solapi.com/messages/v4/send-many/detail';

/** 숫자만 남겨 휴대폰 번호(01x)인지 본다. 맞으면 숫자열, 아니면 null */
export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : null;
}

/** 01012345678 → 010-****-5678 (화면에 보여줄 때) */
export function maskPhone(digits) {
  return digits ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : null;
}

/** 솔라피 API 키 인증 헤더: date+salt 를 비밀키로 HMAC-SHA256 서명 */
function solapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); // SDK 처럼 밀리초 없이
  const salt = crypto.randomBytes(16).toString('hex');              // 32자
  const signature = crypto.createHmac('sha256', apiSecret).update(date + salt).digest('hex');
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function sendSolapi({ apiKey, apiSecret, from, url }, to, text) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: solapiAuthHeader(apiKey, apiSecret), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ to, from, text }] }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`문자 발송 실패: ${data.errorMessage || `HTTP ${res.status}`}`);
  }
  // 요청은 받아들였어도 메시지가 접수되지 않으면 failedMessageList 에 사유가 담긴다
  const failed = data.failedMessageList?.[0];
  if (failed) throw new Error(`문자 발송 실패: ${failed.statusMessage || failed.statusCode}`);
}

/**
 * @returns {{mode: 'solapi'|'console'|null, send: (to: string, text: string) => Promise<void>}}
 *   mode null = 배포 환경인데 키가 없어 보낼 수 없음
 */
export function createSms({ apiKey, apiSecret, from, deployed = false, url = SOLAPI_URL, log = console.log } = {}) {
  const mode = apiKey && apiSecret && from ? 'solapi' : deployed ? null : 'console';
  return {
    mode,
    async send(to, text) {
      if (mode === 'solapi') return sendSolapi({ apiKey, apiSecret, from, url }, to, text);
      if (mode === 'console') return log(`\n  ✉️  [문자 미설정 — 실제로 보내지 않음] ${to} ← ${text}\n`);
      throw new Error('문자 발송이 설정되지 않았습니다.');
    },
  };
}

const env = (k) => (process.env[k] || '').trim();

export const sms = createSms({
  apiKey: env('SOLAPI_API_KEY'),
  apiSecret: env('SOLAPI_API_SECRET'),
  from: env('SMS_FROM').replace(/\D/g, ''),
  deployed: !!(process.env.VERCEL || process.env.RENDER),
});
