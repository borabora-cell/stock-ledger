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
  };

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
      const data = await api('/stocks');
      render(data);
    } catch (e) {
      toast(e.message);
    }
  }

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
