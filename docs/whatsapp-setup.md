# WhatsApp Bridge Setup (Meta WhatsApp Business Cloud API)

Chat with `warden` from WhatsApp and get reminders there. Uses the official Cloud API, not whatsapp-web.js.

## 1. Create the Meta app

1. Open https://developers.facebook.com/apps and click **Create app**.
2. Pick use case **Other**, then app type **Business**. Link (or create) a Business portfolio.
3. In the app dashboard, find **WhatsApp** and click **Set up**.

## 2. Test number and recipient

1. Go to **WhatsApp > API Setup**.
2. Meta gives you a free **test phone number**. Copy its **Phone number ID** (not the phone number itself).
3. Under **To**, click **Manage phone number list** and add your own WhatsApp number. Enter the code WhatsApp sends you.
4. Send the sample `hello_world` template from that page to confirm delivery.

## 3. Access token

- **Quick start:** copy the **Temporary access token** from API Setup. It expires after about 24 hours.
- **Permanent:** go to https://business.facebook.com/settings/system-users and do the following:
  1. Add a **System User** with the **Admin** role.
  2. Click **Assign assets**, select your app, and grant **Full control**.
  3. Click **Generate new token**, select the app, set expiry to **Never**, and tick `whatsapp_business_messaging` and `whatsapp_business_management`.
  4. Copy the token. Meta shows it only once.

## 4. App secret

Go to **App settings > Basic** and copy the **App secret**. The bridge uses it to verify webhook signatures.

## 5. Environment variables

Add these to `.env` at the Commando root:

```bash
WHATSAPP_API_TOKEN=EAAG...                 # temp or System User token
WHATSAPP_PHONE_NUMBER_ID=123456789012345   # from API Setup
WHATSAPP_CEO_NUMBER=919812345678           # your number, digits only, country code first; comma-separate extras
WHATSAPP_VERIFY_TOKEN=pick-any-long-random-string
WHATSAPP_APP_SECRET=abc123...              # App settings > Basic
WHATSAPP_GRAPH_VERSION=v26.0               # optional
WHATSAPP_REMINDER_TEMPLATE=commando_reminder   # optional, see section 9
WHATSAPP_TEMPLATE_LANG=en_US               # optional
WHATSAPP_OTP_TEMPLATE=warden_login       # optional, fallback sign-in codes, see section 11
WHATSAPP_BUSINESS_NUMBER=15551234567      # number users message to sign in, see section 10
WARDEN_APP_URL=http://localhost:5173      # optional, link in bot replies
WHATSAPP_OTP_TEMPLATE_LANG=en_US           # optional, defaults to WHATSAPP_TEMPLATE_LANG
WHATSAPP_LOGIN_NUMBERS=                    # optional allowlist; empty = any number can sign up
```

Generate a verify token with `openssl rand -hex 24`. Restart the orchestrator after editing `.env`.

## 6. Expose port 4000

```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:4000
```

Copy the `https://<random>.trycloudflare.com` URL it prints. The ngrok alternative is `ngrok http 4000`.
Quick tunnels change URL on every restart. Update the webhook URL in Meta each time.

## 7. Configure the webhook

1. Go to **WhatsApp > Configuration > Webhook** and click **Edit**.
2. Set **Callback URL** to `https://<tunnel>/webhook/whatsapp`.
3. Set **Verify token** to the exact value of `WHATSAPP_VERIFY_TOKEN`.
4. Click **Verify and save**. The orchestrator log shows `[WHATSAPP] webhook verified by Meta`.
5. Under **Webhook fields**, click **Subscribe** next to `messages`.

Check verification locally:

```bash
curl "http://localhost:4000/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=$WHATSAPP_VERIFY_TOKEN&hub.challenge=ok"
# prints: ok
```

## 8. Test

1. From your phone, send `hi warden` to the test number.
2. The message gets blue ticks. If warden takes more than 5 seconds, you get an "On it" reply first, then the real answer.
3. Messages from numbers outside `WHATSAPP_CEO_NUMBER` are ignored.

## 9. The 24-hour window and reminder templates

- WhatsApp delivers free-form text only within 24 hours of your last message to the business number.
- Outside that window, Graph returns error `131047`. The bridge logs it and reports `outsideWindow: true`.
- Fix for reminders: send any message to the number each day, or use an approved template.

Create a reminder template:

1. Go to **WhatsApp Manager > Message templates** (https://business.facebook.com/wa/manage/message-templates) and click **Create template**.
2. Pick category **Utility**, name `commando_reminder`, and language **English (US)**.
3. Set the body to `Commando reminder: {{1}}` and give a sample value.
4. Submit the template. Approval usually takes minutes.
5. Set `WHATSAPP_REMINDER_TEMPLATE=commando_reminder` and `WHATSAPP_TEMPLATE_LANG=en_US`.

When free-form text fails with `131047`, the bridge resends it through this template, with the text (up to 1000 characters, on one line) as `{{1}}`.

## 10. Sign in with WhatsApp (click-to-chat QR)

The login page shows a QR code. On a phone it shows an **Open WhatsApp** button instead. Both open a chat with the business number, with a message like `Sign me in to Warden: LOGIN-7F3K9Q` already typed.

1. The user taps **Send**.
2. The webhook receives the message. WhatsApp itself proves the sender's number, so the server signs in that number and creates the user on first use.
3. The login page polls `/api/auth/wa/status` and picks up the JWT. It then opens the right screen for the user.
4. The bot replies in the chat, based on the user's stage: welcome for a new user, "you stopped at 1B" for one mid-onboarding, "your command center is open" for one who finished.

Why this is the default:

- The user messages first, so the reply falls inside the 24-hour service window. It needs no template and no approval, and service replies are free.
- No code goes over WhatsApp from us, so the template and 24h problems of section 11 do not apply.

Requirements:

- `WHATSAPP_BUSINESS_NUMBER`: the number users message, digits with country code. When it is empty, the server looks it up from `WHATSAPP_PHONE_NUMBER_ID` with a valid token.
- The webhook must be reachable (steps 6 and 7) and subscribed to `messages`.
- Optional `WARDEN_APP_URL`: a link to the login page, added to bot replies.
- The free test number can reply only to the recipients verified under **API Setup > To**. Test with those numbers, or register a real number to let anyone sign in.

Other messages:

- Anyone who texts the number without a code gets a short reply. It tells them how to sign in, and shows their stage if they already have an account.
- The CEO's messages (`WHATSAPP_CEO_NUMBER`) still go to the agents as before. Only messages with a `LOGIN-` code are treated as sign-ins.

Limits:

- A QR code is valid for 10 minutes and signs in one browser once. The page offers a new code when it expires.
- One IP address can start at most 30 sign-ins per hour.
- The browser keeps a secret request id. The short code alone cannot retrieve the token.

Endpoints:

- `POST /api/auth/wa/start` returns `{ id, code, message, wa_link, business_number, expires_at }`. Public.
- `GET /api/auth/wa/status?id=` returns `PENDING`, then `VERIFIED` with `{ token, is_new_user, user }` once, else HTTP 410 `EXPIRED`. Public.

## 11. Fallback: 6-digit codes, sessions and testing

Below the QR code, **Can't scan? Get a 6-digit code instead** opens the code form. We then message the user first, so the code needs the authentication template below to reach new numbers.

Both sign-in methods return the same JWT. The app sends it as `Authorization: Bearer <jwt>` on every `/api` call.

Endpoints:

- `GET /api/auth/otp/status` returns `{ whatsapp, dev }`. Public.
- `POST /api/auth/otp/request` with `{ "phone": "+91 98123 45678" }` sends a code. Public.
- `POST /api/auth/otp/verify` with `{ "phone", "code" }` returns `{ token, expires_at, is_new_user, user }`. Public.
- `GET /api/auth/me` returns the user and onboarding state. Needs the Bearer token.
- `PATCH /api/auth/me/onboarding` with `{ "step": "1b" }` or `{ "status": "COMPLETE" }` saves progress. Needs the token.
- `POST /api/auth/refresh` returns a fresh token. Needs the token.
- `POST /api/auth/logout` revokes every token of that user and closes their WebSockets. Needs the token.

Limits:

- A code expires after 5 minutes and works once.
- A number can request a new code every 30 seconds, and at most 5 codes per hour.
- One IP address can make at most 20 code requests per hour.
- After 5 wrong attempts the code is void. Request a new code.

### Create the authentication template

Without a template, the bridge sends the code as free-form text. That text arrives only if the number messaged the business number in the last 24 hours. Otherwise the request fails with HTTP 502 and a message about the 24-hour window.

To reach a number at any time, create an authentication template:

1. Go to **WhatsApp Manager > Message templates** and click **Create template**.
2. Pick category **Authentication**, name `warden_login`, and language **English (US)**.
3. Under code delivery, pick **Copy code**. Meta writes the body text for you.
4. Optional: tick the security disclaimer and set the expiry to 5 minutes.
5. Submit the template. Approval usually takes minutes.
6. Set `WHATSAPP_OTP_TEMPLATE=warden_login` and restart the orchestrator.

The bridge fills the code into the body and into the copy-code button.

### Who can sign in

- By default any number can request a code and sign up.
- To restrict sign-in, set `WHATSAPP_LOGIN_NUMBERS` to a comma-separated list. Other numbers then get HTTP 403, and no message is sent.
- Each authentication message costs money. The per-number and per-IP limits above cap abuse, but watch your WhatsApp billing on a public deployment.

Meta also limits who can receive messages:

- The free **test number** delivers only to the recipients you verified under **WhatsApp > API Setup > To** (up to 5). Other numbers fail with HTTP 502. Add a real business number to reach anyone.
- Without `WHATSAPP_OTP_TEMPLATE`, the code is free-form text. It reaches only numbers that messaged the business number in the last 24 hours.

### Sessions and the auth gate

- The JWT is HS256 with claims `sub` (user id), `phone`, `ver`, `iat` and `exp`. It lives 30 days (`AUTH_JWT_TTL_DAYS`).
- The signing secret is `AUTH_JWT_SECRET`. When it is empty, the server generates one into `.state/auth-secret`.
- Users and their onboarding state persist in `.state/users.json`. Both files are gitignored and mode 600.
- Every `/api` route needs the Bearer token, except `/api/auth/otp/*` and `/api/health`. Without it the server returns 401.
- Signed out, `/api/health` only returns `{ ok, timestamp }`.
- `/media/*` and the `/ws` WebSocket also accept the token as `?token=` or the HttpOnly `warden_session` cookie. Browsers cannot set headers on images or sockets.
- `/api` routes never accept the cookie. This blocks cross-site request forgery.
- Pending codes and rate limits live in memory. A restart cancels unused codes, but tokens stay valid.
- The web app stores the token in `localStorage` under `warden.auth.token`. On any 401 it returns to the sign-in screen.

### Which screen a user sees

- **First-time user:** onboarding status `NOT_STARTED`. After the code, the user lands on F1 (track selection). If they picked ".md Import" on the landing page, they land on the import track.
- **Return user, mid-onboarding:** status `IN_PROGRESS`. Every step change is saved. Sign-in, or a reload with a valid token, resumes at the saved step.
- **Return user, complete:** status `COMPLETE`. Sign-in, or a reload with a valid token, opens the dashboard directly.

### Test without sending messages

Set `AUTH_DEV_OTP=246810` (any 6 digits) in `.env` and restart the orchestrator. Codes are then not sent, and that fixed code signs in any allowed number. The server ignores `AUTH_DEV_OTP` when `NODE_ENV=production`. Remove it before you expose the server: the orchestrator listens on all interfaces, so anyone on your network could sign in with the fixed code.

To start over as a first-time user, delete that number from `.state/users.json` and restart the orchestrator.

### UI screens without signing in

Run `npm run dev:ui` and open `http://localhost:5174`. This dev-only screen browser shows every onboarding screen with step pills, the persona simulator and the Demo/Product toggle. Its Dashboard button shows the dashboard on seed data. It is not part of the production build.

## Going beyond the test number

- The test number can message only up to 5 verified recipients.
- To use a real number, add it under **WhatsApp > API Setup > Add phone number** and complete business verification.
