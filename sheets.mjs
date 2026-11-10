// Minimal Google Sheets v4 client: zero dependencies (Node crypto + fetch) → fastest cold starts.
// Latency tactics: one batchGet reads every tab, access token + sheet ids are cached,
// RAW writes keep text such as "01101101" intact, and reads are cached briefly in memory.
import crypto from 'node:crypto';
import { SHEETS, CACHE_MS, env } from './config.mjs';

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';
let tok = { v: null, exp: 0 }, ids = null, snap = null;
const b64u = b => Buffer.from(b).toString('base64url');
const colL = n => String.fromCharCode(64 + n);
const enc = encodeURIComponent;

async function accessToken() {
  if (tok.v && Date.now() < tok.exp - 60000) return tok.v;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'), scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(env('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n'));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + b64u(sig) })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Google auth failed: ' + (j.error_description || j.error));
  tok = { v: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tok.v;
}

async function g(path, opt = {}) {
  const r = await fetch(API + env('SHEET_ID') + path, {
    ...opt, headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Sheets API: ' + (j.error?.message || r.status));
  return j;
}
const post = (path, body) => g(path, { method: 'POST', body: JSON.stringify(body) });

async function ensureTabs() {
  if (ids) return;
  const m = await g('?fields=sheets.properties(sheetId,title)');
  ids = Object.fromEntries(m.sheets.map(s => [s.properties.title, s.properties.sheetId]));
  const missing = Object.keys(SHEETS).filter(n => !(n in ids));
  if (missing.length) {
    const r = await post(':batchUpdate', { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) });
    r.replies.forEach((x, i) => ids[missing[i]] = x.addSheet.properties.sheetId);
  }
}

/** Reads ALL tabs in one API call → { Records:[{_row,...}], Funds:[...], ... } */
export async function readAll(fresh = false) {
  if (!fresh && snap && Date.now() - snap.t < CACHE_MS) return snap.d;
  await ensureTabs();
  const names = Object.keys(SHEETS);
  const q = names.map(n => 'ranges=' + enc(`${n}!A1:${colL(SHEETS[n].cols.length)}`)).join('&');
  const j = await g(`/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`);
  const d = {}, fix = [];
  j.valueRanges.forEach((vr, i) => {
    const n = names[i], cols = SHEETS[n].cols, rows = vr.values || [];
    if (JSON.stringify((rows[0] || []).slice(0, cols.length)) !== JSON.stringify(cols)) fix.push(n);
    d[n] = rows.slice(1)
      .map((r, k) => ({ _row: k + 2, ...Object.fromEntries(cols.map((c, x) => [c, r[x] ?? ''])) }))
      .filter(o => o[cols[0]] !== '');
  });
  if (fix.length) await post('/values:batchUpdate', {
    valueInputOption: 'RAW',
    data: fix.map(n => ({ range: `${n}!A1:${colL(SHEETS[n].cols.length)}1`, values: [SHEETS[n].cols] }))
  });
  snap = { t: Date.now(), d };
  return d;
}

export const invalidate = () => { snap = null; };
const rowVals = (n, o) => SHEETS[n].cols.map(c => o[c] ?? '');

export async function append(name, objs) {
  if (!objs.length) return;
  await ensureTabs();
  await post(`/values/${enc(name + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: objs.map(o => rowVals(name, o)) });
  invalidate();
}
export async function update(name, row, obj) {
  await g(`/values/${enc(`${name}!A${row}:${colL(SHEETS[name].cols.length)}${row}`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [rowVals(name, obj)] }) });
  invalidate();
}
export async function remove(name, row) {
  await ensureTabs();
  await post(':batchUpdate', { requests: [{ deleteDimension: { range: { sheetId: ids[name], dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] });
  invalidate();
}
export async function clear(name) {
  await post(`/values/${enc(`${name}!A2:${colL(SHEETS[name].cols.length)}`)}:clear`, {});
  invalidate();
}
