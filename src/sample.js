/* ---------- Example company, dated relative to today so it always looks current ---------- */
function buildSampleCompany() {
  const E = Engine;
  const c = E.newCompany({ name: 'Riverside Coffee Roasters (example)', sample: true, country: 'US', region: 'Vermont', entityType: 'Single-member LLC', taxRateBps: 600 });
  const d = n => { const t = new Date(); t.setDate(t.getDate() - n); return t.toISOString().slice(0, 10); };
  const A = code => c.accounts.find(a => a.code === code).id;
  const bank = A('1000');
  E.post(c, { date: d(88), memo: 'Owner investment to open the business', lines: [{ accountId: bank, debit: 2500000 }, { accountId: A('3000'), credit: 2500000 }] });
  E.post(c, { date: d(85), memo: 'Espresso machine purchase', lines: [{ accountId: A('1500'), debit: 840000 }, { accountId: bank, credit: 840000 }] });
  const cust = ['Maple Street Cafe', 'Green Mountain Co-op', 'Burlington Bagel Works'].map(n => E.ensureContact(c, n, 'customer'));
  const vend = ['Northeast Green Coffee Importers', 'Lakeside Property Management', 'Champlain Electric'].map(n => E.ensureContact(c, n, 'vendor'));
  const inv = (ci, days, terms, lines) => E.createInvoice(c, { contactId: cust[ci].id, date: d(days), due: d(days - terms), lines });
  const i1 = inv(0, 60, 30, [{ desc: 'House blend, 5 lb bags', accountId: A('4000'), qty: 40, price: 4200, taxable: true }]);
  const i2 = inv(1, 40, 30, [{ desc: 'Single-origin Ethiopia, 5 lb bags', accountId: A('4000'), qty: 25, price: 5600, taxable: true }, { desc: 'Barista training session', accountId: A('4100'), qty: 1, price: 35000, taxable: false }]);
  inv(2, 45, 15, [{ desc: 'Decaf blend, 5 lb bags', accountId: A('4000'), qty: 12, price: 4400, taxable: true }]);
  inv(0, 10, 30, [{ desc: 'House blend, 5 lb bags', accountId: A('4000'), qty: 30, price: 4200, taxable: true }]);
  const bill = (vi, days, ref, acc, amt) => E.createBill(c, { contactId: vend[vi].id, date: d(days), due: d(days - 30), ref, lines: [{ desc: ref, accountId: A(acc), qty: 1, price: amt }] });
  const b1 = bill(0, 70, 'NGC-4471', '5000', 612000);
  bill(1, 32, 'Rent, this month', '6400', 210000);
  bill(2, 20, 'CE-88213', '6700', 38450);
  E.payDoc(c, 'invoice', i1.id, { date: d(28), amount: E.docTotals(c, i1).total });
  E.payDoc(c, 'bill', b1.id, { date: d(45), amount: 612000 });
  E.post(c, { date: d(30), memo: 'Monthly depreciation, espresso machine', lines: [{ accountId: A('6900'), debit: 14000 }, { accountId: A('1590'), credit: 14000 }] });
  // Recent bank lines waiting for review
  const feed = [[d(6), 'SQUARE DEPOSIT 8841', 18640], [d(5), 'ADOBE CREATIVE CLOUD', -5999], [d(4), 'STRIPE PAYOUT', 41200], [d(3), 'CITY WATER DEPT', -6420], [d(2), `ACH ${cust[1].name.toUpperCase()}`, E.docTotals(c, i2).total]];
  for (const [date, desc, amount] of feed) c.bankTxns.push({ id: E.uid(), bankAccountId: bank, date, desc, amount, status: 'new' });
  E.log(c, 'Example data loaded', 'Fictional transactions for trying the app');
  return c;
}
if (typeof module !== 'undefined') module.exports = buildSampleCompany;
