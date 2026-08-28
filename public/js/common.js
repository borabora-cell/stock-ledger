const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

const fmtWon = (n) => `${Math.round(n || 0).toLocaleString('ko-KR')}원`;
const fmtNum = (n) => Math.round(n || 0).toLocaleString('ko-KR');
const fmtPct = (n) => `${n > 0 ? '+' : ''}${(n || 0).toFixed(1)}%`;
const fmtDate = (s) => (s || '').replaceAll('-', '.');

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    method: opts.method || 'GET',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: opts.body ? (isForm ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, error: '서버 응답을 처리하지 못했습니다.' }));
  if (!res.ok || !data.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

function toast(msg) {
  const area = qs('#toast-area');
  if (!area) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  area.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

function qparam(name) {
  return new URLSearchParams(location.search).get(name);
}
