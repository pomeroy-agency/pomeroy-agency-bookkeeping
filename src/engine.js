/* ---------- Ledger engine: pure functions, amounts in integer cents ---------- */
const Engine = (() => {
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const today = () => new Date().toISOString().slice(0, 10);

  const JURISDICTIONS = {
    US: { name: 'United States', currency: 'USD', framework: 'US GAAP (FASB ASC)', tax: 'Sales tax', taxId: 'EIN', retention: 'Commonly 3 to 7 years for IRS records', dateOrder: 'MDY',
      regions: ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','District of Columbia','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'],
      noSalesTax: ['Alaska','Delaware','Montana','New Hampshire','Oregon'],
      entities: ['Sole proprietorship','Single-member LLC','Multi-member LLC','Partnership','S corporation','C corporation','Nonprofit'] },
    CA: { name: 'Canada', currency: 'CAD', framework: 'ASPE (private) or IFRS (public)', tax: 'GST/HST', taxId: 'Business Number (BN)', retention: 'Generally 6 years for CRA records', dateOrder: 'YMD',
      regions: ['Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador','Northwest Territories','Nova Scotia','Nunavut','Ontario','Prince Edward Island','Quebec','Saskatchewan','Yukon'],
      entities: ['Sole proprietorship','Partnership','Corporation','Not-for-profit'] },
    GB: { name: 'United Kingdom', currency: 'GBP', framework: 'FRS 102 / FRS 105 (UK GAAP)', tax: 'VAT', taxId: 'UTR / VAT number', retention: 'Generally 6 years for companies', dateOrder: 'DMY',
      regions: ['England','Scotland','Wales','Northern Ireland'],
      entities: ['Sole trader','Partnership','Limited company','LLP','Charity'] },
    IE: { name: 'Ireland', currency: 'EUR', framework: 'FRS 102 (Irish GAAP)', tax: 'VAT', taxId: 'Tax reference number', retention: 'Generally 6 years for Revenue records', dateOrder: 'DMY',
      regions: ['Connacht','Leinster','Munster','Ulster (ROI)'],
      entities: ['Sole trader','Partnership','Private limited company (LTD)','Charity'] },
    AU: { name: 'Australia', currency: 'AUD', framework: 'Australian Accounting Standards (AASB)', tax: 'GST', taxId: 'ABN', retention: 'Generally 5 years for ATO records', dateOrder: 'DMY',
      regions: ['Australian Capital Territory','New South Wales','Northern Territory','Queensland','South Australia','Tasmania','Victoria','Western Australia'],
      entities: ['Sole trader','Partnership','Company (Pty Ltd)','Trust','Not-for-profit'] },
    NZ: { name: 'New Zealand', currency: 'NZD', framework: 'NZ GAAP (XRB tiers)', tax: 'GST', taxId: 'IRD number', retention: 'Generally 7 years for IRD records', dateOrder: 'DMY',
      regions: ['Auckland','Bay of Plenty','Canterbury','Gisborne',"Hawke's Bay",'Manawatu-Whanganui','Marlborough','Nelson','Northland','Otago','Southland','Taranaki','Tasman','Waikato','Wellington','West Coast'],
      entities: ['Sole trader','Partnership','Limited company','Trust','Charity'] },
  };

  const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'];
  const NORMAL = { asset: 1, expense: 1, liability: -1, equity: -1, revenue: -1 }; // +1 debit-normal

  function equityAccounts(entity) {
    const e = (entity || '').toLowerCase();
    if (e.includes('nonprofit') || e.includes('not-for-profit') || e.includes('charity'))
      return [['3000', 'Net assets without donor restrictions'], ['3100', 'Net assets with donor restrictions']];
    if (e.includes('sole') || e.includes('single-member'))
      return [['3000', "Owner's capital"], ['3100', "Owner's draws"]];
    if (e.includes('partnership') || e.includes('multi-member') || e.includes('llp') || e.includes('trust'))
      return [['3000', 'Partners’ / members’ capital'], ['3100', 'Distributions']];
    return [['3000', 'Share capital / common stock'], ['3050', 'Additional paid-in capital'], ['3100', 'Dividends']];
  }

  function defaultAccounts(entity, taxName) {
    const a = (code, name, type, subtype = '', system = '') => ({ id: uid(), code, name, type, subtype, system, archived: false });
    const nonprofit = /nonprofit|not-for-profit|charity/i.test(entity || '');
    return [
      a('1000', 'Operating bank account', 'asset', 'bank', 'bank'),
      a('1010', 'Savings account', 'asset', 'bank'),
      a('1100', 'Accounts receivable', 'asset', 'ar', 'ar'),
      a('1200', 'Prepaid expenses', 'asset', 'current'),
      a('1300', 'Inventory', 'asset', 'current'),
      a('1500', 'Equipment', 'asset', 'fixed'),
      a('1590', 'Accumulated depreciation', 'asset', 'contra'),
      a('2000', 'Accounts payable', 'liability', 'ap', 'ap'),
      a('2100', 'Credit card', 'liability', 'current'),
      a('2200', taxName + ' payable', 'liability', 'tax', 'tax'),
      a('2300', 'Payroll liabilities', 'liability', 'current'),
      a('2500', 'Loans payable', 'liability', 'longterm'),
      ...equityAccounts(entity).map(([c, n]) => a(c, n, 'equity')),
      a('3900', nonprofit ? 'Accumulated change in net assets' : 'Retained earnings', 'equity', '', 're'),
      a('4000', nonprofit ? 'Contributions' : 'Sales revenue', 'revenue'),
      a('4100', nonprofit ? 'Program service revenue' : 'Service revenue', 'revenue'),
      a('4900', 'Other income', 'revenue'),
      a('5000', 'Cost of goods sold', 'expense', 'cogs'),
      a('6000', 'Advertising and marketing', 'expense'),
      a('6100', 'Bank and payment fees', 'expense'),
      a('6200', 'Insurance', 'expense'),
      a('6300', 'Professional fees', 'expense'),
      a('6400', 'Rent', 'expense'),
      a('6500', 'Software and subscriptions', 'expense'),
      a('6600', 'Supplies', 'expense'),
      a('6700', 'Utilities', 'expense'),
      a('6800', 'Wages and salaries', 'expense'),
      a('6900', 'Depreciation', 'expense'),
      a('7000', 'Travel and meals', 'expense'),
    ];
  }

  function newCompany(opts) {
    const j = JURISDICTIONS[opts.country] || JURISDICTIONS.US;
    const c = {
      id: uid(), name: opts.name || 'My business', sample: !!opts.sample,
      country: opts.country || 'US', region: opts.region || j.regions[0], entityType: opts.entityType || j.entities[0],
      currency: opts.currency || j.currency, fiscalStartMonth: opts.fiscalStartMonth || 1, taxRateBps: opts.taxRateBps || 0,
      taxId: '', lockDate: '', createdAt: new Date().toISOString(),
      accounts: defaultAccounts(opts.entityType || j.entities[0], j.tax),
      journals: [], contacts: [], invoices: [], bills: [], bankTxns: [], recons: [], cleared: {}, audit: [],
      seq: { je: 1, inv: 1001, bill: 1 },
    };
    log(c, 'Company created', `${c.name} · ${j.name}, ${c.region} · ${c.entityType}`);
    return c;
  }

  function log(c, action, detail) { c.audit.unshift({ at: new Date().toISOString(), action, detail }); if (c.audit.length > 500) c.audit.length = 500; }
  const acct = (c, id) => c.accounts.find(a => a.id === id);
  const sys = (c, key) => c.accounts.find(a => a.system === key);

  /* Parse "12.34" / "1,234.50" / "(45.00)" / "-3" into cents */
  function toCents(v) {
    if (typeof v === 'number') return Math.round(v * 100);
    let s = String(v || '').trim(); if (!s) return 0;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[^0-9.\-]/g, '');
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    const [w, f = ''] = s.split('.');
    const cents = parseInt(w || '0', 10) * 100 + parseInt((f + '00').slice(0, 2), 10);
    return neg ? -cents : cents;
  }

  function validateEntry(c, e) {
    const errs = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) errs.push('Enter a valid date.');
    if (c.lockDate && e.date <= c.lockDate) errs.push(`The books are closed through ${c.lockDate}. Pick a later date or reopen the period in Settings.`);
    const lines = (e.lines || []).filter(l => l.debit || l.credit);
    if (lines.length < 2) errs.push('An entry needs at least two lines.');
    let dr = 0, cr = 0;
    for (const l of lines) {
      if (!acct(c, l.accountId)) errs.push('Every line needs an account.');
      if (l.debit < 0 || l.credit < 0) errs.push('Amounts cannot be negative. Use the other column.');
      if (l.debit && l.credit) errs.push('A line can have a debit or a credit, not both.');
      dr += l.debit || 0; cr += l.credit || 0;
    }
    if (dr !== cr) errs.push(`Debits (${fmt(dr)}) and credits (${fmt(cr)}) must be equal.`);
    if (dr === 0) errs.push('The entry has no amounts.');
    return [...new Set(errs)];
  }

  function post(c, e, source) {
    const errs = validateEntry(c, e);
    if (errs.length) throw new Error(errs.join(' '));
    const j = {
      id: uid(), no: c.seq.je++, date: e.date, memo: e.memo || '', source: source || { kind: 'manual' },
      lines: e.lines.filter(l => l.debit || l.credit).map(l => ({ accountId: l.accountId, debit: l.debit || 0, credit: l.credit || 0, memo: l.memo || '' })),
      createdAt: new Date().toISOString(),
    };
    c.journals.push(j);
    log(c, 'Entry posted', `JE-${j.no} · ${j.date} · ${j.memo} · ${fmt(total(j))}`);
    return j;
  }

  const total = j => j.lines.reduce((s, l) => s + l.debit, 0);

  /* Posted entries are never edited or deleted. Corrections are reversing entries. */
  function reverse(c, jid, date) {
    const j = c.journals.find(x => x.id === jid);
    if (!j) throw new Error('Entry not found.');
    if (j.reversedBy) throw new Error('This entry has already been reversed.');
    if (j.reverses) throw new Error('This entry is itself a reversal.');
    const r = post(c, { date: date || today(), memo: `Reversal of JE-${j.no}: ${j.memo}`, lines: j.lines.map(l => ({ ...l, debit: l.credit, credit: l.debit })) }, { kind: 'reversal', id: j.id });
    r.reverses = j.id; j.reversedBy = r.id;
    log(c, 'Entry reversed', `JE-${j.no} reversed by JE-${r.no}`);
    return r;
  }

  /* Net debit-minus-credit per account, inclusive date range */
  function balances(c, { from = '', to = '9999-12-31' } = {}) {
    const m = {};
    for (const j of c.journals) {
      if (j.date > to || (from && j.date < from)) continue;
      for (const l of j.lines) m[l.accountId] = (m[l.accountId] || 0) + l.debit - l.credit;
    }
    return m;
  }

  function trialBalance(c, to) {
    const b = balances(c, { to });
    const rows = c.accounts.filter(a => b[a.id]).sort((x, y) => x.code.localeCompare(y.code))
      .map(a => ({ account: a, debit: b[a.id] > 0 ? b[a.id] : 0, credit: b[a.id] < 0 ? -b[a.id] : 0 }));
    const dr = rows.reduce((s, r) => s + r.debit, 0), cr = rows.reduce((s, r) => s + r.credit, 0);
    return { rows, debit: dr, credit: cr, balanced: dr === cr };
  }

  function fiscalYearStart(c, date) {
    const [y, m] = date.split('-').map(Number);
    const fm = c.fiscalStartMonth || 1;
    const sy = m >= fm ? y : y - 1;
    return `${sy}-${String(fm).padStart(2, '0')}-01`;
  }
  function dayBefore(d) { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }

  function incomeStatement(c, from, to) {
    const b = balances(c, { from, to });
    // Revenue is shown positive when it has a credit balance, expenses positive when they have a debit balance
    const revenue = c.accounts.filter(a => a.type === 'revenue' && b[a.id]).sort((x, y) => x.code.localeCompare(y.code)).map(a => ({ account: a, amount: -b[a.id] }));
    const cogs = c.accounts.filter(a => a.type === 'expense' && a.subtype === 'cogs' && b[a.id]).map(a => ({ account: a, amount: b[a.id] }));
    const expenses = c.accounts.filter(a => a.type === 'expense' && a.subtype !== 'cogs' && b[a.id]).sort((x, y) => x.code.localeCompare(y.code)).map(a => ({ account: a, amount: b[a.id] }));
    const sum = r => r.reduce((s, x) => s + x.amount, 0);
    const totalRevenue = sum(revenue), totalCogs = sum(cogs), totalExpenses = sum(expenses);
    return { revenue, cogs, expenses, totalRevenue, totalCogs, grossProfit: totalRevenue - totalCogs, totalExpenses, netIncome: totalRevenue - totalCogs - totalExpenses };
  }

  function balanceSheet(c, asOf) {
    const b = balances(c, { to: asOf });
    const fy = fiscalYearStart(c, asOf);
    const rows = t => c.accounts.filter(a => a.type === t && b[a.id]).sort((x, y) => x.code.localeCompare(y.code)).map(a => ({ account: a, amount: NORMAL[t] * b[a.id] }));
    const assets = rows('asset'), liabilities = rows('liability'), equity = rows('equity');
    const prior = incomeStatement(c, '', dayBefore(fy)).netIncome;
    const current = incomeStatement(c, fy, asOf).netIncome;
    const sum = r => r.reduce((s, x) => s + x.amount, 0);
    const totalAssets = sum(assets), totalLiabilities = sum(liabilities);
    const totalEquity = sum(equity) + prior + current;
    return { asOf, assets, liabilities, equity, priorEarnings: prior, currentEarnings: current, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
  }

  function ledger(c, accountId, from, to) {
    const a = acct(c, accountId); const n = NORMAL[a.type];
    let run = n * (balances(c, { to: from ? dayBefore(from) : '0000-00-00' })[accountId] || 0);
    const opening = run;
    const lines = [];
    const js = c.journals.filter(j => (!from || j.date >= from) && (!to || j.date <= to)).sort((x, y) => x.date.localeCompare(y.date) || x.no - y.no);
    for (const j of js) j.lines.forEach((l, i) => { if (l.accountId === accountId) { run += n * (l.debit - l.credit); lines.push({ j, l, i, balance: run }); } });
    return { account: a, opening, lines, closing: run };
  }

  /* ----- Documents: invoices (AR) and bills (AP) ----- */
  function docTotals(c, d) {
    let sub = 0, tax = 0;
    for (const l of d.lines) {
      const amt = Math.round((l.qty || 0) * (l.price || 0));
      sub += amt; if (l.taxable) tax += Math.round(amt * (d.taxRateBps ?? c.taxRateBps) / 10000);
    }
    const paid = (d.payments || []).reduce((s, p) => s + p.amount, 0);
    return { sub, tax, total: sub + tax, paid, due: sub + tax - paid };
  }

  function docStatus(c, d, asOf = today()) {
    if (d.voided) return 'void';
    const t = docTotals(c, d);
    if (t.due <= 0) return 'paid';
    if (t.paid > 0) return d.due < asOf ? 'overdue' : 'partial';
    return d.due < asOf ? 'overdue' : 'open';
  }

  function createInvoice(c, d) {
    const t = docTotals(c, d);
    if (!d.contactId) throw new Error('Choose a customer.');
    if (t.total <= 0) throw new Error('The invoice total must be more than zero.');
    const inv = { id: uid(), no: 'INV-' + c.seq.inv++, contactId: d.contactId, date: d.date, due: d.due || d.date, lines: d.lines, taxRateBps: c.taxRateBps, payments: [], memo: d.memo || '' };
    const byAcct = {};
    for (const l of d.lines) byAcct[l.accountId] = (byAcct[l.accountId] || 0) + Math.round(l.qty * l.price);
    const lines = [{ accountId: sys(c, 'ar').id, debit: t.total, credit: 0 }];
    for (const [k, v] of Object.entries(byAcct)) if (v) lines.push({ accountId: k, debit: 0, credit: v });
    if (t.tax) lines.push({ accountId: sys(c, 'tax').id, debit: 0, credit: t.tax });
    const j = post(c, { date: d.date, memo: `${inv.no} · ${contactName(c, d.contactId)}`, lines }, { kind: 'invoice', id: inv.id });
    inv.journalId = j.id; c.invoices.push(inv);
    log(c, 'Invoice issued', `${inv.no} · ${fmt(t.total)}`);
    return inv;
  }

  function createBill(c, d) {
    const t = docTotals(c, d);
    if (!d.contactId) throw new Error('Choose a vendor.');
    if (t.total <= 0) throw new Error('The bill total must be more than zero.');
    const bill = { id: uid(), no: d.ref || 'BILL-' + c.seq.bill++, contactId: d.contactId, date: d.date, due: d.due || d.date, lines: d.lines, taxRateBps: 0, payments: [], memo: d.memo || '' };
    const byAcct = {};
    for (const l of d.lines) byAcct[l.accountId] = (byAcct[l.accountId] || 0) + Math.round(l.qty * l.price);
    const lines = Object.entries(byAcct).filter(([, v]) => v).map(([k, v]) => ({ accountId: k, debit: v, credit: 0 }));
    lines.push({ accountId: sys(c, 'ap').id, debit: 0, credit: t.total });
    const j = post(c, { date: d.date, memo: `${bill.no} · ${contactName(c, d.contactId)}`, lines }, { kind: 'bill', id: bill.id });
    bill.journalId = j.id; c.bills.push(bill);
    log(c, 'Bill recorded', `${bill.no} · ${fmt(t.total)}`);
    return bill;
  }

  function payDoc(c, kind, docId, { date, amount, bankAccountId }) {
    const list = kind === 'invoice' ? c.invoices : c.bills;
    const d = list.find(x => x.id === docId);
    if (!d) throw new Error('Document not found.');
    const t = docTotals(c, d);
    if (amount <= 0) throw new Error('Enter a payment amount.');
    if (amount > t.due) throw new Error(`The payment is more than the ${fmt(t.due)} still due.`);
    const bank = bankAccountId || sys(c, 'bank').id;
    const lines = kind === 'invoice'
      ? [{ accountId: bank, debit: amount, credit: 0 }, { accountId: sys(c, 'ar').id, debit: 0, credit: amount }]
      : [{ accountId: sys(c, 'ap').id, debit: amount, credit: 0 }, { accountId: bank, debit: 0, credit: amount }];
    const j = post(c, { date, memo: `Payment ${kind === 'invoice' ? 'received' : 'made'} · ${d.no} · ${contactName(c, d.contactId)}`, lines }, { kind: kind + '-payment', id: d.id });
    d.payments.push({ date, amount, bankAccountId: bank, journalId: j.id });
    return j;
  }

  function contactName(c, id) { return (c.contacts.find(x => x.id === id) || {}).name || 'Unknown'; }
  function ensureContact(c, name, kind) {
    let x = c.contacts.find(k => k.name.toLowerCase() === name.trim().toLowerCase());
    if (!x) { x = { id: uid(), name: name.trim(), kind }; c.contacts.push(x); }
    return x;
  }

  /* ----- Bank feed ----- */
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => x.trim()));
  }

  function parseDate(s, order) {
    s = (s || '').trim();
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
      let [, a, b, y] = m; if (y.length === 2) y = '20' + y;
      const [mo, d] = order === 'MDY' ? [a, b] : [b, a];
      if (+mo > 12 || +d > 31) return null;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
  }

  /* Accepts Date, Description, Amount  or  Date, Description, Debit/Withdrawal, Credit/Deposit */
  function importBankCSV(c, text, bankAccountId) {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('The file is empty.');
    const head = rows[0].map(h => h.trim().toLowerCase());
    const find = (...ks) => head.findIndex(h => ks.some(k => h.includes(k)));
    let iDate = find('date'), iDesc = find('desc', 'memo', 'payee', 'detail', 'narrative', 'name');
    let iAmt = find('amount'), iOut = find('withdraw', 'debit', 'paid out', 'money out'), iIn = find('deposit', 'credit', 'paid in', 'money in');
    let body = rows.slice(1);
    if (iDate < 0) { iDate = 0; iDesc = 1; iAmt = 2; body = rows; }
    if (iAmt < 0 && iOut < 0 && iIn < 0) throw new Error('Could not find an Amount column, or Debit and Credit columns.');
    const order = (JURISDICTIONS[c.country] || {}).dateOrder;
    const seen = new Set(c.bankTxns.map(t => t.bankAccountId + '|' + t.date + '|' + t.amount + '|' + t.desc));
    let added = 0, dupes = 0; const bad = [];
    body.forEach((r, n) => {
      const date = parseDate(r[iDate], order);
      const amount = iAmt >= 0 ? toCents(r[iAmt]) : toCents(r[iIn]) - Math.abs(toCents(r[iOut]));
      const desc = (r[iDesc] || '').trim() || 'Bank transaction';
      if (!date || !amount) { bad.push(n + 2); return; }
      const key = bankAccountId + '|' + date + '|' + amount + '|' + desc;
      if (seen.has(key)) { dupes++; return; }
      seen.add(key);
      c.bankTxns.push({ id: uid(), bankAccountId, date, desc, amount, status: 'new' });
      added++;
    });
    log(c, 'Bank statement imported', `${added} added, ${dupes} duplicates skipped${bad.length ? ', ' + bad.length + ' unreadable rows' : ''}`);
    return { added, dupes, bad };
  }

  /* Suggest a match: open invoice/bill with the same amount still due, else a rule from past categorizations */
  function suggest(c, t) {
    const list = t.amount > 0 ? c.invoices : c.bills;
    const kind = t.amount > 0 ? 'invoice' : 'bill';
    const doc = list.find(d => !d.voided && docTotals(c, d).due === Math.abs(t.amount));
    if (doc) return { kind, docId: doc.id, label: `Payment ${t.amount > 0 ? 'from' : 'to'} ${contactName(c, doc.contactId)} for ${doc.no}` };
    const word = t.desc.toLowerCase().split(/\s+/)[0];
    const prior = c.bankTxns.filter(x => x.status === 'posted' && x.accountId && x.desc.toLowerCase().split(/\s+/)[0] === word).pop();
    if (prior) return { kind: 'account', accountId: prior.accountId, label: `Same as earlier "${prior.desc}"` };
    return null;
  }

  function postBankTxn(c, txnId, { accountId, kind, docId, memo }) {
    const t = c.bankTxns.find(x => x.id === txnId);
    if (!t || t.status === 'posted') throw new Error('This transaction is already recorded.');
    let j;
    if (kind === 'invoice' || kind === 'bill') {
      j = payDoc(c, kind, docId, { date: t.date, amount: Math.abs(t.amount), bankAccountId: t.bankAccountId });
    } else {
      if (!accountId) throw new Error('Choose a category.');
      if (accountId === t.bankAccountId) throw new Error('Pick an account other than the bank account itself.');
      const amt = Math.abs(t.amount);
      const lines = t.amount > 0
        ? [{ accountId: t.bankAccountId, debit: amt, credit: 0 }, { accountId, debit: 0, credit: amt }]
        : [{ accountId, debit: amt, credit: 0 }, { accountId: t.bankAccountId, debit: 0, credit: amt }];
      j = post(c, { date: t.date, memo: memo || t.desc, lines }, { kind: 'bank', id: t.id });
    }
    t.status = 'posted'; t.journalId = j.id; t.accountId = accountId || null;
    return j;
  }

  function excludeBankTxn(c, txnId) {
    const t = c.bankTxns.find(x => x.id === txnId);
    if (t && t.status !== 'posted') { t.status = 'excluded'; log(c, 'Bank line excluded', `${t.date} · ${t.desc} · ${fmt(t.amount)}`); }
  }

  /* ----- Reconciliation: tick ledger lines on a bank account against a statement ----- */
  function reconItems(c, bankAccountId, endDate) {
    const items = [];
    for (const j of c.journals) {
      if (j.date > endDate) continue;
      j.lines.forEach((l, i) => {
        if (l.accountId !== bankAccountId) return;
        const key = j.id + '_' + i;
        const done = c.cleared[key];
        if (done && c.recons.find(r => r.id === done && r.completedAt)) return;
        items.push({ key, j, amount: l.debit - l.credit });
      });
    }
    return items.sort((a, b) => a.j.date.localeCompare(b.j.date));
  }
  function lastRecon(c, bankAccountId) { return c.recons.filter(r => r.bankAccountId === bankAccountId && r.completedAt).sort((a, b) => a.endDate.localeCompare(b.endDate)).pop(); }
  function reconSummary(c, bankAccountId, endDate, endBalance, tickedKeys) {
    const begin = (lastRecon(c, bankAccountId) || { endBalance: 0 }).endBalance;
    const items = reconItems(c, bankAccountId, endDate);
    const cleared = items.filter(i => tickedKeys.has(i.key)).reduce((s, i) => s + i.amount, 0);
    return { begin, cleared, clearedBalance: begin + cleared, difference: endBalance - (begin + cleared), items };
  }
  function completeRecon(c, bankAccountId, endDate, endBalance, tickedKeys) {
    const s = reconSummary(c, bankAccountId, endDate, endBalance, tickedKeys);
    if (s.difference !== 0) throw new Error(`The difference is ${fmt(s.difference)}. It must be zero to finish.`);
    const prev = lastRecon(c, bankAccountId);
    if (prev && endDate <= prev.endDate) throw new Error(`This account is already reconciled through ${prev.endDate}.`);
    const r = { id: uid(), bankAccountId, endDate, endBalance, completedAt: new Date().toISOString(), count: tickedKeys.size };
    c.recons.push(r);
    for (const k of tickedKeys) c.cleared[k] = r.id;
    log(c, 'Reconciliation completed', `${acct(c, bankAccountId).name} through ${endDate} · statement balance ${fmt(endBalance)}`);
    return r;
  }

  function closePeriod(c, date) {
    const prev = c.lockDate;
    c.lockDate = date || '';
    log(c, date ? 'Books closed' : 'Period reopened', date ? `Closed through ${date}${prev ? ' (was ' + prev + ')' : ''}` : `Was closed through ${prev}`);
  }

  function aging(c, kind, asOf = today()) {
    const list = kind === 'invoice' ? c.invoices : c.bills;
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, over: 0 };
    const rows = [];
    for (const d of list) {
      if (d.voided) continue;
      const due = docTotals(c, d).due; if (due <= 0) continue;
      const days = Math.floor((new Date(asOf) - new Date(d.due)) / 864e5);
      const b = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'over';
      buckets[b] += due; rows.push({ d, due, days, bucket: b });
    }
    return { buckets, rows, total: Object.values(buckets).reduce((s, v) => s + v, 0) };
  }

  /* Books health checks. These are bookkeeping hygiene checks, not a compliance determination. */
  function health(c) {
    const out = [];
    const tb = trialBalance(c);
    out.push({ ok: tb.balanced, title: 'Trial balance is in balance', detail: tb.balanced ? `Debits and credits both total ${fmt(tb.debit)}.` : `Off by ${fmt(tb.debit - tb.credit)}.` });
    const bs = balanceSheet(c, today());
    out.push({ ok: bs.balanced, title: 'Balance sheet balances', detail: 'Assets equal liabilities plus equity.' });
    const unrev = c.bankTxns.filter(t => t.status === 'new').length;
    out.push({ ok: !unrev, title: 'Bank feed reviewed', detail: unrev ? `${unrev} bank transaction${unrev > 1 ? 's' : ''} still need a category.` : 'Every imported bank line is recorded or excluded.', go: 'bank' });
    const banks = c.accounts.filter(a => a.subtype === 'bank' && !a.archived);
    const b = balances(c);
    const stale = banks.filter(a => b[a.id] && (!lastRecon(c, a.id) || (new Date(today()) - new Date(lastRecon(c, a.id).endDate)) / 864e5 > 45));
    out.push({ ok: !stale.length, title: 'Bank accounts reconciled within 45 days', detail: stale.length ? stale.map(a => a.name).join(', ') + ' need reconciling.' : 'All active bank accounts are up to date.', go: 'reconcile' });
    const od = c.invoices.filter(d => docStatus(c, d) === 'overdue').length;
    out.push({ ok: !od, warn: true, title: 'No overdue invoices', detail: od ? `${od} invoice${od > 1 ? 's are' : ' is'} past due.` : 'Customers are paying on time.', go: 'invoices' });
    out.push({ ok: !!c.lockDate, warn: true, title: 'Prior periods closed', detail: c.lockDate ? `Locked through ${c.lockDate}.` : 'No period is locked yet. Close each month after reconciling so past figures cannot change.', go: 'settings' });
    out.push({ ok: !!c.taxId, warn: true, title: `${(JURISDICTIONS[c.country] || {}).taxId || 'Tax ID'} on file`, detail: c.taxId ? 'Recorded in Settings.' : 'Add it in Settings so it prints on invoices and reports.', go: 'settings' });
    return out;
  }

  let CUR = 'USD', LOCALE = 'en-US';
  function setCurrency(code, country) { CUR = code; LOCALE = { US: 'en-US', CA: 'en-CA', GB: 'en-GB', IE: 'en-IE', AU: 'en-AU', NZ: 'en-NZ' }[country] || 'en-US'; }
  function fmt(cents, opts = {}) {
    try { return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CUR, ...opts }).format((cents || 0) / 100); }
    catch { return ((cents || 0) / 100).toFixed(2); }
  }

  return { uid, today, JURISDICTIONS, TYPES, NORMAL, newCompany, defaultAccounts, log, acct, sys, toCents, validateEntry, post, total, reverse, balances, trialBalance,
    fiscalYearStart, dayBefore, incomeStatement, balanceSheet, ledger, docTotals, docStatus, createInvoice, createBill, payDoc, contactName, ensureContact,
    parseCSV, parseDate, importBankCSV, suggest, postBankTxn, excludeBankTxn, reconItems, reconSummary, completeRecon, lastRecon, closePeriod, aging, health, setCurrency, fmt };
})();
if (typeof module !== 'undefined') module.exports = Engine;
