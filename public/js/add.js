(function () {
  const stockId = qparam('id') || qparam('stockId');
  if (!stockId) location.href = '/';

  const el = {
    back: qs('#back-link'),
    sub: qs('#stock-sub'),
    seg: qs('#seg'),
    uploadZone: qs('#upload-zone'),
    uploadT: qs('#upload-t'),
    file: qs('#screenshot'),
    preview: qs('#preview'),
    date: qs('#f-date'),
    price: qs('#f-price'),
    qty: qs('#f-qty'),
    totalLbl: qs('#total-lbl'),
    totalV: qs('#total-v'),
    save: qs('#btn-save'),
  };

  el.back.href = `/stock.html?id=${stockId}`;
  el.date.value = new Date().toISOString().slice(0, 10);

  let type = 'buy';
  el.seg.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    type = btn.dataset.type;
    qsa('.opt', el.seg).forEach((o) => o.classList.toggle('on', o === btn));
    el.totalLbl.textContent = type === 'buy' ? '총 매입금액' : '총 매도금액';
    el.price.previousElementSibling.textContent = type === 'buy' ? '매입 단가 (원 / 주)' : '매도 단가 (원 / 주)';
  });

  function updateTotal() {
    const p = Number(el.price.value || 0);
    const q = Number(el.qty.value || 0);
    el.totalV.textContent = fmtWon(p * q);
  }
  el.price.addEventListener('input', updateTotal);
  el.qty.addEventListener('input', updateTotal);

  el.file.addEventListener('change', () => {
    const f = el.file.files[0];
    el.uploadZone.classList.toggle('has-file', !!f);
    if (f) {
      el.uploadT.textContent = f.name;
      const reader = new FileReader();
      reader.onload = () => { el.preview.src = reader.result; el.preview.classList.remove('hidden'); };
      reader.readAsDataURL(f);
    } else {
      el.uploadT.textContent = '토스 캡처 올리기';
      el.preview.classList.add('hidden');
    }
  });

  el.save.addEventListener('click', async () => {
    const price = Number(el.price.value || 0);
    const qty = Number(el.qty.value || 0);
    if (!qty) return toast('수량을 입력해 주세요.');
    if (!price) return toast('단가를 입력해 주세요.');

    const fd = new FormData();
    fd.append('type', type);
    fd.append('txn_date', el.date.value);
    fd.append('unit_price', String(price));
    fd.append('quantity', String(qty));
    if (el.file.files[0]) fd.append('screenshot', el.file.files[0]);

    el.save.disabled = true;
    try {
      const r = await api(`/stocks/${stockId}/transactions`, { method: 'POST', body: fd });
      if (r.type === 'sell') {
        toast(`저장했습니다. 실현손익 ${r.realizedPl >= 0 ? '+' : ''}${fmtNum(r.realizedPl)}원`);
      } else {
        toast('저장했습니다.');
      }
      location.href = `/stock.html?id=${stockId}`;
    } catch (e) {
      toast(e.message);
      el.save.disabled = false;
    }
  });
})();
