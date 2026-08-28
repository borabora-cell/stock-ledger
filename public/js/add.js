(function () {
  const stockId = qparam('id') || qparam('stockId');
  if (!stockId) location.href = '/';

  const el = {
    back: qs('#back-link'),
    sub: qs('#stock-sub'),
    modeTabs: qs('#mode-tabs'),
    photoMode: qs('#photo-mode'),
    manualMode: qs('#manual-mode'),

    uploadZone: qs('#upload-zone'),
    file: qs('#screenshot'),
    scanning: qs('#scanning'),
    found: qs('#found'),
    nameWarn: qs('#name-warn'),
    foundCount: qs('#found-count'),
    rows: qs('#rows'),
    btnAddRow: qs('#btn-add-row'),
    btnRescan: qs('#btn-rescan'),
    btnSaveAll: qs('#btn-save-all'),

    seg: qs('#seg'),
    priceLabel: qs('#price-label'),
    date: qs('#f-date'),
    price: qs('#f-price'),
    qty: qs('#f-qty'),
    totalLbl: qs('#total-lbl'),
    totalV: qs('#total-v'),
    save: qs('#btn-save'),
  };

  el.back.href = `/stock.html?id=${stockId}`;
  el.date.value = new Date().toISOString().slice(0, 10);

  /* ─────────── 화면 전환 ─────────── */

  el.modeTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    qsa('.opt', el.modeTabs).forEach((o) => o.classList.toggle('on', o === btn));
    const photo = btn.dataset.mode === 'photo';
    el.photoMode.classList.toggle('hidden', !photo);
    el.manualMode.classList.toggle('hidden', photo);
  });

  /* ─────────── 캡처로 등록 ─────────── */

  let screenshotId = null;
  let rows = [];

  function renderRows() {
    el.foundCount.textContent = `${rows.length}건`;
    el.rows.innerHTML = '';

    rows.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'row-card' + (r.error ? ' bad' : '');
      card.innerHTML = `
        <div class="row-top">
          <div class="seg2">
            <button data-t="buy" class="${r.type === 'buy' ? 'on' : ''}">매수</button>
            <button data-t="sell" class="${r.type === 'sell' ? 'on' : ''}">매도</button>
          </div>
          <input class="d" type="date" value="${r.date || ''}">
          <button class="rm" title="삭제">✕</button>
        </div>
        <div class="row-grid">
          <div class="cell">
            <label>수량 (주)</label>
            <input class="q" type="number" inputmode="numeric" value="${r.quantity || ''}">
          </div>
          <div class="cell">
            <label>주당 단가 (원)</label>
            <input class="p" type="number" inputmode="numeric" value="${r.unitPrice || ''}">
          </div>
        </div>
        <div class="row-sum">합계 ${fmtWon((r.quantity || 0) * (r.unitPrice || 0))}</div>
        ${r.error ? `<div class="row-err">${r.error}</div>` : ''}`;

      qsa('.seg2 button', card).forEach((b) => b.addEventListener('click', () => {
        rows[i].type = b.dataset.t;
        renderRows();
      }));
      card.querySelector('.rm').addEventListener('click', () => {
        rows.splice(i, 1);
        renderRows();
      });
      card.querySelector('.d').addEventListener('change', (e) => { rows[i].date = e.target.value; });
      const sum = card.querySelector('.row-sum');
      const recalc = () => {
        sum.textContent = `합계 ${fmtWon((rows[i].quantity || 0) * (rows[i].unitPrice || 0))}`;
      };
      card.querySelector('.q').addEventListener('input', (e) => {
        rows[i].quantity = Number(e.target.value || 0); recalc();
      });
      card.querySelector('.p').addEventListener('input', (e) => {
        rows[i].unitPrice = Number(e.target.value || 0); recalc();
      });

      el.rows.appendChild(card);
    });
  }

  function showStep(step) {
    el.uploadZone.classList.toggle('hidden', step !== 'pick');
    el.scanning.classList.toggle('hidden', step !== 'scan');
    el.found.classList.toggle('hidden', step !== 'found');
  }

  el.file.addEventListener('change', async () => {
    const f = el.file.files[0];
    if (!f) return;
    showStep('scan');

    const fd = new FormData();
    fd.append('screenshot', f);
    try {
      const r = await api(`/stocks/${stockId}/parse-screenshot`, { method: 'POST', body: fd });
      screenshotId = r.screenshotId;
      rows = r.rows.map((x) => ({ ...x, error: null }));
      el.nameWarn.classList.toggle('hidden', !r.nameMismatch);
      if (r.nameMismatch) {
        el.nameWarn.textContent = `캡처의 종목은 "${r.stockName}" 인데 지금 종목과 달라요. 맞는 종목에서 등록하고 있는지 확인해 주세요.`;
      }
      renderRows();
      showStep('found');
    } catch (e) {
      toast(e.message);
      showStep('pick');
    } finally {
      el.file.value = '';
    }
  });

  el.btnRescan.addEventListener('click', () => {
    rows = [];
    screenshotId = null;
    showStep('pick');
  });

  el.btnAddRow.addEventListener('click', () => {
    rows.push({
      date: new Date().toISOString().slice(0, 10),
      type: 'buy', quantity: 0, unitPrice: 0, error: null,
    });
    renderRows();
  });

  el.btnSaveAll.addEventListener('click', async () => {
    if (!rows.length) return toast('저장할 거래가 없습니다.');
    el.btnSaveAll.disabled = true;
    try {
      const payload = rows.map((r) => ({
        date: r.date, type: r.type, quantity: r.quantity, unitPrice: r.unitPrice,
      }));
      const r = await api(`/stocks/${stockId}/transactions/bulk`, {
        method: 'POST', body: { rows: payload, screenshotId },
      });

      if (!r.failed.length) {
        toast(`${r.saved}건 저장했습니다.`);
        location.href = `/stock.html?id=${stockId}`;
        return;
      }

      // 저장된 건은 목록에서 빼고, 실패한 건만 사유와 함께 남긴다
      const failedByIndex = new Map(r.failed.map((f) => [f.index, f.error]));
      rows = rows
        .map((row, i) => ({ ...row, error: failedByIndex.get(i) || null }))
        .filter((row) => row.error);
      screenshotId = null; // 저장된 거래에 이미 붙었다
      renderRows();
      toast(`${r.saved}건 저장, ${r.failed.length}건 실패`);
    } catch (e) {
      toast(e.message);
    } finally {
      el.btnSaveAll.disabled = false;
    }
  });

  /* ─────────── 직접 입력 ─────────── */

  let type = 'buy';
  el.seg.addEventListener('click', (e) => {
    const btn = e.target.closest('.opt');
    if (!btn) return;
    type = btn.dataset.type;
    qsa('.opt', el.seg).forEach((o) => {
      o.classList.toggle('on', o === btn);
      o.classList.toggle('buy', o === btn && type === 'buy');
      o.classList.toggle('sell', o === btn && type === 'sell');
    });
    el.totalLbl.textContent = type === 'buy' ? '총 매입금액' : '총 매도금액';
    el.priceLabel.textContent = type === 'buy' ? '매입 단가 (원 / 주)' : '매도 단가 (원 / 주)';
  });

  function updateTotal() {
    el.totalV.textContent = fmtWon(Number(el.price.value || 0) * Number(el.qty.value || 0));
  }
  el.price.addEventListener('input', updateTotal);
  el.qty.addEventListener('input', updateTotal);

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

    el.save.disabled = true;
    try {
      const r = await api(`/stocks/${stockId}/transactions`, { method: 'POST', body: fd });
      toast(r.type === 'sell'
        ? `저장했습니다. 실현손익 ${r.realizedPl >= 0 ? '+' : ''}${fmtNum(r.realizedPl)}원`
        : '저장했습니다.');
      location.href = `/stock.html?id=${stockId}`;
    } catch (e) {
      toast(e.message);
      el.save.disabled = false;
    }
  });

  /* ─────────── 종목 이름 ─────────── */

  (async function init() {
    try {
      const data = await api(`/stocks/${stockId}`);
      el.sub.textContent = data.stock.name;
    } catch (e) { toast(e.message); }
  })();
})();
