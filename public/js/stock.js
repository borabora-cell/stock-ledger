(function () {
  const stockId = qparam('id');
  if (!stockId) location.href = '/';

  const el = {
    name: qs('#stock-name'),
    sub: qs('#stock-sub'),
    qty: qs('#s-qty'),
    avg: qs('#s-avg'),
    pl: qs('#s-pl'),
    lotsTable: qs('#lots-table'),
    lotsEmpty: qs('#lots-empty'),
    txnList: qs('#txn-list'),
    txnEmpty: qs('#txn-empty'),
    addLink: qs('#btn-add-link'),
    simLink: qs('#btn-sim-link'),
  };

  el.addLink.href = `/add.html?stockId=${stockId}`;
  el.simLink.href = `/simulate.html?stockId=${stockId}`;

  function renderLots(lots) {
    el.lotsTable.querySelectorAll('tr:not(:first-child)').forEach((r) => r.remove());
    el.lotsEmpty.classList.toggle('hidden', lots.length > 0);
    for (const l of lots) {
      const done = l.remainingQty <= 0;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(l.buyDate)}</td>
        <td class="num">${fmtNum(l.unitPrice)}</td>
        <td class="num">${fmtNum(l.remainingQty)} / ${fmtNum(l.quantity)}</td>
        <td><span class="tag ${done ? 'done' : 'live'}">${done ? '매도완료' : '보유중'}</span></td>`;
      el.lotsTable.appendChild(tr);
    }
  }

  function matchLabel(t) {
    if (!t.matches || !t.matches.length) return '';
    return t.matches.map((m) => `${fmtDate(m.buyDate)} 매입분 ${fmtNum(m.qty)}주`).join(' · ');
  }

  function renderTxns(txns) {
    el.txnList.innerHTML = '';
    el.txnEmpty.classList.toggle('hidden', txns.length > 0);
    for (const t of txns) {
      const row = document.createElement('div');
      row.className = 'txn';
      const plHtml = t.type === 'sell'
        ? `<div class="match">${matchLabel(t)} · ${t.realized_pl >= 0 ? '+' : ''}${fmtNum(t.realized_pl)}원 (${fmtPct(t.realized_pl_pct)})</div>`
        : '';
      row.innerHTML = `
        <div class="flag ${t.type}">${t.type === 'buy' ? '매수' : '매도'}</div>
        <div class="body">
          <div class="line1"><span>${fmtDate(t.txn_date)}</span><span class="amt mono">${fmtWon(t.total_amount)}</span></div>
          <div class="line2">${fmtNum(t.quantity)}주 × ${fmtNum(t.unit_price)}원</div>
          ${plHtml}
          <div>
            ${t.screenshot_url ? `<a class="shot" href="${t.screenshot_url}" target="_blank" rel="noopener">🧾</a>` : ''}
            <button class="del" data-id="${t.id}">삭제</button>
          </div>
        </div>`;
      el.txnList.appendChild(row);
    }
    el.txnList.querySelectorAll('.del').forEach((btn) => {
      btn.addEventListener('click', () => removeTxn(btn.dataset.id));
    });
  }

  async function removeTxn(id) {
    if (!confirm('이 거래를 삭제할까요?')) return;
    try {
      await api(`/transactions/${id}`, { method: 'DELETE' });
      toast('삭제했습니다.');
      load();
    } catch (e) {
      toast(e.message);
    }
  }

  async function load() {
    try {
      const data = await api(`/stocks/${stockId}`);
      el.name.innerHTML = `${data.stock.name}<small>보유 ${fmtNum(data.summary.holdingQty)}주</small>`;
      document.title = `${data.stock.name} | 주식가계부`;
      el.qty.textContent = `${fmtNum(data.summary.holdingQty)}주`;
      el.avg.textContent = `${fmtNum(data.summary.avgPrice)}원`;
      const pl = data.summary.realizedPl;
      el.pl.textContent = `${pl >= 0 ? '+' : ''}${fmtNum(pl)}원 (${fmtPct(data.summary.realizedPlPct)})`;
      el.pl.style.color = pl > 0 ? 'var(--gain)' : pl < 0 ? 'var(--loss)' : 'var(--ink-muted)';
      renderLots(data.lots);
      renderTxns(data.transactions);
    } catch (e) {
      toast(e.message);
    }
  }

  load();
})();
