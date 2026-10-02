# Billing desk

One dashboard for usage, cost, remaining balance and renewal dates of OpenAI, Mistral,
AssemblyAI, Recall.ai, Ollama Cloud and MailBaby. Node.js + Express, React (Vite), MySQL.

## Run it

```bash
npm install        # also installs the client
npm run dev        # API on :4600, UI on http://localhost:5173
```

Production (one process serves the API and the built UI):

```bash
npm run build
npm start          # http://localhost:4600
```

Sign in with `DASHBOARD_PASSWORD` from `.env`. Tables are created on first start.

## Settings (`.env`)

Copy `.env.example` to `.env`. Keys can be added one at a time; a service without a key
still tracks balance and renewal from what you enter. Restart the server after editing.

| Variable | What it is |
|---|---|
| `OPENAI_ADMIN_KEY` | Admin key (`sk-admin-…`), not a normal API key |
| `MISTRAL_ADMIN_KEY` | Admin API key from backoffice.mistral.ai (needs Backoffice access; a normal key is refused) |
| `MISTRAL_SESSION_COOKIE` | Alternative to the admin key: the `ory_session_…` cookie (`name=value`, in single quotes) from a signed-in admin.mistral.ai tab. Gives wallet balance and usage. Unofficial, and it expires: the card says so when a fresh one is needed |
| `MISTRAL_EMAIL`, `MISTRAL_PASSWORD` | Optional, for email + password accounts: the dashboard signs in again by itself when the session expires, and the card's "Refresh login" button does it on demand. Does not work with Google sign-in, one-time codes, a second factor or a captcha |
| `ASSEMBLYAI_API_KEY` | Normal API key |
| `RECALL_API_KEY`, `RECALL_REGION` | API key and workspace region |
| `OLLAMA_API_KEY` | Ollama Cloud key |
| `MAILBABY_API_KEY` | Mail.Baby API key |
| `DB_SSL_CA` | Path to the database CA certificate, to verify the server's certificate. `certs/db-router-ca.pem` is the MySQL Router CA for db.artlabss.com; it expires on 30 Jul 2027 and must be replaced with the new `ca.pem` from `/opt/mysqlrouter/data/` if the Router is re-bootstrapped |
| `SYNC_INTERVAL_MINUTES` | How often every service is synced (default 60) |
| `COOKIE_SECURE=1`, `TRUST_PROXY=1` | Set both when running behind an https reverse proxy |

## What comes from where

| Service | Read from the API | You enter |
|---|---|---|
| OpenAI | Daily cost, tokens and requests per model | Balance, top-ups |
| Mistral | With a login session: wallet balance, pending usage, usage per model. With an admin key: month-to-date cost per category | Nothing with a session; balance and top-ups with an admin key |
| AssemblyAI | Audio hours per day (from the transcript list) | Price per hour, balance, top-ups |
| Recall.ai | Bot hours per day | Price per hour, balance, top-ups |
| Ollama Cloud | Share of the plan's usage window used | Plan price, renewal date |
| MailBaby | Emails and estimated cost this billing cycle | Renewal date |

None of these services expose a balance or renewal date over their API (Mistral's balance is read from its admin panel, not an API). Balance is worked
out as: the balance you entered, plus later top-ups, minus the cost recorded since.
Enter a new "Balance right now" at any time to re-anchor it.

Known limits:

- AssemblyAI streaming sessions are not in the transcript list, so they are not counted.
- AssemblyAI and Recall.ai cost is hours × the price you set; match it to your plan.
- Recall.ai allows 5 usage requests a minute, so the first 30 days fill in over a few hours.
- The Mistral and Ollama response formats are not fully documented; the raw answer of the
  last sync is kept in `provider_state` (`last_raw`) if a figure looks wrong.

## Tests

```bash
npm test
```

## Deploying

Run `npm run build && npm start` under a process manager (pm2, systemd) and put it behind
an https reverse proxy. The login cookie lasts 14 days; six wrong passwords lock that IP
out for 15 minutes.
