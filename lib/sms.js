// 휴대폰 번호와 문자 발송

/** 숫자만 남겨 휴대폰 번호(01x)인지 본다. 맞으면 숫자열, 아니면 null */
export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^01[016789]\d{7,8}$/.test(digits) ? digits : null;
}

/** 01012345678 → 010-****-5678 (화면에 보여줄 때) */
export function maskPhone(digits) {
  return digits ? `${digits.slice(0, 3)}-****-${digits.slice(-4)}` : null;
}
