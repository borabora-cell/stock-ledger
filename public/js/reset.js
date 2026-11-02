// 비밀번호 찾기: 1) 아이디·번호 → 인증번호 문자  2) 인증번호 확인  3) 새 비밀번호
(function () {
  const el = {
    steps: qsa('#steps span'),
    ask: qs('#step-ask'),
    codeStep: qs('#step-code'),
    newStep: qs('#step-new'),
    username: qs('#f-username'),
    phone: qs('#f-phone'),
    send: qs('#btn-send'),
    sentTo: qs('#sent-to'),
    timer: qs('#timer'),
    devNote: qs('#dev-note'),
    code: qs('#f-code'),
    verify: qs('#btn-verify'),
    resend: qs('#btn-resend'),
    pw: qs('#f-pw'),
    pw2: qs('#f-pw2'),
    save: qs('#btn-save'),
  };

  let username = '';
  let phone = '';
  let token = '';
  let ticker = null;

  function showStep(n) {
    [el.ask, el.codeStep, el.newStep].forEach((s, i) => s.classList.toggle('hidden', i !== n));
    el.steps.forEach((s, i) => s.classList.toggle('on', i <= n));
  }

  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  /** 인증번호 남은 시간과 「다시 받기」 대기 시간을 1초마다 줄인다 */
  function startTimers(expiresInSec, resendInSec) {
    clearInterval(ticker);
    const start = Date.now();
    const tick = () => {
      const passed = Math.floor((Date.now() - start) / 1000);
      const left = Math.max(0, expiresInSec - passed);
      const wait = Math.max(0, resendInSec - passed);
      el.timer.textContent = left ? mmss(left) : '시간 초과';
      el.timer.classList.toggle('over', !left);
      el.resend.disabled = wait > 0;
      el.resend.textContent = wait > 0 ? `인증번호 다시 받기 (${wait}초)` : '인증번호 다시 받기';
      if (!left && !wait) clearInterval(ticker);
    };
    tick();
    ticker = setInterval(tick, 1000);
  }

  async function sendCode(btn) {
    btn.disabled = true;
    try {
      const r = await api('/auth/reset/request', { method: 'POST', body: { username, phone }, noRedirect: true });
      el.sentTo.textContent = r.sentTo;
      el.devNote.classList.toggle('hidden', !r.devMode);
      el.code.value = '';
      showStep(1);
      startTimers(r.expiresInSec, r.resendInSec);
      toast('인증번호를 보냈습니다.');
      setTimeout(() => el.code.focus(), 50);
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
    }
  }

  el.send.addEventListener('click', () => {
    username = el.username.value.trim();
    phone = el.phone.value.trim();
    if (!username) return toast('아이디를 입력해 주세요.');
    if (!phone) return toast('휴대폰 번호를 입력해 주세요.');
    sendCode(el.send);
  });
  el.resend.addEventListener('click', () => sendCode(el.resend));

  async function verify() {
    if (el.verify.disabled) return; // 자동 확인과 Enter 가 겹쳐 두 번 보내지 않게
    const code = el.code.value.replace(/\D/g, '');
    if (code.length !== 6) return toast('인증번호 6자리를 넣어 주세요.');
    el.verify.disabled = true;
    try {
      const r = await api('/auth/reset/verify', { method: 'POST', body: { username, code }, noRedirect: true });
      token = r.token;
      clearInterval(ticker);
      showStep(2);
      setTimeout(() => el.pw.focus(), 50);
    } catch (e) {
      toast(e.message);
    } finally {
      el.verify.disabled = false;
    }
  }
  el.verify.addEventListener('click', verify);
  el.code.addEventListener('input', () => {
    // 문자 앱에서 붙여 넣거나 자동 완성되면 6자리가 차는 즉시 확인한다
    el.code.value = el.code.value.replace(/\D/g, '').slice(0, 6);
    if (el.code.value.length === 6) verify();
  });

  async function save() {
    const pw = el.pw.value;
    if (pw.length < 8) return toast('새 비밀번호는 8자 이상으로 만들어 주세요.');
    if (pw !== el.pw2.value) return toast('두 비밀번호가 서로 다릅니다.');
    el.save.disabled = true;
    try {
      await api('/auth/reset/confirm', { method: 'POST', body: { token, password: pw }, noRedirect: true });
      toast('비밀번호를 바꿨습니다.');
      setTimeout(() => location.replace('/'), 700);
    } catch (e) {
      toast(e.message);
      el.save.disabled = false;
    }
  }
  el.save.addEventListener('click', save);

  const onEnter = (input, action) => input.addEventListener('keydown', (e) => { if (e.key === 'Enter') action(); });
  onEnter(el.username, () => el.send.click());
  onEnter(el.phone, () => el.send.click());
  onEnter(el.code, verify);
  onEnter(el.pw2, save);

  el.username.value = qparam('u') || '';
  (el.username.value ? el.phone : el.username).focus();
})();
