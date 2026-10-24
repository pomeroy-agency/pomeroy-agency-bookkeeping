const assert = require('assert');
global.Engine = require('../src/engine.js');
const E = Engine;
const buildSampleCompany = require('../src/sample.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const c = buildSampleCompany();
t('sample trial balance balances', () => assert(E.trialBalance(c).balanced));
t('sample balance sheet balances', () => { const b = E.balanceSheet(c, E.today()); assert(b.balanced, JSON.stringify([b.totalAssets, b.totalLiabilities, b.totalEquity])); });
t('toCents parsing', () => {
  assert.strictEqual(E.toCents('1,234.5'), 123450); assert.strictEqual(E.toCents('(45.00)'), -4500);
  assert.strictEqual(E.toCents('-3'), -300); assert.strictEqual(E.toCents('$0.07'), 7); assert.strictEqual(E.toCents('-0.50'), -50);
});
t('unbalanced entry rejected', () => {
  const a = c.accounts;
  assert.throws(() => E.post(c, { date: E.today(), lines: [{ accountId: a[0].id, debit: 100 }, { accountId: a[1].id, credit: 99 }] }), /must be equal/);
});
t('lock date blocks posting', () => {
  const x = E.newCompany({ country: 'GB' }); E.closePeriod(x, '2026-06-30');
  assert.throws(() => E.post(x, { date: '2026-06-15', lines: [{ accountId: x.accounts[0].id, debit: 100 }, { accountId: x.accounts[1].id, credit: 100 }] }), /closed/);
  E.post(x, { date: '2026-07-01', lines: [{ accountId: x.accounts[0].id, debit: 100 }, { accountId: x.accounts[1].id, credit: 100 }] });
});
t('reversal nets to zero', () => {
  const x = E.newCompany({}); const bank = E.sys(x, 'bank').id, rev = x.accounts.find(a => a.type === 'revenue').id;
  const j = E.post(x, { date: '2026-03-01', lines: [{ accountId: bank, debit: 5000 }, { accountId: rev, credit: 5000 }] });
  E.reverse(x, j.id, '2026-03-02');
  assert.strictEqual(E.balances(x)[bank], 0);
  assert.throws(() => E.reverse(x, j.id), /already/);
});
t('invoice with tax then payment clears AR', () => {
  const x = E.newCompany({ taxRateBps: 825 }); const cu = E.ensureContact(x, 'Acme', 'customer');
  const rev = x.accounts.find(a => a.code === '4000').id;
  const inv = E.createInvoice(x, { contactId: cu.id, date: '2026-02-01', due: '2026-03-01', lines: [{ accountId: rev, qty: 3, price: 3333, taxable: true }] });
  const tot = E.docTotals(x, inv); assert.strictEqual(tot.sub, 9999); assert.strictEqual(tot.tax, 825); assert.strictEqual(tot.total, 10824);
  assert.throws(() => E.payDoc(x, 'invoice', inv.id, { date: '2026-02-10', amount: 99999 }), /more than/);
  E.payDoc(x, 'invoice', inv.id, { date: '2026-02-10', amount: 10824 });
  assert.strictEqual(E.balances(x)[E.sys(x, 'ar').id], 0);
  assert.strictEqual(E.docStatus(x, inv, '2026-04-01'), 'paid');
  assert.strictEqual(-E.balances(x)[E.sys(x, 'tax').id], 825);
});
t('bank CSV import, dedupe, DMY dates, split columns', () => {
  const x = E.newCompany({ country: 'AU' }); const bank = E.sys(x, 'bank').id;
  const csv = 'Date,Narrative,Debit,Credit\n03/02/2026,"Coffee, beans",120.00,\n04/02/2026,Client pay,,500\n';
  let r = E.importBankCSV(x, csv, bank); assert.strictEqual(r.added, 2);
  assert.strictEqual(x.bankTxns[0].date, '2026-02-03'); assert.strictEqual(x.bankTxns[0].amount, -12000); assert.strictEqual(x.bankTxns[0].desc, 'Coffee, beans');
  r = E.importBankCSV(x, csv, bank); assert.strictEqual(r.added, 0); assert.strictEqual(r.dupes, 2);
  E.postBankTxn(x, x.bankTxns[0].id, { accountId: x.accounts.find(a => a.code === '6600').id });
  assert.strictEqual(E.balances(x)[bank], -12000);
});
t('bank suggestion matches open invoice', () => {
  const tx = c.bankTxns.find(t => t.desc.startsWith('ACH'));
  const s = E.suggest(c, tx); assert.strictEqual(s.kind, 'invoice');
  E.postBankTxn(c, tx.id, s); assert(E.trialBalance(c).balanced);
});
t('reconciliation requires zero difference', () => {
  const x = E.newCompany({}); const bank = E.sys(x, 'bank').id, eq = x.accounts.find(a => a.code === '3000').id, exp = x.accounts.find(a => a.code === '6400').id;
  E.post(x, { date: '2026-01-02', lines: [{ accountId: bank, debit: 100000 }, { accountId: eq, credit: 100000 }] });
  E.post(x, { date: '2026-01-15', lines: [{ accountId: exp, debit: 30000 }, { accountId: bank, credit: 30000 }] });
  E.post(x, { date: '2026-01-30', lines: [{ accountId: exp, debit: 5000 }, { accountId: bank, credit: 5000 }] });
  const items = E.reconItems(x, bank, '2026-01-31');
  const ticked = new Set(items.slice(0, 2).map(i => i.key));
  assert.throws(() => E.completeRecon(x, bank, '2026-01-31', 65000, ticked), /difference/);
  E.completeRecon(x, bank, '2026-01-31', 70000, ticked);
  assert.strictEqual(E.reconItems(x, bank, '2026-02-28').length, 1);
  assert.strictEqual(E.reconSummary(x, bank, '2026-02-28', 65000, new Set(E.reconItems(x, bank, '2026-02-28').map(i => i.key))).difference, 0);
});
t('fiscal year and retained earnings roll', () => {
  const x = E.newCompany({ fiscalStartMonth: 7 }); const bank = E.sys(x, 'bank').id, rev = x.accounts.find(a => a.code === '4000').id;
  assert.strictEqual(E.fiscalYearStart(x, '2026-03-10'), '2025-07-01'); assert.strictEqual(E.fiscalYearStart(x, '2026-07-01'), '2026-07-01');
  E.post(x, { date: '2026-05-01', lines: [{ accountId: bank, debit: 1000 }, { accountId: rev, credit: 1000 }] });
  E.post(x, { date: '2026-08-01', lines: [{ accountId: bank, debit: 400 }, { accountId: rev, credit: 400 }] });
  const b = E.balanceSheet(x, '2026-09-30'); assert.strictEqual(b.priorEarnings, 1000); assert.strictEqual(b.currentEarnings, 400); assert(b.balanced);
});
t('entity type drives equity accounts', () => {
  assert(E.newCompany({ entityType: 'Nonprofit' }).accounts.some(a => /Net assets/.test(a.name)));
  assert(E.newCompany({ entityType: 'C corporation' }).accounts.some(a => /paid-in/.test(a.name)));
  assert(E.newCompany({ country: 'GB' }).accounts.some(a => a.name === 'VAT payable'));
});
console.log(n, 'tests passed');
