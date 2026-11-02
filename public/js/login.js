(function () {
  const el = {
    tabs: qs('#tabs'),
    username: qs('#f-username'),
    password: qs('#f-password'),
    pwHint: qs('#pw-hint'),
    phoneField: qs('#phone-field'),
    phone: qs('#f-phone'),
    codeField: qs('#code-field'),
    code: qs('#f-code'),
    submit: qs('#btn-submit'),
    switchNote: qs('#switch-note'),
    brandSub: qs('#brand-sub'),
  };

  let tab = 'login';
  let signupCodeRequired = false;

  function setTab(next) {
    tab = next;
    qsa('.opt', el.tabs).forEach((o) => {
      const on = o.dataset.tab === tab;
      o.classList.toggle('on', on);
      o.classList.toggle('buy', on);
    });
    el.submit.textContent = tab === 'login' ? '로그인' : '가입하고 시작하기';
    el.password.autocomplete = tab === 'login' ? 'current-password' : 'new-password';
    el.pwHint.classList.toggle('hidden', tab === 'login');
    el.phoneField.classList.toggle('hidden', tab === 'login');
    el.codeField.classList.toggle('hidden', tab === 'login' || !signupCodeRequired);
    el.switchNote.innerHTML = tab === 'login'
      ? '처음이신가요? <button data-go="register">회원가입</button>'
      : '이미 계정이 있으신가요? <button data-go="login">로그인</button>';
  }

  el.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (btn) setTab(btn.dataset.tab);
  });
  el.switchNote.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-go]');
    if (btn) setTab(btn.dataset.go);
  });

  async function submit() {
    const username = el.username.value.trim();
    const password = el.password.value;
    if (!username) return toast('아이디를 입력해 주세요.');
    if (!password) return toast('비밀번호를 입력해 주세요.');

    const body = { username, password };
    if (tab === 'register') {
      body.phone = el.phone.value.trim();
      if (!body.phone) return toast('휴대폰 번호를 입력해 주세요.');
      if (signupCodeRequired) body.code = el.code.value.trim();
    }

    el.submit.disabled = true;
    try {
      await api(`/auth/${tab}`, { method: 'POST', body, noRedirect: true });
      location.href = '/';
    } catch (e) {
      toast(e.message);
      el.submit.disabled = false;
    }
  }

  el.submit.addEventListener('click', submit);
  for (const input of [el.username, el.password, el.phone, el.code]) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  (async function init() {
    // 이미 로그인돼 있으면 바로 들어간다
    try {
      await api('/auth/me', { noRedirect: true });
      location.replace('/');
      return;
    } catch { /* 로그인 필요 — 그대로 진행 */ }

    try {
      const cfg = await api('/auth/config', { noRedirect: true });
      signupCodeRequired = cfg.signupCodeRequired;
      // 아직 아무도 가입하지 않았다면 회원가입부터 안내한다
      if (!cfg.hasUsers) {
        el.brandSub.textContent = '첫 사용자를 등록해 주세요.';
        setTab('register');
        return;
      }
    } catch { /* 설정을 못 읽어도 로그인 화면은 그대로 쓴다 */ }
    setTab('login');
  })();
})();
