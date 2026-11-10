// Authentication: scrypt password hashes, signed HttpOnly session cookie, rate limiting,
// email password-reset codes, optional "Sign in with Google" for allow-listed admin emails.
import crypto from 'node:crypto';
import { AUTH, env } from './config.mjs';
import { readAll, append, update } from './sheets.mjs';

export const USER_RE = /^[A-Za-z0-9_.-]{3,12}$/;     // registration: 3–12 chars
export const PASS_RE = /^[A-Za-z0-9]{8,}$/;           // alphanumeric, min 8
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const bad = (m, s = 400) => Object.assign(new Error(m), { expose: true, status: s });
const lc = s => String(s || '').trim().toLowerCase();
const b64u = b => Buffer.from(b).toString('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

/* ---- password hashing (scrypt, per-user salt) ---- */
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => e ? no(e) : ok(k.toString('hex'))));
export const newSalt = () => crypto.randomBytes(16).toString('hex');
export const hashPassword = (pw, salt) => scrypt(String(pw), salt);

/* ---- users ---- */
const bool = v => v === true || String(v).toUpperCase() === 'TRUE';
export const users = d => d.Users.map(o => ({
  _row: o._row, username: String(o.username), email: String(o.email || ''), salt: String(o.salt), hash: String(o.hash),
  resetEnabled: bool(o.resetEnabled), mustChange: bool(o.mustChange), createdAt: String(o.createdAt || ''), createdBy: String(o.createdBy || '')
}));
const userRow = u => ({ username: u.username, email: u.email, salt: u.salt, hash: u.hash, resetEnabled: u.resetEnabled, mustChange: u.mustChange, createdAt: u.createdAt, createdBy: u.createdBy });
export const saveUser = u => update('Users', u._row, userRow(u));
export async function addUser(f) {
  const salt = newSalt();
  await append('Users', [{ ...f, salt, hash: await hashPassword(f.password, salt), createdAt: new Date().toISOString() }]);
}
export async function ensureDefaultAdmin(d) {
  if (users(d).length) return;
  const a = AUTH.DEFAULT_ADMIN;
  await addUser({ username: a.username, email: '', password: a.password, resetEnabled: false, mustChange: true, createdBy: 'system' });
}

/* ---- signed session cookie (stateless) ---- */
const mac = b => {
  if (!env('SESSION_SECRET')) throw new Error('SESSION_SECRET is not set');
  return crypto.createHmac('sha256', env('SESSION_SECRET')).update(b).digest('base64url');
};
const sign = p => { const b = b64u(JSON.stringify({ ...p, exp: Date.now() + AUTH.SESSION_SEC * 1000 })); return b + '.' + mac(b); };
function verify(t) {
  if (!t) return null;
  const [b, m] = t.split('.');
  if (!b || !m || !same(mac(b), m)) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const cookie = (v, age) => `bm_session=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const start = (ctx, p) => { ctx.setCookie = cookie(sign(p), AUTH.SESSION_SEC); ctx._id = undefined; };

export async function identity(ctx) {
  if (ctx._id !== undefined) return ctx._id;
  let id = null;
  const p = verify(ctx.cookies.bm_session);
  if (p) {
    const d = await readAll();
    if (p.u) {   // stamp = start of password hash → changing the password / removing the user kills old sessions
      const u = users(d).find(x => x.username === p.u);
      if (u && u.hash.slice(0, 12) === p.s) id = { via: 'password', user: u, name: u.username };
    } else if (p.g && d.AdminEmails.some(e => lc(e.email) === p.g)) id = { via: 'google', name: p.g, email: p.g };
  }
  return ctx._id = id;
}
export async function requireAdmin(ctx) {
  const id = await identity(ctx);
  if (!id) throw bad('Admin login required (your session may have expired).', 401);
  return id;
}
const requirePw = async ctx => {
  const id = await requireAdmin(ctx);
  if (id.via !== 'password') throw bad('Please log in with your admin username and password.', 403);
  return id.user;
};
const me = u => ({ admin: true, via: 'password', name: u.username, email: u.email, resetEnabled: u.resetEnabled, mustChange: u.mustChange });
export async function whoAmI(ctx) {
  const id = await identity(ctx);
  if (!id) return { admin: false };
  return id.via === 'password' ? me(id.user) : { admin: true, via: 'google', name: id.name, email: id.email };
}

/* ---- rate limits & reset codes (Netlify Blobs; in-memory fallback for local dev) ---- */
const mem = new Map();
let blobs;
async function kv() {
  if (blobs === undefined) { try { blobs = (await import('@netlify/blobs')).getStore('bm-security'); } catch { blobs = null; } }
  return blobs;
}
const kk = k => sha(k);
async function kvGet(k) {
  let v; try { const s = await kv(); v = s ? await s.get(kk(k), { type: 'json' }) : mem.get(k); } catch { v = mem.get(k); }
  return v && v.exp > Date.now() ? v : null;
}
async function kvSet(k, v, sec) {
  const rec = { ...v, exp: Date.now() + sec * 1000 };
  try { const s = await kv(); s ? await s.setJSON(kk(k), rec) : mem.set(k, rec); } catch { mem.set(k, rec); }
}
async function kvDel(k) { mem.delete(k); try { const s = await kv(); if (s) await s.delete(kk(k)); } catch {} }

/* ---- public actions ---- */
export async function login(ctx, username, password) {
  const key = 'f:' + lc(username).slice(0, 60), fails = (await kvGet(key))?.n || 0;
  if (fails >= AUTH.MAX_FAILS) throw bad('Too many failed attempts. Try again in 15 minutes.', 429);
  let d = await readAll();
  if (!d.Users.length) { d = await readAll(true); await ensureDefaultAdmin(d); d = await readAll(true); }
  const u = users(d).find(x => lc(x.username) === lc(username));
  const ok = u ? same(await hashPassword(password, u.salt), u.hash) : (await hashPassword(password, '0'.repeat(32)), false);
  if (!ok) { await kvSet(key, { n: fails + 1 }, AUTH.LOCK_SEC); throw bad('Invalid username or password.', 401); }
  await kvDel(key);
  start(ctx, { u: u.username, s: u.hash.slice(0, 12) });
  return { me: me(u) };
}
export async function logout(ctx) { ctx.setCookie = cookie('', 0); return true; }

export async function changePassword(ctx, current, next) {
  const u0 = await requirePw(ctx), key = 'f:' + lc(u0.username);
  const fails = (await kvGet(key))?.n || 0;
  if (fails >= AUTH.MAX_FAILS) throw bad('Too many failed attempts. Try again later.', 429);
  const u = users(await readAll(true)).find(x => x.username === u0.username);
  if (!same(await hashPassword(current, u.salt), u.hash)) { await kvSet(key, { n: fails + 1 }, AUTH.LOCK_SEC); throw bad('Current password is incorrect.'); }
  if (!PASS_RE.test(String(next || ''))) throw bad('New password must be letters and numbers only, at least 8 characters.');
  u.salt = newSalt(); u.hash = await hashPassword(next, u.salt); u.mustChange = false;
  await saveUser(u);
  start(ctx, { u: u.username, s: u.hash.slice(0, 12) });   // old sessions are now invalid
  return { me: me(u) };
}

export async function updateAccount(ctx, f) {
  const u0 = await requirePw(ctx), d = await readAll(true), all = users(d), u = all.find(x => x.username === u0.username);
  const email = lc(f?.email), reset = !!f?.resetEnabled;
  if (email && !EMAIL_RE.test(email)) throw bad('Enter a valid email address.');
  if (reset && !email) throw bad('An email address is required to enable password reset.');
  if (email && all.some(x => x.username !== u.username && lc(x.email) === email)) throw bad('That email is already used by another admin.');
  u.email = email; u.resetEnabled = reset;
  await saveUser(u);
  return me(u);
}

async function sendMail(to, subject, text) {
  if (!env('RESEND_API_KEY') || !env('MAIL_FROM')) { console.error('Email not configured (RESEND_API_KEY / MAIL_FROM).'); return; }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('MAIL_FROM'), to: [to], subject, text })
  });
  if (!r.ok) console.error('Email failed', r.status);
}

export async function requestReset(ctx, identifier) {
  const generic = { ok: true, message: 'If that account exists and email reset is enabled, a code has been emailed (valid 15 minutes).' };
  const id = lc(identifier), u = users(await readAll()).find(x => lc(x.username) === id || (x.email && lc(x.email) === id));
  if (!u || !u.resetEnabled || !u.email) return generic;
  const k = lc(u.username);
  if (await kvGet('rq:' + k)) return generic;                         // 1 request / minute
  await kvSet('rq:' + k, { n: 1 }, 60);
  const code = crypto.randomBytes(4).toString('hex').toUpperCase();
  await kvSet('r:' + k, { h: sha(code + u.salt), tries: 0 }, AUTH.RESET_SEC);
  await sendMail(u.email, 'Budget Monitor – password reset code',
    `Hello ${u.username},\n\nYour password reset code is: ${code}\n\nIt expires in 15 minutes. If you did not request this, ignore this email.`);
  return generic;
}

export async function confirmReset(ctx, identifier, code, newPw) {
  const err = bad('Invalid or expired code.'), id = lc(identifier);
  const u = users(await readAll(true)).find(x => lc(x.username) === id || (x.email && lc(x.email) === id));
  if (!u) throw err;
  const k = 'r:' + lc(u.username), e = await kvGet(k);
  if (!e) throw err;
  if (e.tries >= 5) { await kvDel(k); throw err; }
  if (!same(sha(String(code || '').trim().toUpperCase() + u.salt), e.h)) { await kvSet(k, { ...e, tries: e.tries + 1 }, AUTH.RESET_SEC); throw err; }
  if (!PASS_RE.test(String(newPw || ''))) throw bad('New password must be letters and numbers only, at least 8 characters.');
  await kvDel(k); await kvDel('f:' + lc(u.username));
  u.salt = newSalt(); u.hash = await hashPassword(newPw, u.salt); u.mustChange = false;
  await saveUser(u);
  return true;
}

/** Optional: admins whose Google email is in the AdminEmails tab sign in with Google (no password). */
export async function googleLogin(ctx, credential) {
  if (!env('GOOGLE_CLIENT_ID')) throw bad('Google sign-in is not configured.', 400);
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential || ''));
  const t = await r.json().catch(() => ({}));
  if (!r.ok || t.aud !== env('GOOGLE_CLIENT_ID') || String(t.email_verified) !== 'true') throw bad('Google sign-in failed.', 401);
  const email = lc(t.email), d = await readAll(true);
  if (!d.AdminEmails.some(e => lc(e.email) === email)) throw bad('This Google account is not authorized as admin.', 403);
  start(ctx, { g: email });
  return { me: { admin: true, via: 'google', name: email, email } };
}
