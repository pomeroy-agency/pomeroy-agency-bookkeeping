/* ---------- App shell, storage and views ---------- */
const E = Engine;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const M = c => E.fmt(c);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let state = { companies: {}, order: [], activeId: null };
let ui = { route: 'overview', bankAcct: null, reportTab: 'pl', range: null, ledgerAcct: null, recon: null, jeDraft: null, docDraft: null, payFor: null, reverseFor: null, confirmDelete: false, jeOpen: null };
const co = () => state.companies[state.activeId];

/* ----- Storage: private per-person document in the artifact's database; browser storage as a fallback ----- */
const Store = {
  mode: 'memory', db: null, ref: null, timer: null, status: 'Example data, not saved yet',
  async init() {
    try {
      const db = await window.claude?.use?.('db');
      const user = await window.claude?.use?.('user');
      const id = user && await user.id();
      if (db && id) {
        this.db = db; this.ref = db.collection('data/users/' + id).doc('books'); this.mode = 'db';
        const snap = await this.ref.get();
        if (snap.exists && snap.data()?.order?.length) { state = snap.data(); this.setStatus('Saved to your account', 'ok'); render(); }
        else this.setStatus('Example data. Your changes save to your account.', '');
        return;
      }
    } catch (e) { console.warn('db unavailable', e); }
    try {
      const raw = localStorage.getItem('ledgerline-books');
      this.mode = 'local';
      if (raw) { state = JSON.parse(raw); render(); }
      this.setStatus('Saved in this browser only', 'warn');
    } catch { this.mode = 'memory'; this.setStatus('Not saved: storage unavailable here', 'warn'); }
  },
  save() {
    clearTimeout(this.timer);
    this.setStatus('Saving…', '');
    this.timer = setTimeout(async () => {
      await this.ready;
      const data = JSON.parse(JSON.stringify(state));
      const size = new Blob([JSON.stringify(data)]).size;
      if (this.mode === 'db') {
        if (size > 250000) { this.setStatus('Books are near the prototype storage limit. Download a backup.', 'warn'); }
        try { await this.ref.set(data); if (size <= 250000) this.setStatus('Saved to your account', 'ok'); }
        catch (e) { this.setStatus('Could not save: ' + (e.message || e.code || 'error'), 'warn'); }
      } else if (this.mode === 'local') {
        try { localStorage.setItem('ledgerline-books', JSON.stringify(data)); this.setStatus('Saved in this browser only', 'warn'); }
        catch { this.setStatus('Not saved: browser storage is full or blocked', 'warn'); }
      } else this.setStatus('Not saved: storage unavailable here', 'warn');
    }, 500);
  },
  setStatus(text, kind) { this.status = text; this.kind = kind; const el = $('#savestate'); if (el) el.innerHTML = `<span class="dot ${kind}"></span><span>${esc(text)}</span>`; },
};

function commit(msg) { Store.save(); render(); if (msg) toast(msg); }
function attempt(fn, okMsg) { try { fn(); commit(okMsg); } catch (e) { toast(e.message, true); } }
let toastTimer;
function toast(msg, err) {
  let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), err ? 6000 : 3000);
}

/* ----- Helpers ----- */
const J = c => E.JURISDICTIONS[c.country] || E.JURISDICTIONS.US;
const accts = (c, f = () => true) => c.accounts.filter(a => !a.archived && f(a)).sort((x, y) => x.code.localeCompare(y.code));
function acctOptions(c, f, sel, blank = 'Choose account…') {
  const groups = E.TYPES.map(t => {
    const list = accts(c, a => a.type === t && f(a));
    return list.length ? `<optgroup label="${t[0].toUpperCase() + t.slice(1)}">${list.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</optgroup>` : '';
  });
  return (blank ? `<option value="">${blank}</option>` : '') + groups.join('');
}
const bankAccts = c => accts(c, a => a.subtype === 'bank');
const pill = s => `<span class="pill ${s}">${s}</span>`;
const fyRange = c => { const t = E.today(); return { from: E.fiscalYearStart(c, t), to: t }; };
function presets(c) {
  const t = E.today(), [y, m] = t.split('-').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  const fy = E.fiscalYearStart(c, t), lfyStart = E.fiscalYearStart(c, E.dayBefore(fy));
  return {
    'This month': { from: `${y}-${pad(m)}-01`, to: lastDay(y, m) },
    'This quarter': { from: `${y}-${pad(q0)}-01`, to: lastDay(y, q0 + 2) },
    'Fiscal year to date': { from: fy, to: t },
    'Last fiscal year': { from: lfyStart, to: E.dayBefore(fy) },
  };
}

/* ----- Shell ----- */
const NAV = [['overview', 'Overview'], ['bank', 'Bank feed'], ['invoices', 'Invoices'], ['bills', 'Bills'], ['journal', 'Journal'], ['accounts', 'Chart of accounts'], ['reconcile', 'Reconcile'], ['reports', 'Reports'], ['settings', 'Settings'], ['about', 'About this prototype']];

function render() {
  const c = co();
  if (!c) { $('#root').innerHTML = shell('<div class="wrap"><div class="panel"><h2>No company yet</h2><p>Create your first company to start keeping books.</p><div><button class="primary" data-act="new-company">Set up a company</button></div></div></div>'); return; }
  E.setCurrency(c.currency, c.country);
  if (!ui.bankAcct || !E.acct(c, ui.bankAcct)) ui.bankAcct = (bankAccts(c)[0] || {}).id;
  if (!ui.range) ui.range = fyRange(c);
  const views = { overview, bank, invoices: () => docs('invoice'), bills: () => docs('bill'), journal, accounts, reconcile, reports, settings, about };
  const focusId = document.activeElement?.id;
  $('#root').innerHTML = shell((views[ui.route] || overview)(c));
  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
  if (ui.modal) $('#root').insertAdjacentHTML('beforeend', ui.modal());
}

function shell(body) {
  const c = co();
  const unrev = c ? c.bankTxns.filter(t => t.status === 'new').length : 0;
  const od = c ? c.invoices.filter(d => E.docStatus(c, d) === 'overdue').length : 0;
  const counts = { bank: unrev, invoices: od };
  return `<div class="app">
  <aside class="side">
    <div class="brand"><svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="4" fill="var(--accent)"/><path d="M6 7h10M6 11h10M6 15h6" stroke="var(--accent-ink)" stroke-width="1.6"/><path d="M11 4v14" stroke="var(--accent-ink)" stroke-width="1.2" opacity=".55"/></svg>Ledgerline</div>
    <div class="field"><span>Company</span>
      <select id="company-switch" data-change="switch-company">${state.order.map(id => `<option value="${id}" ${id === state.activeId ? 'selected' : ''}>${esc(state.companies[id].name)}</option>`).join('')}<option value="__new">+ New company…</option></select>
    </div>
    <nav aria-label="Sections">${NAV.map(([k, l]) => `<button data-act="go" data-v="${k}" ${ui.route === k ? 'aria-current="page"' : ''}><span>${l}</span>${counts[k] ? `<span class="badge">${counts[k]}</span>` : ''}</button>`).join('')}</nav>
    <div class="savestate" id="savestate"><span class="dot ${Store.kind || ''}"></span><span>${esc(Store.status)}</span></div>
  </aside>
  <main><div class="wrap">${c && c.sample ? `<div class="banner"><span><strong>You are looking at example data.</strong> Riverside Coffee Roasters is fictional. Try anything here, then set up your own company.</span><button class="primary" data-act="new-company">Set up my company</button></div>` : ''}${body}</div></main>
  </div>`;
}

function header(title, sub, actions = '') { return `<div class="head"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="row">${actions}</div></div>`; }

/* ----- Overview ----- */
function overview(c) {
  const b = E.balances(c), j = J(c);
  const cash = bankAccts(c).reduce((s, a) => s + (b[a.id] || 0), 0);
  const ar = b[E.sys(c, 'ar').id] || 0, ap = -(b[E.sys(c, 'ap').id] || 0), tax = -(b[E.sys(c, 'tax').id] || 0);
  const fy = fyRange(c); const ni = E.incomeStatement(c, fy.from, fy.to).netIncome;
  const checks = E.health(c);
  return header(esc(c.name), `${esc(c.entityType)} · ${esc(c.region)}, ${esc(j.name)} · ${esc(j.framework)} · accrual basis`) + `
  <div class="grid kpis">
    <div class="kpi"><div class="label">Cash in bank</div><div class="v">${M(cash)}</div></div>
    <div class="kpi"><div class="label">Customers owe you</div><div class="v">${M(ar)}</div></div>
    <div class="kpi"><div class="label">You owe vendors</div><div class="v">${M(ap)}</div></div>
    <div class="kpi"><div class="label">Net income, fiscal YTD</div><div class="v">${M(ni)}</div></div>
    <div class="kpi"><div class="label">${esc(j.tax)} collected, unremitted</div><div class="v">${M(tax)}</div></div>
  </div>
  <div class="grid two">
    <section class="panel"><div class="row" style="justify-content:space-between"><h2>Books health</h2><span class="muted small">${checks.filter(x => x.ok).length} of ${checks.length} passing</span></div>
      <div>${checks.map(x => `<div class="check"><span class="ic ${x.ok ? 'ok' : x.warn ? 'warn' : 'bad'}">${x.ok ? '✓' : '!'}</span><div><strong>${esc(x.title)}</strong><div class="muted small">${esc(x.detail)}</div></div>${!x.ok && x.go ? `<button class="ghost" data-act="go" data-v="${x.go}">Fix</button>` : '<span></span>'}</div>`).join('')}</div>
      <p class="muted small">These are bookkeeping checks only. They do not confirm tax or regulatory compliance.</p>
    </section>
    <section class="panel"><h2>Recent activity</h2>
      <div>${c.audit.slice(0, 8).map(a => `<div class="check" style="grid-template-columns:1fr"><div><strong>${esc(a.action)}</strong><div class="muted small">${esc(a.detail)}</div><div class="muted small">${new Date(a.at).toLocaleString()}</div></div></div>`).join('')}</div>
      <div><button class="ghost" data-act="report" data-v="audit">Full audit trail</button></div>
    </section>
  </div>`;
}

/* ----- Bank feed ----- */
const EXAMPLE_CSV = d => `Date,Description,Amount\n${d(1)},OFFICE DEPOT #2231,-84.17\n${d(1)},SQUARE DEPOSIT 8862,226.40\n${d(0)},INTUIT PAYROLL FEE,-45.00`;
function bank(c) {
  const ba = ui.bankAcct; const b = E.balances(c);
  const fresh = c.bankTxns.filter(t => t.bankAccountId === ba && t.status === 'new').sort((x, y) => x.date.localeCompare(y.date));
  const done = c.bankTxns.filter(t => t.bankAccountId === ba && t.status !== 'new').sort((x, y) => y.date.localeCompare(x.date)).slice(0, 15);
  const openInv = c.invoices.filter(d => E.docTotals(c, d).due > 0), openBill = c.bills.filter(d => E.docTotals(c, d).due > 0);
  const row = t => {
    const s = E.suggest(c, t);
    const docs = t.amount > 0 ? openInv : openBill, kind = t.amount > 0 ? 'invoice' : 'bill';
    const sel = s ? (s.kind === 'account' ? s.accountId : `${s.kind}:${s.docId}`) : '';
    const docOpts = docs.map(d => `<option value="${kind}:${d.id}" ${sel === kind + ':' + d.id ? 'selected' : ''}>Payment for ${esc(d.no)} · ${esc(E.contactName(c, d.contactId))} (${M(E.docTotals(c, d).due)} due)</option>`).join('');
    return `<tr><td class="num" style="text-align:left">${t.date}</td><td>${esc(t.desc)}${s ? `<div class="muted small">Suggested: ${esc(s.label)}</div>` : ''}</td><td class="amt" style="color:${t.amount < 0 ? 'var(--bad)' : 'var(--good)'}">${M(t.amount)}</td>
      <td><select id="cat-${t.id}" aria-label="Category for ${esc(t.desc)}"><option value="">Choose category…</option>${docOpts ? `<optgroup label="Match ${kind}s">${docOpts}</optgroup>` : ''}${acctOptions(c, a => a.id !== ba, s && s.kind === 'account' ? s.accountId : '', null)}</select></td>
      <td><div class="row" style="flex-wrap:nowrap"><button class="primary" data-act="bank-post" data-v="${t.id}">Record</button><button class="ghost" data-act="bank-exclude" data-v="${t.id}" title="Exclude duplicates or personal items">Exclude</button></div></td></tr>`;
  };
  return header('Bank feed', 'Import a statement, then give each line a category. Each recorded line posts a balanced journal entry.',
    `<select id="bank-pick" data-change="bank-pick" aria-label="Bank account">${bankAccts(c).map(a => `<option value="${a.id}" ${a.id === ba ? 'selected' : ''}>${esc(a.name)} · ${M(b[a.id] || 0)}</option>`).join('')}</select>`) + `
  <section class="panel"><h2>Import a statement</h2>
    <p class="muted small">Upload or paste a CSV exported from your bank. Ledgerline reads Date, Description and Amount columns, or separate Debit and Credit columns. Dates are read as ${J(c).dateOrder === 'MDY' ? 'month/day/year' : J(c).dateOrder === 'DMY' ? 'day/month/year' : 'year-month-day'} for ${esc(J(c).name)}. Lines already imported are skipped.</p>
    <div class="row"><input type="file" id="csv-file" accept=".csv,text/csv" aria-label="CSV file"><button data-act="csv-example">Paste an example</button></div>
    <textarea id="csv-text" rows="4" placeholder="Date,Description,Amount"></textarea>
    <div><button class="primary" data-act="csv-import">Import lines</button></div>
  </section>
  <section class="grid" style="gap:10px"><h2>To review <span class="muted small">(${fresh.length})</span></h2>
    <div class="tablewrap"><table><thead><tr><th>Date</th><th>Description</th><th class="amt">Amount</th><th>Category or match</th><th></th></tr></thead>
    <tbody>${fresh.map(row).join('') || '<tr><td colspan="5" class="empty">Nothing to review. Import a statement to bring in new lines.</td></tr>'}</tbody></table></div>
  </section>
  <section class="grid" style="gap:10px"><h2>Recently handled</h2>
    <div class="tablewrap"><table><thead><tr><th>Date</th><th>Description</th><th class="amt">Amount</th><th>Status</th><th>Entry</th></tr></thead>
    <tbody>${done.map(t => { const j = c.journals.find(x => x.id === t.journalId); return `<tr><td class="num" style="text-align:left">${t.date}</td><td>${esc(t.desc)}</td><td class="amt">${M(t.amount)}</td><td>${pill(t.status)}</td><td>${j ? `<button class="ghost" data-act="je-view" data-v="${j.id}">JE-${j.no}</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">No handled lines yet.</td></tr>'}</tbody></table></div>
  </section>`;
}

/* ----- Invoices and bills ----- */
function blankDoc(c, kind) {
  const t = E.today(), due = new Date(); due.setDate(due.getDate() + 30);
  const acc = kind === 'invoice' ? accts(c, a => a.type === 'revenue')[0] : accts(c, a => a.type === 'expense' && a.subtype !== 'cogs')[0];
  return { kind, contact: '', ref: '', date: t, due: due.toISOString().slice(0, 10), memo: '', lines: [{ desc: '', accountId: acc?.id || '', qty: 1, price: '', taxable: kind === 'invoice' }] };
}
function docs(kind) {
  const c = co(); const isInv = kind === 'invoice';
  const list = (isInv ? c.invoices : c.bills).slice().sort((x, y) => y.date.localeCompare(x.date));
  const ag = E.aging(c, kind);
  const draft = ui.docDraft && ui.docDraft.kind === kind ? ui.docDraft : null;
  const form = draft ? docForm(c, draft) : '';
  return header(isInv ? 'Invoices' : 'Bills', isInv ? 'Bill customers and track what they owe. Issuing an invoice debits accounts receivable.' : 'Record what you owe vendors. Entering a bill credits accounts payable.',
    draft ? '' : `<button class="primary" data-act="doc-new" data-v="${kind}">New ${isInv ? 'invoice' : 'bill'}</button>`) + `
  <div class="grid kpis">${[['Current', ag.buckets.current], ['1–30 days late', ag.buckets.d30], ['31–60 days late', ag.buckets.d60], ['61–90 days late', ag.buckets.d90], ['Over 90 days', ag.buckets.over]].map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="v">${M(v)}</div></div>`).join('')}</div>
  ${form}
  <div class="tablewrap"><table><thead><tr><th>Number</th><th>${isInv ? 'Customer' : 'Vendor'}</th><th>Date</th><th>Due</th><th class="amt">Total</th><th class="amt">Balance due</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map(d => { const t = E.docTotals(c, d), st = E.docStatus(c, d); return `<tr><td><button class="ghost" data-act="doc-view" data-v="${kind}:${d.id}">${esc(d.no)}</button></td><td>${esc(E.contactName(c, d.contactId))}</td><td class="num" style="text-align:left">${d.date}</td><td class="num" style="text-align:left">${d.due}</td><td class="amt">${M(t.total)}</td><td class="amt">${M(t.due)}</td><td>${pill(st)}</td>
    <td>${t.due > 0 ? `<button data-act="pay-open" data-v="${kind}:${d.id}">${isInv ? 'Receive payment' : 'Pay'}</button>` : ''}</td></tr>
    ${ui.payFor === d.id ? `<tr><td colspan="8" style="background:var(--sunk)"><div class="row"><label class="field"><span>Date</span><input type="date" id="pay-date" value="${E.today()}"></label><label class="field"><span>Amount</span><input class="amt" id="pay-amt" inputmode="decimal" value="${(t.due / 100).toFixed(2)}"></label><label class="field"><span>${isInv ? 'Deposit to' : 'Pay from'}</span><select id="pay-bank">${bankAccts(c).map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label><button class="primary" data-act="pay-save" data-v="${kind}:${d.id}" style="align-self:flex-end">Record payment</button><button class="ghost" data-act="pay-cancel" style="align-self:flex-end">Cancel</button></div><p class="muted small" style="margin-top:6px">If this payment will also arrive in your bank feed, record it there instead so it is not counted twice.</p></td></tr>` : ''}`; }).join('') || `<tr><td colspan="8" class="empty">No ${kind}s yet.</td></tr>`}
  </tbody></table></div>`;
}
function docForm(c, d) {
  const isInv = d.kind === 'invoice';
  const fake = { lines: d.lines.map(l => ({ ...l, price: E.toCents(l.price) })), taxRateBps: isInv ? c.taxRateBps : 0 };
  const t = E.docTotals(c, fake);
  const filter = isInv ? a => a.type === 'revenue' : a => a.type === 'expense' || (a.type === 'asset' && a.subtype !== 'bank' && a.subtype !== 'ar');
  const names = c.contacts.filter(x => x.kind === (isInv ? 'customer' : 'vendor')).map(x => `<option value="${esc(x.name)}">`).join('');
  return `<section class="panel"><h2>New ${isInv ? 'invoice' : 'bill'}</h2>
  <div class="form">
    <label class="field"><span>${isInv ? 'Customer' : 'Vendor'}</span><input id="d-contact" list="d-contacts" value="${esc(d.contact)}" data-draft="contact" placeholder="Type a name"><datalist id="d-contacts">${names}</datalist></label>
    ${isInv ? '' : `<label class="field"><span>Vendor's bill number</span><input id="d-ref" value="${esc(d.ref)}" data-draft="ref"></label>`}
    <label class="field"><span>${isInv ? 'Invoice date' : 'Bill date'}</span><input type="date" id="d-date" value="${d.date}" data-draft="date"></label>
    <label class="field"><span>Due date</span><input type="date" id="d-due" value="${d.due}" data-draft="due"></label>
  </div>
  <div class="tablewrap"><table><thead><tr><th>Description</th><th>Account</th><th class="amt">Qty</th><th class="amt">Unit price</th>${isInv ? '<th>Taxable</th>' : ''}<th class="amt">Amount</th><th></th></tr></thead><tbody>
  ${d.lines.map((l, i) => `<tr><td><input id="dl-desc-${i}" value="${esc(l.desc)}" data-line="${i}" data-k="desc" aria-label="Description"></td><td><select id="dl-acct-${i}" data-line="${i}" data-k="accountId" aria-label="Account">${acctOptions(c, filter, l.accountId)}</select></td>
    <td><input id="dl-qty-${i}" class="amt" style="width:70px" inputmode="decimal" value="${esc(l.qty)}" data-line="${i}" data-k="qty" aria-label="Quantity"></td><td><input id="dl-price-${i}" class="amt" inputmode="decimal" value="${esc(l.price)}" data-line="${i}" data-k="price" placeholder="0.00" aria-label="Unit price"></td>
    ${isInv ? `<td><input type="checkbox" id="dl-tax-${i}" ${l.taxable ? 'checked' : ''} data-line="${i}" data-k="taxable" aria-label="Taxable"></td>` : ''}<td class="amt">${M(Math.round((+l.qty || 0) * E.toCents(l.price)))}</td><td>${d.lines.length > 1 ? `<button class="ghost danger" data-act="dl-remove" data-v="${i}" aria-label="Remove line">×</button>` : ''}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="row" style="justify-content:space-between;align-items:flex-start"><button data-act="dl-add">Add line</button>
    <table style="width:auto"><tbody><tr><td class="muted">Subtotal</td><td class="amt">${M(t.sub)}</td></tr>${isInv ? `<tr><td class="muted">${esc(J(c).tax)} at ${(c.taxRateBps / 100).toFixed(2)}%</td><td class="amt">${M(t.tax)}</td></tr>` : ''}<tr class="total"><td>Total</td><td class="amt">${M(t.total)}</td></tr></tbody></table></div>
  ${isInv && !c.taxRateBps ? `<p class="note">No ${esc(J(c).tax)} rate is set for this company. Add the rate that applies to you in Settings if you collect it.</p>` : ''}
  <div class="row"><button class="primary" data-act="doc-save">${isInv ? 'Issue invoice' : 'Record bill'}</button><button class="ghost" data-act="doc-cancel">Cancel</button></div>
  </section>`;
}
function docModal(kind, id) {
  return () => {
    const c = co(); const d = (kind === 'invoice' ? c.invoices : c.bills).find(x => x.id === id); const t = E.docTotals(c, d);
    return `<div class="modal-bg" data-act="modal-close"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(d.no)}" data-stop>
      <div class="row" style="justify-content:space-between"><div><div class="label">${kind === 'invoice' ? 'Invoice' : 'Bill'}</div><h2>${esc(d.no)}</h2></div>${pill(E.docStatus(c, d))}</div>
      <div class="form"><div><div class="label">${kind === 'invoice' ? 'From' : 'Vendor'}</div><div>${esc(kind === 'invoice' ? c.name : E.contactName(c, d.contactId))}</div>${kind === 'invoice' && c.taxId ? `<div class="muted small">${esc(J(c).taxId)}: ${esc(c.taxId)}</div>` : ''}</div>
        <div><div class="label">${kind === 'invoice' ? 'Bill to' : 'Billed to'}</div><div>${esc(kind === 'invoice' ? E.contactName(c, d.contactId) : c.name)}</div></div>
        <div><div class="label">Date / Due</div><div class="num" style="text-align:left">${d.date} / ${d.due}</div></div></div>
      <div class="tablewrap"><table><thead><tr><th>Description</th><th class="amt">Qty</th><th class="amt">Price</th><th class="amt">Amount</th></tr></thead><tbody>${d.lines.map(l => `<tr><td>${esc(l.desc || E.acct(c, l.accountId)?.name)}${l.taxable ? ' <span class="muted small">(taxable)</span>' : ''}</td><td class="amt">${l.qty}</td><td class="amt">${M(l.price)}</td><td class="amt">${M(Math.round(l.qty * l.price))}</td></tr>`).join('')}
      <tr><td colspan="3" class="muted">Subtotal</td><td class="amt">${M(t.sub)}</td></tr>${t.tax ? `<tr><td colspan="3" class="muted">${esc(J(c).tax)} at ${((d.taxRateBps ?? c.taxRateBps) / 100).toFixed(2)}%</td><td class="amt">${M(t.tax)}</td></tr>` : ''}<tr class="total"><td colspan="3">Total</td><td class="amt">${M(t.total)}</td></tr>
      ${d.payments.map(p => `<tr><td colspan="3" class="muted">Payment ${p.date}</td><td class="amt">${M(-p.amount)}</td></tr>`).join('')}<tr class="total"><td colspan="3">Balance due</td><td class="amt">${M(t.due)}</td></tr></tbody></table></div>
      <div class="row"><button data-act="je-view" data-v="${d.journalId}">View journal entry</button><button class="ghost" data-act="modal-close">Close</button></div>
    </div></div>`;
  };
}

/* ----- Journal ----- */
function blankJE() { return { date: E.today(), memo: '', lines: [{ accountId: '', debit: '', credit: '' }, { accountId: '', debit: '', credit: '' }] }; }
function journal(c) {
  const d = ui.jeDraft;
  const dr = d ? d.lines.reduce((s, l) => s + E.toCents(l.debit), 0) : 0, cr = d ? d.lines.reduce((s, l) => s + E.toCents(l.credit), 0) : 0;
  const q = (ui.jeSearch || '').toLowerCase();
  const list = c.journals.slice().sort((x, y) => y.date.localeCompare(x.date) || y.no - x.no).filter(j => !q || (`je-${j.no} ${j.memo} ${j.date}`).toLowerCase().includes(q)).slice(0, 60);
  return header('Journal', 'Every transaction in the books, as balanced double-entry records. Posted entries are never edited or deleted. To correct one, reverse it and post a new entry.',
    d ? '' : '<button class="primary" data-act="je-new">New journal entry</button>') + (d ? `
  <section class="panel"><h2>New journal entry</h2>
    <div class="form"><label class="field"><span>Date</span><input type="date" id="je-date" value="${d.date}" data-je="date"></label><label class="field" style="grid-column:span 2"><span>Memo</span><input id="je-memo" value="${esc(d.memo)}" data-je="memo" placeholder="What is this entry for?"></label></div>
    <div class="tablewrap"><table><thead><tr><th>Account</th><th>Line memo</th><th class="amt">Debit</th><th class="amt">Credit</th><th></th></tr></thead><tbody>
    ${d.lines.map((l, i) => `<tr><td><select id="jl-acct-${i}" data-jl="${i}" data-k="accountId" aria-label="Account">${acctOptions(c, () => true, l.accountId)}</select></td><td><input id="jl-memo-${i}" value="${esc(l.memo || '')}" data-jl="${i}" data-k="memo" aria-label="Line memo"></td>
      <td><input id="jl-dr-${i}" class="amt" inputmode="decimal" value="${esc(l.debit)}" data-jl="${i}" data-k="debit" placeholder="0.00" aria-label="Debit"></td><td><input id="jl-cr-${i}" class="amt" inputmode="decimal" value="${esc(l.credit)}" data-jl="${i}" data-k="credit" placeholder="0.00" aria-label="Credit"></td>
      <td>${d.lines.length > 2 ? `<button class="ghost danger" data-act="jl-remove" data-v="${i}" aria-label="Remove line">×</button>` : ''}</td></tr>`).join('')}
    <tr class="total"><td colspan="2">Totals</td><td class="amt">${M(dr)}</td><td class="amt">${M(cr)}</td><td></td></tr></tbody></table></div>
    <div class="row" style="justify-content:space-between"><button data-act="jl-add">Add line</button><span>Difference <span class="diff ${dr === cr && dr ? 'zero' : 'nz'}">${M(dr - cr)}</span></span></div>
    <div class="row"><button class="primary" data-act="je-save" ${dr === cr && dr ? '' : 'disabled'}>Post entry</button><button class="ghost" data-act="je-cancel">Cancel</button></div>
  </section>` : '') + `
  <div class="row"><input id="je-search" type="search" placeholder="Search entries" value="${esc(ui.jeSearch || '')}" data-input="je-search" aria-label="Search entries" style="max-width:320px;width:100%"></div>
  <div class="tablewrap"><table><thead><tr><th>Entry</th><th>Date</th><th>Memo</th><th>Source</th><th class="amt">Amount</th><th></th></tr></thead><tbody>
  ${list.map(j => `<tr><td><button class="ghost" data-act="je-toggle" data-v="${j.id}">JE-${j.no}</button></td><td class="num" style="text-align:left">${j.date}</td><td>${esc(j.memo)}${j.reversedBy ? ' <span class="pill void">reversed</span>' : ''}</td><td class="muted small">${esc(j.source.kind)}</td><td class="amt">${M(E.total(j))}</td>
    <td>${!j.reversedBy && !j.reverses ? `<button class="ghost" data-act="rev-open" data-v="${j.id}">Reverse</button>` : ''}</td></tr>
    ${ui.jeOpen === j.id ? `<tr><td colspan="6" style="background:var(--sunk)">${jeLines(c, j)}</td></tr>` : ''}
    ${ui.reverseFor === j.id ? `<tr><td colspan="6" style="background:var(--sunk)"><div class="row"><span>Post a reversing entry dated</span><input type="date" id="rev-date" value="${E.today()}"><button class="primary" data-act="rev-save" data-v="${j.id}">Reverse JE-${j.no}</button><button class="ghost" data-act="rev-cancel">Cancel</button></div>${j.source.kind !== 'manual' ? '<p class="note" style="margin-top:8px">This entry came from an invoice, bill or bank line. Reversing it changes the ledger but leaves that document as it is.</p>' : ''}</td></tr>` : ''}`).join('') || '<tr><td colspan="6" class="empty">No entries match.</td></tr>'}
  </tbody></table></div>`;
}
function jeLines(c, j) {
  return `<table><thead><tr><th>Account</th><th>Memo</th><th class="amt">Debit</th><th class="amt">Credit</th></tr></thead><tbody>${j.lines.map(l => { const a = E.acct(c, l.accountId); return `<tr><td>${esc(a.code)} · ${esc(a.name)}</td><td class="muted">${esc(l.memo)}</td><td class="amt">${l.debit ? M(l.debit) : ''}</td><td class="amt">${l.credit ? M(l.credit) : ''}</td></tr>`; }).join('')}</tbody></table><p class="muted small" style="margin-top:6px">Posted ${new Date(j.createdAt).toLocaleString()}</p>`;
}
function jeModal(id) {
  return () => { const c = co(); const j = c.journals.find(x => x.id === id); return `<div class="modal-bg" data-act="modal-close"><div class="modal" role="dialog" aria-modal="true" data-stop><div class="label">Journal entry</div><h2>JE-${j.no} · ${j.date}</h2><p>${esc(j.memo)}</p><div class="tablewrap">${jeLines(c, j)}</div><div><button class="ghost" data-act="modal-close">Close</button></div></div></div>`; };
}

/* ----- Chart of accounts ----- */
function accounts(c) {
  const b = E.balances(c);
  const ledgerView = ui.ledgerAcct ? ledgerTable(c, ui.ledgerAcct) : '';
  return header('Chart of accounts', `Organized by the five elements of the accounting equation. Select an account to see its ledger. Template set for a ${esc(c.entityType.toLowerCase())}.`,
    '<button class="primary" data-act="acct-new">Add account</button>') + (ui.acctForm ? `
  <section class="panel"><h2>Add account</h2><div class="form">
    <label class="field"><span>Code</span><input id="na-code" placeholder="e.g. 6550"></label>
    <label class="field"><span>Name</span><input id="na-name" placeholder="e.g. Equipment rental"></label>
    <label class="field"><span>Type</span><select id="na-type">${E.TYPES.map(t => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></label>
    <label class="field"><span>Kind</span><select id="na-sub"><option value="">General</option><option value="bank">Bank or cash account</option><option value="current">Current</option><option value="fixed">Fixed / long-term asset</option><option value="longterm">Long-term liability</option><option value="cogs">Cost of goods sold</option></select></label>
  </div><div class="row"><button class="primary" data-act="acct-save">Add account</button><button class="ghost" data-act="acct-cancel">Cancel</button></div></section>` : '') + `
  <div class="tablewrap"><table><thead><tr><th>Code</th><th>Account</th><th>Kind</th><th class="amt">Balance</th><th></th></tr></thead><tbody>
  ${E.TYPES.map(t => `<tr class="section"><td colspan="5">${{ asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Revenue', expense: 'Expenses' }[t]} <span class="muted small" style="font-family:var(--f-body)">normal balance: ${E.NORMAL[t] > 0 ? 'debit' : 'credit'}</span></td></tr>` +
    c.accounts.filter(a => a.type === t).sort((x, y) => x.code.localeCompare(y.code)).map(a => `<tr style="${a.archived ? 'opacity:.55' : ''}"><td class="num" style="text-align:left">${esc(a.code)}</td><td><button class="ghost" data-act="ledger" data-v="${a.id}">${esc(a.name)}</button>${a.system ? ' <span class="muted small">(system)</span>' : ''}${a.archived ? ' <span class="pill void">archived</span>' : ''}</td><td class="muted small">${esc(a.subtype)}</td><td class="amt">${M(E.NORMAL[t] * (b[a.id] || 0))}</td>
      <td>${a.system ? '' : `<button class="ghost" data-act="acct-archive" data-v="${a.id}">${a.archived ? 'Restore' : 'Archive'}</button>`}</td></tr>`).join('')).join('')}
  </tbody></table></div>${ledgerView}`;
}
function ledgerTable(c, id) {
  const r = ui.range; const L = E.ledger(c, id, r.from, r.to);
  return `<section class="panel" id="ledger"><div class="row" style="justify-content:space-between"><h2>Ledger: ${esc(L.account.code)} ${esc(L.account.name)}</h2><span class="muted small">${r.from} to ${r.to}</span></div>
  <div class="tablewrap"><table><thead><tr><th>Date</th><th>Entry</th><th>Memo</th><th class="amt">Debit</th><th class="amt">Credit</th><th class="amt">Balance</th></tr></thead><tbody>
  <tr><td colspan="5" class="muted">Opening balance</td><td class="amt">${M(L.opening)}</td></tr>
  ${L.lines.map(x => `<tr><td class="num" style="text-align:left">${x.j.date}</td><td><button class="ghost" data-act="je-view" data-v="${x.j.id}">JE-${x.j.no}</button></td><td>${esc(x.l.memo || x.j.memo)}</td><td class="amt">${x.l.debit ? M(x.l.debit) : ''}</td><td class="amt">${x.l.credit ? M(x.l.credit) : ''}</td><td class="amt">${M(x.balance)}</td></tr>`).join('')}
  <tr class="total"><td colspan="5">Closing balance</td><td class="amt">${M(L.closing)}</td></tr></tbody></table></div></section>`;
}

/* ----- Reconcile ----- */
function reconcile(c) {
  const banks = bankAccts(c);
  if (!ui.recon || !E.acct(c, ui.recon.acct)) ui.recon = { acct: banks[0]?.id, end: E.today(), bal: '', ticked: new Set() };
  const R = ui.recon; const endBal = E.toCents(R.bal);
  const s = E.reconSummary(c, R.acct, R.end, endBal, R.ticked);
  const last = E.lastRecon(c, R.acct);
  const hist = c.recons.filter(r => r.bankAccountId === R.acct).sort((a, b) => b.endDate.localeCompare(a.endDate));
  return header('Reconcile', 'Match the ledger to your bank statement. Tick each item that appears on the statement. You can finish when the difference is zero.') + `
  <section class="panel"><div class="form">
    <label class="field"><span>Account</span><select id="rc-acct" data-change="rc-acct">${banks.map(a => `<option value="${a.id}" ${a.id === R.acct ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Statement end date</span><input type="date" id="rc-end" value="${R.end}" data-change="rc-end"></label>
    <label class="field"><span>Statement ending balance</span><input id="rc-bal" class="amt" style="width:100%" inputmode="decimal" placeholder="0.00" value="${esc(R.bal)}" data-change="rc-bal"></label>
  </div>
  <p class="muted small">${last ? `Last reconciled through ${last.endDate} at ${M(last.endBalance)}.` : 'This account has not been reconciled yet, so the beginning balance is zero.'}</p></section>
  <div class="grid kpis">
    <div class="kpi"><div class="label">Beginning balance</div><div class="v">${M(s.begin)}</div></div>
    <div class="kpi"><div class="label">Cleared this period</div><div class="v">${M(s.cleared)}</div></div>
    <div class="kpi"><div class="label">Statement balance</div><div class="v">${M(endBal)}</div></div>
    <div class="kpi"><div class="label">Difference</div><div class="v diff ${s.difference === 0 ? 'zero' : 'nz'}">${M(s.difference)}</div></div>
  </div>
  <div class="row"><button data-act="rc-all">Tick all</button><button data-act="rc-none">Clear ticks</button><button class="primary" data-act="rc-finish" ${s.difference === 0 && R.bal !== '' ? '' : 'disabled'}>Finish reconciliation</button></div>
  <div class="tablewrap"><table><thead><tr><th>Cleared</th><th>Date</th><th>Entry</th><th>Memo</th><th class="amt">Deposit</th><th class="amt">Payment</th></tr></thead><tbody>
  ${s.items.map(i => `<tr><td><input type="checkbox" id="rc-${i.key}" data-tick="${i.key}" ${R.ticked.has(i.key) ? 'checked' : ''} aria-label="Cleared"></td><td class="num" style="text-align:left">${i.j.date}</td><td>JE-${i.j.no}</td><td>${esc(i.j.memo)}</td><td class="amt">${i.amount > 0 ? M(i.amount) : ''}</td><td class="amt">${i.amount < 0 ? M(-i.amount) : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No uncleared items on or before this date.</td></tr>'}
  </tbody></table></div>
  ${hist.length ? `<section class="panel"><h2>Completed reconciliations</h2><div class="tablewrap"><table><thead><tr><th>Through</th><th class="amt">Statement balance</th><th class="amt">Items</th><th>Completed</th></tr></thead><tbody>${hist.map(r => `<tr><td class="num" style="text-align:left">${r.endDate}</td><td class="amt">${M(r.endBalance)}</td><td class="amt">${r.count}</td><td class="muted small">${new Date(r.completedAt).toLocaleString()}</td></tr>`).join('')}</tbody></table></div></section>` : ''}`;
}

/* ----- Reports ----- */
const REPORTS = [['pl', 'Profit and loss'], ['bs', 'Balance sheet'], ['tb', 'Trial balance'], ['gl', 'General ledger'], ['ar', 'Receivables aging'], ['ap', 'Payables aging'], ['audit', 'Audit trail']];
function reports(c) {
  const r = ui.range, tab = ui.reportTab;
  const p = presets(c);
  const pointInTime = tab === 'bs' || tab === 'tb' || tab === 'ar' || tab === 'ap';
  const controls = tab === 'audit' ? '' : `<div class="row">${pointInTime ? '' : `<label class="field"><span>From</span><input type="date" id="rg-from" value="${r.from}" data-change="rg-from"></label>`}<label class="field"><span>${pointInTime ? 'As of' : 'To'}</span><input type="date" id="rg-to" value="${r.to}" data-change="rg-to"></label>
    ${pointInTime ? '' : `<label class="field"><span>Period</span><select id="rg-preset" data-change="rg-preset"><option value="">Custom</option>${Object.keys(p).map(k => `<option ${p[k].from === r.from && p[k].to === r.to ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`}
    ${tab === 'gl' ? `<label class="field"><span>Account</span><select id="gl-acct" data-change="gl-acct">${acctOptions(c, () => true, ui.ledgerAcct, 'All accounts with activity')}</select></label>` : ''}
    <span style="flex:1"></span>${Downloads.ok ? `<button data-act="report-csv" style="align-self:flex-end">Download CSV</button>` : ''}</div>`;
  const body = { pl: rptPL, bs: rptBS, tb: rptTB, gl: rptGL, ar: () => rptAging(c, 'invoice'), ap: () => rptAging(c, 'bill'), audit: rptAudit }[tab](c);
  return header('Reports', 'Financial statements built directly from the general ledger.') + `
  <div class="tabs" role="tablist">${REPORTS.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" data-act="report" data-v="${k}">${l}</button>`).join('')}</div>${controls}${body}`;
}
function reportFrame(c, title, period, inner) {
  return `<article class="report"><header><strong style="font-family:var(--f-display);font-size:1.05rem">${esc(c.name)}</strong><span>${title}</span><span class="muted small">${period}</span></header>${inner}
  <p class="foot">Accrual basis. Amounts in ${esc(c.currency)}. Prepared from unaudited books under the ${esc(J(c).framework)} framework the company selected. Have a qualified accountant review statements before filing or sharing with lenders.</p></article>`;
}
function rptRows(rows) { return rows.map(x => `<tr><td class="indent">${esc(x.account.code)} · ${esc(x.account.name)}</td><td class="amt">${M(x.amount)}</td></tr>`).join(''); }
function rptPL(c) {
  const r = ui.range, s = E.incomeStatement(c, r.from, r.to);
  ui.csv = [['Section', 'Account', 'Amount'], ...s.revenue.map(x => ['Revenue', x.account.name, x.amount]), ...s.cogs.map(x => ['Cost of goods sold', x.account.name, x.amount]), ...s.expenses.map(x => ['Expenses', x.account.name, x.amount]), ['', 'Net income', s.netIncome]];
  return reportFrame(c, 'Profit and loss', `${r.from} to ${r.to}`, `<table><tbody>
  <tr class="section"><td colspan="2">Revenue</td></tr>${rptRows(s.revenue)}<tr class="total"><td>Total revenue</td><td class="amt">${M(s.totalRevenue)}</td></tr>
  ${s.cogs.length ? `<tr class="section"><td colspan="2">Cost of goods sold</td></tr>${rptRows(s.cogs)}<tr class="total"><td>Gross profit</td><td class="amt">${M(s.grossProfit)}</td></tr>` : ''}
  <tr class="section"><td colspan="2">Operating expenses</td></tr>${rptRows(s.expenses)}<tr class="total"><td>Total expenses</td><td class="amt">${M(s.totalExpenses)}</td></tr>
  <tr class="total"><td>Net income</td><td class="amt">${M(s.netIncome)}</td></tr></tbody></table>`);
}
function rptBS(c) {
  const s = E.balanceSheet(c, ui.range.to);
  ui.csv = [['Section', 'Account', 'Amount'], ...s.assets.map(x => ['Assets', x.account.name, x.amount]), ...s.liabilities.map(x => ['Liabilities', x.account.name, x.amount]), ...s.equity.map(x => ['Equity', x.account.name, x.amount]), ['Equity', 'Retained earnings, prior years', s.priorEarnings], ['Equity', 'Net income, current fiscal year', s.currentEarnings]];
  return reportFrame(c, 'Balance sheet', `As of ${s.asOf}`, `<table><tbody>
  <tr class="section"><td colspan="2">Assets</td></tr>${rptRows(s.assets)}<tr class="total"><td>Total assets</td><td class="amt">${M(s.totalAssets)}</td></tr>
  <tr class="section"><td colspan="2">Liabilities</td></tr>${rptRows(s.liabilities)}<tr class="total"><td>Total liabilities</td><td class="amt">${M(s.totalLiabilities)}</td></tr>
  <tr class="section"><td colspan="2">Equity</td></tr>${rptRows(s.equity)}<tr><td class="indent">Retained earnings, prior years</td><td class="amt">${M(s.priorEarnings)}</td></tr><tr><td class="indent">Net income, current fiscal year</td><td class="amt">${M(s.currentEarnings)}</td></tr>
  <tr class="total"><td>Total equity</td><td class="amt">${M(s.totalEquity)}</td></tr>
  <tr class="total"><td>Total liabilities and equity</td><td class="amt">${M(s.totalLiabilities + s.totalEquity)}</td></tr></tbody></table>
  <p>${s.balanced ? pill('ok') + ' Assets equal liabilities plus equity.' : pill('bad') + ' Out of balance. Check the trial balance.'}</p>`);
}
function rptTB(c) {
  const s = E.trialBalance(c, ui.range.to);
  ui.csv = [['Code', 'Account', 'Debit', 'Credit'], ...s.rows.map(x => [x.account.code, x.account.name, x.debit, x.credit]), ['', 'Totals', s.debit, s.credit]];
  return reportFrame(c, 'Trial balance', `As of ${ui.range.to}`, `<div class="tablewrap" style="border:0"><table><thead><tr><th>Account</th><th class="amt">Debit</th><th class="amt">Credit</th></tr></thead><tbody>
  ${s.rows.map(x => `<tr><td>${esc(x.account.code)} · ${esc(x.account.name)}</td><td class="amt">${x.debit ? M(x.debit) : ''}</td><td class="amt">${x.credit ? M(x.credit) : ''}</td></tr>`).join('')}
  <tr class="total"><td>Totals</td><td class="amt">${M(s.debit)}</td><td class="amt">${M(s.credit)}</td></tr></tbody></table></div><p>${s.balanced ? pill('ok') + ' Debits equal credits.' : pill('bad') + ' Debits and credits differ.'}</p>`);
}
function rptGL(c) {
  const r = ui.range; const ids = ui.ledgerAcct ? [ui.ledgerAcct] : c.accounts.filter(a => E.ledger(c, a.id, r.from, r.to).lines.length).sort((x, y) => x.code.localeCompare(y.code)).map(a => a.id);
  ui.csv = [['Account', 'Date', 'Entry', 'Memo', 'Debit', 'Credit', 'Balance']];
  const parts = ids.map(id => { const L = E.ledger(c, id, r.from, r.to); L.lines.forEach(x => ui.csv.push([L.account.name, x.j.date, 'JE-' + x.j.no, x.l.memo || x.j.memo, x.l.debit, x.l.credit, x.balance]));
    return `<h3>${esc(L.account.code)} · ${esc(L.account.name)}</h3><div class="tablewrap" style="border:0"><table><thead><tr><th>Date</th><th>Entry</th><th>Memo</th><th class="amt">Debit</th><th class="amt">Credit</th><th class="amt">Balance</th></tr></thead><tbody><tr><td colspan="5" class="muted">Opening</td><td class="amt">${M(L.opening)}</td></tr>${L.lines.map(x => `<tr><td class="num" style="text-align:left">${x.j.date}</td><td>JE-${x.j.no}</td><td>${esc(x.l.memo || x.j.memo)}</td><td class="amt">${x.l.debit ? M(x.l.debit) : ''}</td><td class="amt">${x.l.credit ? M(x.l.credit) : ''}</td><td class="amt">${M(x.balance)}</td></tr>`).join('')}<tr class="total"><td colspan="5">Closing</td><td class="amt">${M(L.closing)}</td></tr></tbody></table></div>`; });
  return reportFrame(c, 'General ledger', `${r.from} to ${r.to}`, parts.join('') || '<p class="empty">No activity in this period.</p>');
}
function rptAging(c, kind) {
  const a = E.aging(c, kind, ui.range.to); const lab = { current: 'Current', d30: '1–30', d60: '31–60', d90: '61–90', over: '90+' };
  ui.csv = [['Number', kind === 'invoice' ? 'Customer' : 'Vendor', 'Due', 'Days late', 'Balance'], ...a.rows.map(x => [x.d.no, E.contactName(c, x.d.contactId), x.d.due, Math.max(0, x.days), x.due])];
  return reportFrame(c, kind === 'invoice' ? 'Receivables aging' : 'Payables aging', `As of ${ui.range.to}`, `<div class="tablewrap" style="border:0"><table><thead><tr><th>Number</th><th>${kind === 'invoice' ? 'Customer' : 'Vendor'}</th><th>Due</th><th>Bucket</th><th class="amt">Balance</th></tr></thead><tbody>
  ${a.rows.map(x => `<tr><td>${esc(x.d.no)}</td><td>${esc(E.contactName(c, x.d.contactId))}</td><td class="num" style="text-align:left">${x.d.due}</td><td>${lab[x.bucket]}${x.days > 0 ? ` <span class="muted small">(${x.days} days)</span>` : ''}</td><td class="amt">${M(x.due)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nothing outstanding.</td></tr>'}
  <tr class="total"><td colspan="4">Total outstanding</td><td class="amt">${M(a.total)}</td></tr></tbody></table></div>`);
}
function rptAudit(c) {
  ui.csv = [['When', 'Action', 'Detail'], ...c.audit.map(a => [a.at, a.action, a.detail])];
  return reportFrame(c, 'Audit trail', `${c.audit.length} events, newest first`, `<div class="tablewrap" style="border:0"><table><thead><tr><th>When</th><th>Action</th><th>Detail</th></tr></thead><tbody>${c.audit.map(a => `<tr><td class="muted small" style="white-space:nowrap">${new Date(a.at).toLocaleString()}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody></table></div>`);
}

/* ----- Settings ----- */
function settings(c) {
  const j = J(c);
  return header('Settings', 'Company profile, jurisdiction, tax and period close.') + `
  <section class="panel"><h2>Company profile</h2><div class="form">
    <label class="field"><span>Legal or trading name</span><input id="s-name" value="${esc(c.name)}" data-set="name"></label>
    <label class="field"><span>${esc(j.taxId)}</span><input id="s-taxid" value="${esc(c.taxId)}" data-set="taxId"></label>
    <label class="field"><span>Entity type</span><select id="s-entity" data-set="entityType">${j.entities.map(e => `<option ${e === c.entityType ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
    <label class="field"><span>Fiscal year starts</span><select id="s-fy" data-set="fiscalStartMonth">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === c.fiscalStartMonth ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
  </div><p class="muted small">Changing the entity type does not rename existing equity accounts. Add or archive accounts in the chart of accounts if your structure changed.</p></section>
  <section class="panel"><h2>Principal place of business</h2><div class="form">
    <div class="field"><span>Country</span><div>${esc(j.name)} <span class="muted small">(set when the company was created)</span></div></div>
    <label class="field"><span>${c.country === 'US' ? 'State' : 'Region'}</span><select id="s-region" data-set="region">${j.regions.map(r => `<option ${r === c.region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
    <div class="field"><span>Reporting currency</span><div>${esc(c.currency)}</div></div>
    <div class="field"><span>Accounting framework</span><div>${esc(j.framework)}</div></div>
  </div>
  <table style="width:auto"><tbody><tr><td class="muted">Indirect tax</td><td>${esc(j.tax)}</td></tr><tr><td class="muted">Record keeping</td><td>${esc(j.retention)}</td></tr><tr><td class="muted">Date format on imports</td><td>${j.dateOrder}</td></tr></tbody></table></section>
  <section class="panel"><h2>${esc(j.tax)}</h2><div class="form"><label class="field"><span>Rate charged on taxable invoice lines (%)</span><input id="s-rate" inputmode="decimal" value="${(c.taxRateBps / 100).toFixed(2)}" data-set="taxRate"></label></div>
    <p class="note">${c.country === 'US' && (j.noSalesTax || []).includes(c.region) ? `${esc(c.region)} has no statewide sales tax, though some localities may levy one. ` : ''}${c.country === 'US' ? 'Sales tax rates and nexus rules vary by state, county and city, and depend on where you sell, not only where you are based.' : `${esc(j.tax)} registration thresholds and rates depend on your turnover and what you sell.`} Ledgerline does not look up rates or file returns. Confirm your rate and filing schedule with the tax authority or your accountant.</p></section>
  <section class="panel"><h2>Close the books</h2><p>Closing a period locks every date on or before it, so reconciled and reported figures cannot change. ${c.lockDate ? `Currently closed through <strong>${c.lockDate}</strong>.` : 'No period is closed yet.'}</p>
    <div class="row"><input type="date" id="s-lock" value="${c.lockDate || E.dayBefore(E.today().slice(0, 8) + '01')}" aria-label="Close through"><button class="primary" data-act="lock">Close through this date</button>${c.lockDate ? '<button data-act="unlock">Reopen all periods</button>' : ''}</div></section>
  <section class="panel"><h2>Connected entities</h2><p class="muted">Connections planned for the full product. In this prototype, bank data comes in through CSV import.</p>
    <div class="cards">${[['Bank and card feeds', 'Daily transactions from banks and card issuers through an aggregator such as Plaid, MX or open banking APIs.'], ['Payment processors', 'Payouts, fees and refunds from Stripe, Square and PayPal, split into gross sales and fees.'], ['Payroll', 'Wages, withholdings and employer taxes posted as one summary entry per pay run.'], ['Tax agencies', `Prepared ${esc(j.tax)} and income tax figures handed to your accountant or e-filing service.`], ['Related companies', 'Intercompany entries between companies you own, with eliminations for consolidated reports.'], ['Your accountant', 'Invite an accountant to review, adjust and sign off on period close.']].map(([t, d]) => `<div class="conn"><div class="row" style="justify-content:space-between"><strong>${t}</strong><span class="pill warn">planned</span></div><p class="muted small">${d}</p></div>`).join('')}</div></section>
  <section class="panel"><h2>Backup</h2><p class="muted">Download a complete copy of every company as JSON, or restore from one.</p>
    <div class="row">${Downloads.ok ? '<button data-act="backup">Download backup</button>' : '<span class="muted small">Downloads are not available in this view.</span>'}<label class="btn" for="restore-file" style="display:inline-block">Restore from file</label><input type="file" id="restore-file" accept=".json,application/json" hidden></div></section>
  <section class="panel"><h2>Delete company</h2>${ui.confirmDelete ? `<p>This permanently removes <strong>${esc(c.name)}</strong> and all of its records.</p><div class="row"><button class="danger" data-act="delete-yes">Delete ${esc(c.name)}</button><button class="ghost" data-act="delete-no">Keep it</button></div>` : `<div><button class="danger" data-act="delete-ask">Delete this company</button></div>`}</section>`;
}

/* ----- About ----- */
function about() {
  return header('About this prototype', 'What works today, what comes next, and where a professional needs to weigh in.') + `
  <div class="grid two">
  <section class="panel"><h2>Working in this prototype</h2><ul class="plain">
    <li>Double-entry general ledger with integer-cent arithmetic. Every entry must balance before it posts.</li>
    <li>Chart of accounts templated by entity type, with system accounts for receivables, payables, tax and retained earnings.</li>
    <li>Invoices with sales tax, VAT or GST on taxable lines, bills, partial payments and aging.</li>
    <li>Bank CSV import with duplicate detection, suggested matches to open invoices and bills, and category memory.</li>
    <li>Bank reconciliation against statement balances, with history.</li>
    <li>Profit and loss, balance sheet with retained earnings roll-forward by fiscal year, trial balance, general ledger, aging, audit trail.</li>
    <li>Immutable entries corrected by reversal, and period close that locks prior dates.</li>
    <li>Multiple companies, each with its own jurisdiction, currency and fiscal year.</li>
  </ul></section>
  <section class="panel"><h2>Next for a production product</h2><ul class="plain">
    <li>Server-side database with user accounts, roles and permissions, and encryption at rest.</li>
    <li>Live bank feeds through an aggregator, plus payment processor and payroll integrations.</li>
    <li>Tax engine for rates by address, and filing exports per jurisdiction.</li>
    <li>Multi-currency with exchange gains and losses, fixed asset depreciation schedules, inventory costing.</li>
    <li>Cash-basis reporting toggle, cash flow statement, budgets, and consolidation across related companies.</li>
    <li>Document attachments for receipts, with retention policies per jurisdiction.</li>
  </ul></section></div>
  <section class="panel"><h2>Needs professional review</h2><p class="note">Ledgerline applies standard double-entry mechanics, but it does not make the product compliant with GAAP, IFRS, tax law or data protection rules on its own. Before clients rely on it, have a CPA or chartered accountant review the account templates, revenue recognition and statement presentation for each framework you support. Have a tax adviser confirm sales tax, VAT and GST handling in each jurisdiction. Have counsel review data privacy (for example GLBA, GDPR, PIPEDA), bank data terms, and record retention. A SOC 2 audit is the usual expectation for software that holds clients' financial data.</p></section>`;
}

/* ----- New company wizard ----- */
function wizard() {
  const w = ui.wiz; const j = E.JURISDICTIONS[w.country];
  return `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true" aria-label="Set up a company" data-stop>
    <h2>Set up a company</h2><p class="muted">Choose where the business is based. Ledgerline uses this for the currency, tax labels, date formats and a chart of accounts suited to the entity type.</p>
    <div class="form">
      <label class="field" style="grid-column:1/-1"><span>Business name</span><input id="w-name" value="${esc(w.name)}" data-wiz="name" placeholder="e.g. Harbor Street Design LLC"></label>
      <label class="field"><span>Country</span><select id="w-country" data-wiz="country">${Object.entries(E.JURISDICTIONS).map(([k, v]) => `<option value="${k}" ${k === w.country ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
      <label class="field"><span>${w.country === 'US' ? 'State' : 'Region'}</span><select id="w-region" data-wiz="region">${j.regions.map(r => `<option ${r === w.region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label class="field"><span>Entity type</span><select id="w-entity" data-wiz="entityType">${j.entities.map(e => `<option ${e === w.entityType ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
      <label class="field"><span>Fiscal year starts</span><select id="w-fy" data-wiz="fiscalStartMonth">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === +w.fiscalStartMonth ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    </div>
    <table style="width:auto"><tbody><tr><td class="muted">Currency</td><td>${j.currency}</td></tr><tr><td class="muted">Framework</td><td>${esc(j.framework)}</td></tr><tr><td class="muted">Indirect tax</td><td>${esc(j.tax)} (set your rate in Settings)</td></tr><tr><td class="muted">Tax ID</td><td>${esc(j.taxId)}</td></tr><tr><td class="muted">Records</td><td>${esc(j.retention)}</td></tr></tbody></table>
    <p class="muted small">Not seeing your country? This prototype covers six English-speaking jurisdictions to start.</p>
    <div class="row"><button class="primary" data-act="wiz-save">Create company</button><button class="ghost" data-act="wiz-cancel">Cancel</button></div>
  </div></div>`;
}

/* ----- Downloads ----- */
const Downloads = { ok: false, ns: null, async init() { try { this.ns = await window.claude?.use?.('downloads'); this.ok = !!this.ns; if (this.ok) render(); } catch { } },
  async save(filename, data) { try { await this.ns.save({ filename, data }); } catch (e) { if (e?.code !== 'declined') toast('Could not download: ' + (e?.message || e?.code), true); } } };
const csvOf = rows => rows.map(r => r.map(v => { const s = typeof v === 'number' ? (v / 100).toFixed(2) : String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');

/* ----- Events ----- */
document.addEventListener('click', e => {
  const stop = e.target.closest('[data-stop]'); const el = e.target.closest('[data-act]');
  if (!el || (stop && !stop.contains(el))) return;
  if (el.classList.contains('modal-bg') && e.target !== el) return;
  const c = co(); const v = el.dataset.v;
  const [k2, id2] = (v || '').split(':');
  switch (el.dataset.act) {
    case 'go': ui.route = v; ui.modal = null; render(); window.scrollTo(0, 0); break;
    case 'report': ui.route = 'reports'; ui.reportTab = v; render(); break;
    case 'new-company': openWizard(); break;
    case 'wiz-cancel': ui.modal = null; render(); break;
    case 'wiz-save': {
      const w = ui.wiz; if (!w.name.trim()) return toast('Enter the business name.', true);
      const nc = E.newCompany({ ...w, name: w.name.trim(), fiscalStartMonth: +w.fiscalStartMonth });
      state.companies[nc.id] = nc; state.order.push(nc.id); state.activeId = nc.id; ui.modal = null; ui.route = 'overview'; ui.range = null; ui.recon = null;
      commit(`${nc.name} is ready. Import a bank statement or issue your first invoice.`); break;
    }
    case 'modal-close': ui.modal = null; render(); break;
    case 'csv-example': { const d = n => { const t = new Date(); t.setDate(t.getDate() - n); return t.toISOString().slice(0, 10); }; $('#csv-text').value = EXAMPLE_CSV(d); break; }
    case 'csv-import': attempt(() => { const r = E.importBankCSV(c, $('#csv-text').value, ui.bankAcct); toast(`Imported ${r.added} line${r.added === 1 ? '' : 's'}${r.dupes ? `, skipped ${r.dupes} already imported` : ''}${r.bad.length ? `. Could not read rows ${r.bad.join(', ')}` : ''}.`, r.bad.length && !r.added); }); break;
    case 'bank-post': { const sel = $('#cat-' + v).value; const [kind, docId] = sel.includes(':') ? sel.split(':') : ['account']; attempt(() => E.postBankTxn(c, v, kind === 'account' ? { accountId: sel } : { kind, docId }), 'Recorded.'); break; }
    case 'bank-exclude': E.excludeBankTxn(c, v); commit('Excluded. It will not post to the books.'); break;
    case 'doc-new': ui.docDraft = blankDoc(c, v); ui.payFor = null; render(); break;
    case 'doc-cancel': ui.docDraft = null; render(); break;
    case 'dl-add': ui.docDraft.lines.push({ ...blankDoc(c, ui.docDraft.kind).lines[0] }); render(); break;
    case 'dl-remove': ui.docDraft.lines.splice(+v, 1); render(); break;
    case 'doc-save': {
      const d = ui.docDraft; if (!d.contact.trim()) return toast(`Enter the ${d.kind === 'invoice' ? 'customer' : 'vendor'} name.`, true);
      if (d.lines.some(l => (l.price || l.desc) && !l.accountId)) return toast('Choose an account for every line.', true);
      try {
        const lines = d.lines.filter(l => E.toCents(l.price)).map(l => ({ desc: l.desc, accountId: l.accountId, qty: +l.qty || 0, price: E.toCents(l.price), taxable: !!l.taxable }));
        const existing = c.contacts.find(x => x.name.toLowerCase() === d.contact.trim().toLowerCase());
        const contact = existing || { id: E.uid(), name: d.contact.trim(), kind: d.kind === 'invoice' ? 'customer' : 'vendor' };
        const body = { contactId: contact.id, date: d.date, due: d.due, ref: d.ref, lines };
        if (!existing) c.contacts.push(contact);
        try { const doc = d.kind === 'invoice' ? E.createInvoice(c, body) : E.createBill(c, body); ui.docDraft = null; commit(`${doc.no} saved and posted.`); }
        catch (err) { if (!existing) c.contacts.pop(); throw err; }
      } catch (err) { toast(err.message, true); }
      break;
    }
    case 'doc-view': ui.modal = docModal(k2, id2); render(); break;
    case 'pay-open': ui.payFor = id2; render(); break;
    case 'pay-cancel': ui.payFor = null; render(); break;
    case 'pay-save': attempt(() => { E.payDoc(c, k2, id2, { date: $('#pay-date').value, amount: E.toCents($('#pay-amt').value), bankAccountId: $('#pay-bank').value }); ui.payFor = null; }, 'Payment recorded.'); break;
    case 'je-new': ui.jeDraft = blankJE(); render(); break;
    case 'je-cancel': ui.jeDraft = null; render(); break;
    case 'jl-add': ui.jeDraft.lines.push({ accountId: '', debit: '', credit: '' }); render(); break;
    case 'jl-remove': ui.jeDraft.lines.splice(+v, 1); render(); break;
    case 'je-save': { const d = ui.jeDraft; attempt(() => { E.post(c, { date: d.date, memo: d.memo, lines: d.lines.map(l => ({ accountId: l.accountId, memo: l.memo, debit: E.toCents(l.debit), credit: E.toCents(l.credit) })) }); ui.jeDraft = null; }, 'Entry posted.'); break; }
    case 'je-toggle': ui.jeOpen = ui.jeOpen === v ? null : v; render(); break;
    case 'je-view': ui.modal = jeModal(v); render(); break;
    case 'rev-open': ui.reverseFor = v; render(); break;
    case 'rev-cancel': ui.reverseFor = null; render(); break;
    case 'rev-save': attempt(() => { E.reverse(c, v, $('#rev-date').value); ui.reverseFor = null; }, 'Reversing entry posted.'); break;
    case 'acct-new': ui.acctForm = true; render(); break;
    case 'acct-cancel': ui.acctForm = false; render(); break;
    case 'acct-save': {
      const code = $('#na-code').value.trim(), name = $('#na-name').value.trim(), type = $('#na-type').value, sub = $('#na-sub').value;
      if (!code || !name) return toast('Enter a code and a name.', true);
      if (c.accounts.some(a => a.code === code)) return toast(`Code ${code} is already used.`, true);
      c.accounts.push({ id: E.uid(), code, name, type, subtype: sub, system: '', archived: false }); E.log(c, 'Account added', `${code} ${name} (${type})`); ui.acctForm = false; commit('Account added.'); break;
    }
    case 'acct-archive': { const a = E.acct(c, v); const bal = E.balances(c)[v] || 0; if (!a.archived && bal) return toast('Only accounts with a zero balance can be archived.', true); a.archived = !a.archived; E.log(c, a.archived ? 'Account archived' : 'Account restored', `${a.code} ${a.name}`); commit(); break; }
    case 'ledger': ui.ledgerAcct = v; render(); $('#ledger')?.scrollIntoView({ behavior: 'smooth' }); break;
    case 'rc-all': E.reconItems(c, ui.recon.acct, ui.recon.end).forEach(i => ui.recon.ticked.add(i.key)); render(); break;
    case 'rc-none': ui.recon.ticked.clear(); render(); break;
    case 'rc-finish': attempt(() => { const R = ui.recon; E.completeRecon(c, R.acct, R.end, E.toCents(R.bal), R.ticked); ui.recon = null; }, 'Reconciliation complete.'); break;
    case 'report-csv': { const name = (REPORTS.find(r => r[0] === ui.reportTab) || [])[1]; Downloads.save(`${c.name} - ${name} - ${ui.range.to}.csv`.replace(/[\\/:*?"<>|]/g, ''), csvOf(ui.csv || [])); break; }
    case 'backup': Downloads.save(`ledgerline-backup-${E.today()}.json`, JSON.stringify(state, null, 1)); break;
    case 'lock': { const d = $('#s-lock').value; if (!d) return toast('Pick a date.', true); E.closePeriod(c, d); commit(`Books closed through ${d}.`); break; }
    case 'unlock': E.closePeriod(c, ''); commit('All periods reopened.'); break;
    case 'delete-ask': ui.confirmDelete = true; render(); break;
    case 'delete-no': ui.confirmDelete = false; render(); break;
    case 'delete-yes': {
      const name = c.name; delete state.companies[c.id]; state.order = state.order.filter(x => x !== c.id); state.activeId = state.order[0] || null; ui.confirmDelete = false; ui.route = 'overview'; ui.range = null; ui.recon = null;
      commit(`${name} deleted.`); if (!state.activeId) openWizard(); break;
    }
  }
});

function openWizard() { ui.wiz = { name: '', country: 'US', region: 'California', entityType: 'Single-member LLC', fiscalStartMonth: 1 }; ui.modal = wizard; render(); setTimeout(() => $('#w-name')?.focus(), 0); }

document.addEventListener('input', e => {
  const t = e.target; const val = t.type === 'checkbox' ? t.checked : t.value;
  if (t.dataset.draft) { ui.docDraft[t.dataset.draft] = val; }
  else if (t.dataset.line !== undefined) { ui.docDraft.lines[+t.dataset.line][t.dataset.k] = val; if (t.tagName !== 'INPUT' || t.type === 'checkbox' || t.dataset.k === 'qty' || t.dataset.k === 'price') rerenderKeep(t); }
  else if (t.dataset.je) { ui.jeDraft[t.dataset.je] = val; }
  else if (t.dataset.jl !== undefined) { const l = ui.jeDraft.lines[+t.dataset.jl]; l[t.dataset.k] = val; if (t.dataset.k === 'debit' && val) l.credit = ''; if (t.dataset.k === 'credit' && val) l.debit = ''; if (t.dataset.k !== 'memo') rerenderKeep(t); }
  else if (t.dataset.input === 'je-search') { ui.jeSearch = val; rerenderKeep(t); }
  else if (t.dataset.wiz) {
    ui.wiz[t.dataset.wiz] = val;
    if (t.dataset.wiz === 'country') { const j = E.JURISDICTIONS[val]; ui.wiz.region = j.regions[0]; ui.wiz.entityType = j.entities[0]; ui.wiz.fiscalStartMonth = { GB: 4, AU: 7, NZ: 4 }[val] || 1; }
    if (t.tagName === 'SELECT') render();
  }
  else if (t.dataset.tick) { t.checked ? ui.recon.ticked.add(t.dataset.tick) : ui.recon.ticked.delete(t.dataset.tick); render(); }
  else if (t.dataset.change === 'rc-bal') { ui.recon.bal = val; rerenderKeep(t); }
});
function rerenderKeep(t) { const id = t.id, pos = t.selectionStart; render(); const n = document.getElementById(id); if (n) { n.focus(); try { if (pos != null) n.setSelectionRange(pos, pos); } catch { } } }

document.addEventListener('change', async e => {
  const t = e.target, c = co();
  switch (t.dataset.change) {
    case 'switch-company': if (t.value === '__new') { t.value = state.activeId; openWizard(); } else { state.activeId = t.value; ui.range = null; ui.recon = null; ui.ledgerAcct = null; ui.docDraft = null; ui.jeDraft = null; Store.save(); render(); } return;
    case 'bank-pick': ui.bankAcct = t.value; render(); return;
    case 'rc-acct': ui.recon = { acct: t.value, end: ui.recon.end, bal: '', ticked: new Set() }; render(); return;
    case 'rc-end': ui.recon.end = t.value; render(); return;
    case 'rg-from': ui.range = { ...ui.range, from: t.value }; render(); return;
    case 'rg-to': ui.range = { ...ui.range, to: t.value }; render(); return;
    case 'rg-preset': if (t.value) { ui.range = presets(c)[t.value]; render(); } return;
    case 'gl-acct': ui.ledgerAcct = t.value || null; render(); return;
  }
  if (t.dataset.set) {
    const k = t.dataset.set;
    if (k === 'taxRate') { const bps = Math.round(parseFloat(t.value || '0') * 100); if (isNaN(bps) || bps < 0 || bps > 5000) return toast('Enter a rate between 0 and 50.', true); E.log(c, 'Tax rate changed', `${(c.taxRateBps / 100).toFixed(2)}% to ${(bps / 100).toFixed(2)}%`); c.taxRateBps = bps; }
    else if (k === 'fiscalStartMonth') { c.fiscalStartMonth = +t.value; ui.range = null; E.log(c, 'Fiscal year changed', `Starts in ${MONTHS[c.fiscalStartMonth - 1]}`); }
    else { E.log(c, 'Company profile updated', `${k}: ${c[k] || '(blank)'} to ${t.value}`); c[k] = t.value; }
    if (k === 'name') c.sample = false;
    commit('Saved.'); return;
  }
  if (t.id === 'csv-file' && t.files[0]) { $('#csv-text').value = await t.files[0].text(); toast('File loaded. Check the preview, then select Import lines.'); }
  if (t.id === 'restore-file' && t.files[0]) {
    try { const s = JSON.parse(await t.files[0].text()); if (!s.order || !s.companies) throw new Error(); state = s; ui = { ...ui, range: null, recon: null, route: 'overview' }; commit('Backup restored.'); }
    catch { toast('That file is not a Ledgerline backup.', true); }
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.modal && ui.modal !== wizard) { ui.modal = null; render(); } });

/* ----- Boot ----- */
(function boot() {
  const s = buildSampleCompany();
  state = { companies: { [s.id]: s }, order: [s.id], activeId: s.id };
  render();
  Store.ready = Store.init(); Downloads.init();
})();
