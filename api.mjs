// Single serverless endpoint:  POST /api/<action>  with a JSON array of arguments.
// Auth is an HttpOnly session cookie; every admin action is re-checked on the server.
import * as S from './lib/services.mjs';
import * as A from './lib/auth.mjs';
import { env } from './lib/config.mjs';

const actions = {
  getData: S.getData,
  login: A.login, logout: A.logout, googleLogin: A.googleLogin,
  requestReset: A.requestReset, confirmReset: A.confirmReset,
  changePassword: A.changePassword, updateAccount: A.updateAccount,
  upsertRecord: S.upsertRecord, deleteRecord: S.deleteRecord,
  addFund: S.addFund, deleteFund: S.deleteFund, setTarget: S.setTarget, resetSample: S.resetSample,
  registerAdmin: S.registerAdmin, listAdmins: S.listAdmins, removeAdmin: S.removeAdmin,
  addAdminEmail: S.addAdminEmail, removeAdminEmail: S.removeAdminEmail
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

const parseCookies = h => Object.fromEntries((h || '').split(';').map(c => c.trim().split(/=(.*)/s).slice(0, 2)).filter(p => p[0]));

export default async (req) => {
  const action = new URL(req.url).pathname.replace(/^\/api\//, '');
  if (action === 'config' && req.method === 'GET') return json({ googleClientId: env('GOOGLE_CLIENT_ID') });
  if (req.method !== 'POST' || req.headers.get('x-requested-with') !== 'bm') return json({ ok: false, error: 'Bad request' }, 400);   // CSRF guard
  const fn = actions[action];
  if (!fn) return json({ ok: false, error: 'Unknown action' }, 404);
  const ctx = { cookies: parseCookies(req.headers.get('cookie')), setCookie: null };
  try {
    const args = await req.json().catch(() => []);
    const data = await fn(ctx, ...(Array.isArray(args) ? args : []));
    return json({ ok: true, data }, 200, ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {});
  } catch (e) {
    if (!e.expose) console.error(action, e);
    return json({ ok: false, error: e.expose ? e.message : 'Server error. Please try again.' }, e.expose ? e.status || 400 : 500,
      ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {});
  }
};

export const config = { path: '/api/*' };
