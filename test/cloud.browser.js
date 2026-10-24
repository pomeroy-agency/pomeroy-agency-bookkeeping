// Run: SUPABASE_URL=https://demo.supabase.co SUPABASE_ANON_KEY=test npm run build && node test/cloud.browser.js (needs playwright)
// Drives the built app against a fake Supabase API to check sign-in, loading, saving, conflicts, team access and view-only mode.
const { chromium } = require('playwright');
const dist = require('path').resolve(__dirname, '../dist');
const db = {}, invites = [], roleOverride = {}, log = []; let pendingJoins = 0;
const user = { id: '11111111-1111-1111-1111-111111111111', email: 'greg@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const session = () => ({ access_token: 'tok', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\./, r => r.abort());
  await p.route('https://demo.supabase.co/**', async r => {
    const req = r.request(), u = new URL(req.url()), m = req.method(), body = req.postData() ? JSON.parse(req.postData() || 'null') : null;
    log.push(m + ' ' + u.pathname + u.search);
    const json = (s, o) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/auth/v1/token') return body.password === 'correct-horse' ? json(200, session()) : json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
    if (u.pathname === '/auth/v1/logout') return r.fulfill({ status: 204 });
    if (u.pathname === '/auth/v1/otp') return json(200, {});
    if (u.pathname === '/rest/v1/rpc/accept_invites') { const n = pendingJoins; pendingJoins = 0; return json(200, n); }
    if (u.pathname === '/rest/v1/rpc/company_people') return json(200, [{ user_id: user.id, email: user.email, role: roleOverride[body.cid] || 'owner', added_at: new Date().toISOString() }]);
    if (u.pathname === '/rest/v1/company_members') {
      if (m === 'GET') return json(200, Object.keys(db).map(id => ({ company_id: id, role: roleOverride[id] || 'owner' })));
      return json(200, []);
    }
    if (u.pathname === '/rest/v1/company_invites') {
      const cid = (u.searchParams.get('company_id') || '').slice(3);
      if (m === 'GET') return json(200, invites.filter(i => i.company_id === cid));
      if (m === 'POST') { if (invites.some(i => i.company_id === body.company_id && i.email === body.email)) return json(409, { code: '23505', message: 'duplicate key' }); invites.push({ ...body, created_at: new Date().toISOString() }); return r.fulfill({ status: 201 }); }
      if (m === 'DELETE') { const email = u.searchParams.get('email').slice(3); invites.splice(invites.findIndex(i => i.email === email), 1); return r.fulfill({ status: 204 }); }
    }
    if (u.pathname === '/rest/v1/companies') {
      if (m === 'GET') return json(200, Object.values(db).map(x => ({ id: x.id, data: x.data, version: x.version })));
      if (m === 'POST') { db[body.id] = { ...body, version: 1 }; return json(201, req.headers()['accept']?.includes('object') ? { version: 1 } : [{ version: 1 }]); }
      const id = u.searchParams.get('id').slice(3);
      if (m === 'PATCH') { const v = +(u.searchParams.get('version') || 'eq.0').slice(3); const row = db[id]; if (!row || row.version !== v) return json(200, []); Object.assign(row, body); row.version++; return json(200, [{ version: row.version }]); }
      if (m === 'DELETE') { delete db[id]; return r.fulfill({ status: 204 }); }
    }
    return json(404, { message: 'not mocked ' + u.pathname });
  });
  await p.goto('file://' + dist + '/index.html');
  await p.waitForSelector('#auth-form');
  console.log('sign-in screen shown');
  await p.fill('#auth-email', 'greg@example.com'); await p.fill('#auth-password', 'wrong-password'); await p.click('#auth-form button[type=submit]');
  await p.waitForSelector('.autherr'); console.log('bad password:', await p.textContent('.autherr'));
  await p.fill('#auth-password', 'correct-horse'); await p.click('#auth-form button[type=submit]');
  await p.waitForSelector('nav'); console.log('signed in, account shows:', await p.textContent('.account span'));
  console.log('new user sees example:', !!(await p.$('.banner')));
  // change something on the example -> inserted
  await p.click('nav button[data-v="settings"]'); await p.fill('#s-taxid', '12-3456789'); await p.press('#s-taxid', 'Tab');
  await p.waitForFunction(() => document.querySelector('#savestate').textContent.includes('Saved to your account'));
  console.log('rows after first save:', Object.keys(db).length, 'version', Object.values(db)[0].version, 'taxId', Object.values(db)[0].data.taxId);
  // second change -> update with version
  await p.fill('#s-taxid', '98-7654321'); await p.press('#s-taxid', 'Tab');
  await p.waitForFunction(() => document.querySelector('#savestate').textContent.includes('Saved to your account'));
  console.log('after update: version', Object.values(db)[0].version, 'taxId', Object.values(db)[0].data.taxId);
  // reload -> data comes back
  await p.reload(); await p.waitForSelector('nav'); await p.click('nav button[data-v="settings"]');
  console.log('after reload taxId:', await p.inputValue('#s-taxid'));
  // conflict: someone else saves
  const row = Object.values(db)[0]; row.version = 99; row.data = { ...row.data, taxId: 'FROM-ELSEWHERE' };
  await p.fill('#s-taxid', 'MINE'); await p.press('#s-taxid', 'Tab');
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('not saved'));
  await p.waitForTimeout(400); await p.click('nav button[data-v="settings"]');
  console.log('conflict handled, now showing:', await p.inputValue('#s-taxid'), '| db still', db[row.id].data.taxId);
  // create company, then delete it
  await p.selectOption('#company-switch', '__new'); await p.fill('#w-name', 'Harbor Design Ltd'); await p.click('button[data-act="wiz-save"]');
  await p.waitForFunction(() => document.querySelector('#savestate').textContent.includes('Saved to your account'));
  console.log('rows after new company:', Object.keys(db).length);
  await p.click('nav button[data-v="settings"]'); await p.click('button[data-act="delete-ask"]'); await p.click('button[data-act="delete-yes"]');
  await p.waitForFunction(() => document.querySelector('#savestate').textContent.includes('Saved to your account'));
  await p.waitForTimeout(300);
  console.log('rows after delete:', Object.keys(db).length);
  // team: invite, duplicate invite, cancel
  await p.click('nav button[data-v="team"]'); await p.waitForSelector('#tm-email');
  await p.fill('#tm-email', 'Accountant@Firm.com'); await p.selectOption('#tm-role', 'bookkeeper'); await p.click('button[data-act="team-invite"]');
  await p.waitForSelector('button[data-act="team-cancel"]');
  console.log('invite stored:', JSON.stringify(invites.map(i => [i.email, i.role])), '| hint shown:', !!(await p.$('.note')));
  await p.fill('#tm-email', 'accountant@firm.com'); await p.click('button[data-act="team-invite"]');
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('already invited'));
  console.log('duplicate invite refused');
  await p.click('button[data-act="team-cancel"]'); await p.waitForFunction(() => !document.querySelector('button[data-act="team-cancel"]'));
  console.log('invite cancelled, left:', invites.length);
  await p.screenshot({ path: require('os').tmpdir() + '/ledgerline-team.png' });
  // view-only: someone made this person a viewer
  const cid = Object.keys(db)[0]; roleOverride[cid] = 'viewer'; pendingJoins = 1;
  await p.reload(); await p.waitForSelector('nav');
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('new company'));
  console.log('join toast:', await p.textContent('#toast'));
  console.log('view-only banner:', (await p.textContent('.banner')).includes('View only'));
  const before = db[cid].version;
  await p.click('nav button[data-v="settings"]'); const was = await p.inputValue('#s-taxid'); await p.fill('#s-taxid', 'VIEWER-EDIT'); await p.press('#s-taxid', 'Tab');
  await p.waitForFunction(() => document.querySelector('#toast')?.textContent.includes('view-only'));
  await p.waitForTimeout(800);
  console.log('viewer edit reverted:', (await p.inputValue('#s-taxid')) === was, '| saved version unchanged:', db[cid].version === before, '| delete hidden:', !(await p.$('button[data-act="delete-ask"]')));
  delete roleOverride[cid];
  await p.screenshot({ path: require('os').tmpdir() + '/ledgerline-cloud-app.png' });
  await p.click('button[data-act="sign-out"]'); await p.waitForSelector('#auth-form'); console.log('signed out -> sign-in screen');
  await p.click('button[data-act="auth-mode"]'); await p.screenshot({ path: require('os').tmpdir() + '/ledgerline-cloud-signup.png' });
  await p.setViewportSize({ width: 400, height: 800 }); await p.click('button[data-act="auth-mode"]'); await p.screenshot({ path: require('os').tmpdir() + '/ledgerline-cloud-signin-phone.png' });
  console.log('errors:', errs);
  console.log('requests:', [...new Set(log.map(l => l.replace(/\?.*/, '')))].join(', '));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
