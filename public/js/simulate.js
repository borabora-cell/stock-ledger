(function () {
  const stockId = qparam('id') || qparam('stockId');
  if (!stockId) location.href = '/';

  const el = {
    back: qs('#back-link'),
    sub: qs('#stock-sub'),
    qty: qs('#f-qty'),
    modeToggle: qs('#mode-toggle'),
    value: qs('#f-value'),
    convertNote: qs('#convert-note'),
    run: qs('#btn-run'),
    resultArea: qs('#result-area'),
    matchList: qs('#match-list'),
    resultCard: qs('#result-card'),
    resultPl: qs('#result-pl'),
    resultPct: qs('#result-pct'),
    afterQty: qs('#after-qty'),
    afterAvg: qs('#after-avg'),
  };

  el.back.href = `/stock.html?id=${stockId}`;

  let mode = 'total';
  el.modeToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    mode = btn.dataset.mode;
    qsa('.opt', el.modeToggle).forEach((o) => o.classList.toggle('on', o === btn));
    el.value.placeholder = mode === 'total' ? '예: 1800000' : '예: 600000';
    updateConvertNote();
  });

  function updateConvertNote() {
    const q = Number(el.qty.value || 0);
    const v = Number(el.value.value || 0);
    if (!q || !v) { el.convertNote.textContent = ''; return; }
    el.convertNote.textContent = mode === 'total'
      ? `주당 환산 ${fmtWon(v / q)}`
      : `총액 환산 ${fmtWon(v * q)}`;
  }
  el.qty.addEventListener('input', updateConvertNote);
  el.value.addEventListener('input', updateConvertNote);

  async function loadHeader() {
    try {
      const data = await api(`/stocks/${stockId}`);
      el.sub.textContent = `${data.stock.name} · 보유 ${fmtNum(data.summary.holdingQty)}주`;
      document.title = `${data.stock.name} 매도 시뮬레이션 | 주식가계부`;
    } catch (e) { toast(e.message); }
  }

  el.run.addEventListener('click', async () => {
    const quantity = Number(el.qty.value || 0);
    const value = Number(el.value.value || 0);
    if (!quantity) return toast('매도 수량을 입력해 주세요.');
    if (!value) return toast('금액을 입력해 주세요.');

    el.run.disabled = true;
    try {
      const r = await api(`/stocks/${stockId}/simulate`, { method: 'POST', body: { quantity, mode, value } });
      el.matchList.innerHTML = r.matches.map((m) => `
        <div class="match-lot">
          <span class="l">${fmtDate(m.buyDate)} 매입분 · ${fmtNum(m.unitPrice)}원</span>
          <span class="r"><span class="qty">${fmtNum(m.qty)}주</span> 매칭</span>
        </div>`).join('');

      const isLoss = r.realizedPl < 0;
      el.resultCard.classList.toggle('loss', isLoss);
      el.resultPl.textContent = `${r.realizedPl >= 0 ? '+' : ''}${fmtNum(r.realizedPl)}원`;
      el.resultPct.textContent = fmtPct(r.realizedPlPct);
      el.afterQty.textContent = `${fmtNum(r.after.holdingQty)}주`;
      el.afterAvg.textContent = `${fmtNum(r.after.avgPrice)}원`;

      el.resultArea.classList.remove('hidden');
      el.resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast(e.message);
    } finally {
      el.run.disabled = false;
    }
  });

  loadHeader();
})();
