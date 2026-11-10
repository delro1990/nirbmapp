# Budget Monitor – Netlify edition

Static frontend on Netlify's CDN + one serverless function (`/api/*`, Node.js 20) that uses a **Google Sheet as the database**.

```
public/                     index.html · styles.css · app.js      (static, served from the CDN)
netlify/functions/api.mjs   router for POST /api/<action>
netlify/functions/lib/      config · sheets (Google API client) · auth · services · seed
netlify.toml · package.json · .env.example
```

## 1. Google Sheet (the database)
1. Create a Google Sheet named **Budget Monitor Data** and copy its ID from the URL:
   `https://docs.google.com/spreadsheets/d/1-GCNNejSh5-yk9S7UtME1veHJ6HKN5v9D9Yx99m_vAU/edit`
2. Leave it empty. The app creates these tabs and row-1 headers itself:
   - `Records`: id | fund | uacs | desc | cls | pap | office | allot | oblig | disb | date
   - `Funds`: code | name
   - `Users`: username | email | salt | hash | resetEnabled | mustChange | createdAt | createdBy
   - `AdminEmails`: email | addedBy | addedAt
   - `Settings`: key | value

## 2. Service account (lets the function edit the Sheet)
1. [Google Cloud Console](https://console.cloud.google.com) → create/select a project → **APIs & Services → Library → Google Sheets API → Enable**.
2. **IAM & Admin → Service Accounts → Create** (any name) → open it → **Keys → Add key → JSON**. A file downloads.
3. From that JSON you need `client_email` and `private_key`.
4. In the Google Sheet click **Share** and add the `client_email` as **Editor**. Share the Sheet with nobody else except your admins.

## 3. Deploy
**Option A – GitHub (recommended):** push this folder to a GitHub repo → Netlify → *Add new site → Import from Git* → pick the repo. Build settings are read from `netlify.toml` (no build command; publish dir `public`).

**Option B – CLI:** `npm i -g netlify-cli && npm install && netlify deploy --prod`

## 4. Environment variables (Netlify → Site configuration → Environment variables)
| Name | Value |
|---|---|
| `SHEET_ID` | the Sheet ID from step 1 |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON key (whole value, including BEGIN/END lines) |
| `SESSION_SECRET` | random string: `openssl rand -hex 32` |
| `RESEND_API_KEY`, `MAIL_FROM` | *(optional)* for password-reset emails – free account at resend.com |
| `GOOGLE_CLIENT_ID` | *(optional)* enables "Sign in with Google" for admins listed under Admin → Google email |

Redeploy after adding variables (Deploys → Trigger deploy).

## 5. First run
1. Open the site → the first load creates the tabs and sample data.
2. **Admin login** → `Administrator` / `admin123` → open the **Admin** tab and **change the password immediately**.
3. Add your email, switch on password reset, register other admins, replace the sample funds/records with real ones.

### Optional: "Sign in with Google" for admin emails
Google Cloud Console → APIs & Services → Credentials → **Create OAuth client ID → Web application**; add your Netlify URL under *Authorized JavaScript origins*; put the client ID in `GOOGLE_CLIENT_ID`.

## Roles & security
- **View only:** anyone who can open the site. **Admin:** logs in (HttpOnly, SameSite=Strict cookie, 6 h) or signs in with an allow-listed Google email. Every write is re-checked on the server.
- Passwords: scrypt + per-user salt. 5 failed logins → 15-minute lock. Reset codes expire in 15 minutes.
- Default admin `Administrator` is 13 characters, so it is seeded directly; registration enforces 3–12 characters. Recovery: empty the `Users` tab (keep row 1) and log in again with the default.
- **The site is public by default.** If the dashboard itself must be private, enable Netlify password protection (paid plans) or put the site behind Cloudflare Access / Netlify Identity.
- Never commit `.env`; keep the service-account key only in Netlify's environment variables.

## Performance notes
- Static files come from Netlify's CDN; the function has **no npm dependencies** other than `@netlify/blobs` (lazy-loaded), so cold starts are small.
- One `batchGet` reads all tabs; the Google access token is reused; reads are cached 15 s per warm instance; the UI updates optimistically.
- Functions run in a US region by default, so each uncached Sheets round trip from the Philippines is roughly 200–400 ms. If that matters, ask Netlify support/plan about a closer function region.
- Google Sheets API limit: ~300 read requests/minute/project, which is ample for a team using the 15-second cache.
- Two admins editing the same row at the same instant: last write wins.
