(function () {
  const el = {
    list: qs('#stock-list'),
    empty: qs('#empty'),
    totalPl: qs('#total-pl'),
    totalCost: qs('#total-cost'),
    totalCount: qs('#total-count'),
    countLbl: qs('#stock-count-lbl'),
    today: qs('#today-label'),
    btnAdd: qs('#btn-add'),
    modal: qs('#modal'),
    newName: qs('#new-name'),
    modalCancel: qs('#modal-cancel'),
    modalSave: qs('#modal-save'),
    whoName: qs('#who-name'),
    btnPw: qs('#btn-pw'),
    btnLogout: qs('#btn-logout'),
    pwModal: qs('#pw-modal'),
    pwCurrent: qs('#pw-current'),
    pwNext: qs('#pw-next'),
    pwCancel: qs('#pw-cancel'),
    pwSave: qs('#pw-save'),
    btnPhone: qs('#btn-phone'),
    phoneNudge: qs('#phone-nudge'),
    phoneNudgeBtn: qs('#phone-nudge-btn'),
    phoneModal: qs('#phone-modal'),
    phoneNow: qs('#phone-now'),
    phoneNew: qs('#phone-new'),
    phonePw: qs('#phone-pw'),
    phoneCancel: qs('#phone-cancel'),
    phoneSave: qs('#phone-save'),
  };

  let myPhone = null; // 010-****-5678 처럼 가려진 번호, 없으면 null

  function badge(name) {
    return name.length <= 2 ? name : name.slice(0, 2);
  }

  function render(data) {
    el.today.textContent = fmtDate(data.today) + ' 기준';
    el.totalCount.textContent = `${data.stocks.length}개`;

    const totalPl = data.stocks.reduce((s, x) => s + x.realizedPl, 0);
    const totalCost = data.stocks.reduce((s, x) => s + x.totalCost, 0);
    el.totalPl.textContent = (totalPl >= 0 ? '+' : '') + fmtWon(totalPl);
    el.totalCost.textContent = fmtWon(totalCost);

    el.countLbl.textContent = `보유 종목 ${data.stocks.length}`;
    el.list.innerHTML = '';
    el.empty.classList.toggle('hidden', data.stocks.length > 0);

    for (const s of data.stocks) {
      const plClass = s.realizedPl > 0 ? 'gain' : s.realizedPl < 0 ? 'loss' : 'flat';
      const plText = s.txnCount > 1 || s.realizedPl !== 0
        ? `${s.realizedPl >= 0 ? '+' : ''}${fmtNum(s.realizedPl)}`
        : '거래 1건';
      const card = document.createElement('a');
      card.href = `/stock.html?id=${s.id}`;
      card.className = 'stock-card';
      card.innerHTML = `
        <div class="ticker-badge">${badge(s.name)}</div>
        <div class="info">
          <div class="nm">${s.name}</div>
          <div class="meta">${fmtNum(s.holdingQty)}주 · 평균 ${fmtNum(s.avgPrice)}원</div>
        </div>
        <div class="right">
          <div class="v mono">${fmtWon(s.totalCost)}</div>
          <span class="pl ${plClass} mono">${plText}</span>
        </div>`;
      el.list.appendChild(card);
    }
  }

  async function load() {
    try {
      const me = await api('/auth/me');
      el.whoName.textContent = me.user.username;
      showPhone(me.user.phone);
      const data = await api('/stocks');
      render(data);
    } catch (e) {
      toast(e.message);
    }
  }

  /* ─── 계정 ─── */

  el.btnLogout.addEventListener('click', () => {
    if (confirm('로그아웃할까요?')) logout();
  });

  el.btnPw.addEventListener('click', () => {
    el.pwCurrent.value = '';
    el.pwNext.value = '';
    el.pwModal.classList.remove('hidden');
  });
  const closePw = () => el.pwModal.classList.add('hidden');
  el.pwCancel.addEventListener('click', closePw);
  el.pwModal.addEventListener('click', (e) => { if (e.target === el.pwModal) closePw(); });

  el.pwSave.addEventListener('click', async () => {
    const current = el.pwCurrent.value;
    const next = el.pwNext.value;
    if (!current || !next) return toast('비밀번호를 모두 입력해 주세요.');
    if (next.length < 8) return toast('새 비밀번호는 8자 이상으로 만들어 주세요.');
    try {
      await api('/auth/password', { method: 'POST', body: { current, next } });
      closePw();
      toast('비밀번호를 변경했습니다.');
    } catch (e) {
      toast(e.message);
    }
  });

  function showPhone(masked) {
    myPhone = masked;
    el.phoneNudge.classList.toggle('hidden', !!masked);
  }

  function openPhone() {
    el.phoneNow.textContent = myPhone
      ? `지금 등록된 번호: ${myPhone}. 비밀번호를 잊었을 때 이 번호로 인증번호 문자를 보냅니다.`
      : '비밀번호를 잊었을 때 이 번호로 인증번호 문자를 보냅니다.';
    el.phoneNew.value = '';
    el.phonePw.value = '';
    el.phoneModal.classList.remove('hidden');
    setTimeout(() => el.phoneNew.focus(), 50);
  }
  const closePhone = () => el.phoneModal.classList.add('hidden');
  el.btnPhone.addEventListener('click', openPhone);
  el.phoneNudgeBtn.addEventListener('click', openPhone);
  el.phoneCancel.addEventListener('click', closePhone);
  el.phoneModal.addEventListener('click', (e) => { if (e.target === el.phoneModal) closePhone(); });

  el.phoneSave.addEventListener('click', async () => {
    const phone = el.phoneNew.value.trim();
    const password = el.phonePw.value;
    if (!phone) return toast('휴대폰 번호를 입력해 주세요.');
    if (!password) return toast('현재 비밀번호를 입력해 주세요.');
    try {
      const r = await api('/auth/phone', { method: 'POST', body: { phone, password } });
      showPhone(r.phone);
      closePhone();
      toast('휴대폰 번호를 저장했습니다.');
    } catch (e) {
      toast(e.message);
    }
  });

  function openModal() {
    el.newName.value = '';
    el.modal.classList.remove('hidden');
    setTimeout(() => el.newName.focus(), 50);
  }
  function closeModal() { el.modal.classList.add('hidden'); }

  el.btnAdd.addEventListener('click', openModal);
  el.modalCancel.addEventListener('click', closeModal);
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeModal(); });
  el.newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.modalSave.click(); });

  el.modalSave.addEventListener('click', async () => {
    const name = el.newName.value.trim();
    if (!name) return toast('종목명을 입력해 주세요.');
    try {
      const r = await api('/stocks', { method: 'POST', body: { name } });
      closeModal();
      location.href = `/stock.html?id=${r.id}`;
    } catch (e) {
      toast(e.message);
    }
  });

  load();
})();
