// Domain logic: records, fund sources, settings, admin management.
import { CLASSES, DEFAULT_TARGET } from './config.mjs';
import { readAll, append, update, remove, clear } from './sheets.mjs';
import { bad, requireAdmin, whoAmI, addUser, ensureDefaultAdmin, users, USER_RE, PASS_RE, EMAIL_RE } from './auth.mjs';
import { seedSample } from './seed.mjs';

const lc = s => String(s || '').trim().toLowerCase();
const setting = (d, k) => d.Settings.find(s => s.key === k)?.value;
async function putSetting(d, k, v) {
  const s = d.Settings.find(x => x.key === k);
  return s ? update('Settings', s._row, { key: k, value: v }) : append('Settings', [{ key: k, value: v }]);
}
const normRec = o => ({
  id: Number(o.id) || 0, fund: String(o.fund), uacs: String(o.uacs), desc: String(o.desc), cls: String(o.cls),
  pap: String(o.pap), office: String(o.office), allot: Number(o.allot) || 0, oblig: Number(o.oblig) || 0,
  disb: Number(o.disb) || 0, date: String(o.date || '')
});
const normFund = f => ({ code: String(f.code), name: String(f.name) });

/* ---------- read (everyone) ---------- */
async function seedAll(d) {
  const { funds, recs } = seedSample();
  await Promise.all([
    append('Funds', funds), append('Records', recs), ensureDefaultAdmin(d),
    append('Settings', [{ key: 'target', value: DEFAULT_TARGET }, { key: 'seeded', value: '1' }])
  ]);
}
export async function getData(ctx) {
  let d = await readAll();
  if (!setting(d, 'seeded')) {
    d = await readAll(true);
    if (!setting(d, 'seeded')) { await seedAll(d); d = await readAll(true); }
  }
  return {
    target: Number(setting(d, 'target')) || DEFAULT_TARGET,
    funds: d.Funds.map(normFund), recs: d.Records.map(normRec), me: await whoAmI(ctx)
  };
}

/* ---------- records (admin) ---------- */
function validate(rec, d) {
  const r = {
    id: Number(rec?.id) || Date.now(), fund: String(rec?.fund || ''), uacs: String(rec?.uacs || '').trim(),
    desc: String(rec?.desc || '').trim(), cls: String(rec?.cls || ''), pap: String(rec?.pap || '').trim(),
    office: String(rec?.office || '').trim(), allot: Number(rec?.allot) || 0, oblig: Number(rec?.oblig) || 0,
    disb: Number(rec?.disb) || 0, date: String(rec?.date || '').trim()
  };
  if (!d.Funds.some(f => String(f.code) === r.fund)) throw bad('Unknown fund source.');
  if (!/^\d{10}$/.test(r.uacs)) throw bad('UACS object code must be 10 digits.');
  if (!r.desc) throw bad('Enter an object description.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) throw bad('Select a valid obligation date (YYYY-MM-DD).');
  if (!CLASSES.includes(r.cls)) throw bad('Invalid expense class.');
  if (r.allot < 0 || r.oblig < 0 || r.disb < 0) throw bad('Amounts cannot be negative.');
  if (r.oblig > r.allot) throw bad('Obligations cannot exceed the allotment.');
  if (r.disb > r.oblig) throw bad('Disbursements cannot exceed obligations.');
  return r;
}
export async function upsertRecord(ctx, rec) {
  await requireAdmin(ctx);
  const d = await readAll(true), r = validate(rec, d), ex = d.Records.find(x => String(x.id) === String(r.id));
  ex ? await update('Records', ex._row, r) : await append('Records', [r]);
  return r.id;
}
export async function deleteRecord(ctx, id) {
  await requireAdmin(ctx);
  const ex = (await readAll(true)).Records.find(x => String(x.id) === String(id));
  if (ex) await remove('Records', ex._row);
  return !!ex;
}

/* ---------- fund sources & settings (admin) ---------- */
export async function addFund(ctx, f) {
  await requireAdmin(ctx);
  const code = String(f?.code || '').trim(), name = String(f?.name || '').trim();
  if (!/^\d{8}$/.test(code)) throw bad('Fund source code must be 8 digits.');
  if (!name) throw bad('Enter a description.');
  if ((await readAll(true)).Funds.some(x => String(x.code) === code)) throw bad('Code already exists.');
  await append('Funds', [{ code, name }]);
  return true;
}
export async function deleteFund(ctx, code) {
  await requireAdmin(ctx);
  const d = await readAll(true);
  if (d.Records.some(r => String(r.fund) === String(code))) throw bad('Fund source still has records.');
  const f = d.Funds.find(x => String(x.code) === String(code));
  if (f) await remove('Funds', f._row);
  return !!f;
}
export async function setTarget(ctx, v) {
  await requireAdmin(ctx);
  const n = Math.max(0, Math.min(100, Number(v)));
  await putSetting(await readAll(true), 'target', isNaN(n) ? DEFAULT_TARGET : n);
  return true;
}
export async function resetSample(ctx) {
  await requireAdmin(ctx);
  const { funds, recs } = seedSample();
  await Promise.all([clear('Records'), clear('Funds')]);
  await Promise.all([append('Funds', funds), append('Records', recs), putSetting(await readAll(true), 'target', DEFAULT_TARGET)]);
  return true;
}

/* ---------- admin management ---------- */
export async function registerAdmin(ctx, f) {
  const id = await requireAdmin(ctx);
  const username = String(f?.username || '').trim(), password = String(f?.password || ''), email = lc(f?.email);
  if (!USER_RE.test(username)) throw bad('Username must be 3–12 characters (letters, numbers, . _ -).');
  if (!PASS_RE.test(password)) throw bad('Password must be letters and numbers only, at least 8 characters.');
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address (used for password reset).');
  const all = users(await readAll(true));
  if (all.some(u => lc(u.username) === lc(username))) throw bad('Username already exists.');
  if (all.some(u => lc(u.email) === email)) throw bad('That email is already used by another admin.');
  await addUser({ username, email, password, resetEnabled: !!f?.resetEnabled, mustChange: false, createdBy: id.name });
  return true;
}
export async function listAdmins(ctx) {
  await requireAdmin(ctx);
  const d = await readAll(true);
  return {
    admins: users(d).map(({ username, email, resetEnabled, mustChange, createdAt, createdBy }) => ({ username, email, resetEnabled, mustChange, createdAt, createdBy })),
    emails: d.AdminEmails.map(e => ({ email: lc(e.email), addedBy: String(e.addedBy || ''), addedAt: String(e.addedAt || '') }))
  };
}
export async function removeAdmin(ctx, username) {
  const id = await requireAdmin(ctx), all = users(await readAll(true)), t = all.find(u => lc(u.username) === lc(username));
  if (!t) throw bad('Admin not found.');
  if (all.length <= 1) throw bad('Cannot remove the last admin account.');
  if (id.via === 'password' && id.user.username === t.username) throw bad('You cannot remove your own account.');
  await remove('Users', t._row);
  return true;
}
export async function addAdminEmail(ctx, email) {
  const id = await requireAdmin(ctx), e = lc(email);
  if (!EMAIL_RE.test(e)) throw bad('Enter a valid email address.');
  if ((await readAll(true)).AdminEmails.some(x => lc(x.email) === e)) throw bad('Email already has admin access.');
  await append('AdminEmails', [{ email: e, addedBy: id.name, addedAt: new Date().toISOString() }]);
  return true;
}
export async function removeAdminEmail(ctx, email) {
  await requireAdmin(ctx);
  const t = (await readAll(true)).AdminEmails.find(x => lc(x.email) === lc(email));
  if (t) await remove('AdminEmails', t._row);
  return !!t;
}
