# Account Forge — Sign-up Assistant

Chrome Extension Manifest V3 starter that generates credentials, fills common registration fields, creates a temporary email inbox, and can show filtered SMS messages from a private SMS bridge.

## Features
- Generates a fresh username and strong password.
- **Fill page only** fills recognizable fields with profile details, email, username and password without submitting.
- Existing registration flow can optionally submit a clearly detected sign-up form when no visible security challenge is found.
- Reuses details you manually entered for full name, age, first/last name, date of birth, phone and country/region.
- Leaves terms/consent checkboxes, CAPTCHA and verification steps for you to review.
- Creates temporary Mail.tm inboxes and reads incoming email in the extension.
- SMS inbox shows only messages received in the last five minutes that contain a likely 4–8 digit code and mention a word related to the active website. The SMS code can be copied manually; it is not injected into the verification form and the extension does not submit the page.
- Stores account records locally and supports JSON export.

## Install
1. Download the repository as a ZIP and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the folder with `manifest.json`.
3. Enter profile details and use **Fill page only — don't submit** on a sign-up page. Review and continue manually.

## SMS inbox setup (requires a private bridge)
Chrome cannot directly read SMS from a phone's SIM. The project includes `sms-bridge/`, a Node.js server that supports:
- A signature-validated incoming-message webhook for a Twilio-controlled number.
- An authenticated `POST /api/forward` endpoint for a trusted phone-side SMS-forwarder/automation on a phone you own.

The bridge keeps only messages with a plausible 4–8 digit code in memory, and prunes messages after five minutes. It does not log message bodies. The extension then filters these messages against the active tab's hostname/title. Matching is heuristic, so it can miss messages whose sender/text does not contain the website name.

### Configure it
1. Follow [sms-bridge/README.md](sms-bridge/README.md) to run or deploy the bridge.
2. Set long random `SMS_READ_TOKEN` and `SMS_INGEST_TOKEN` environment secrets. Never commit a real `.env`.
3. Enter the bridge URL and `SMS_READ_TOKEN` in Account Forge under **Connect your SMS bridge**, then click **Save and connect** and grant Chrome permission for that origin.
4. For a regular SIM, configure a reputable phone-side forwarding app/automation to POST your own received messages to `/api/forward` with `Authorization: Bearer <SMS_INGEST_TOKEN>`. For a Twilio number, configure its incoming SMS webhook to `/webhook/sms`.

The extension reads `GET /api/messages` with `Authorization: Bearer <SMS_READ_TOKEN>`. The read token is stored in Chrome local extension storage, which is not encrypted. Use HTTPS except for localhost testing, and only connect to a bridge you control.

Twilio documentation: https://www.twilio.com/docs/usage/webhooks/messaging-webhooks

## Email limitations
- Temporary email uses the public Mail.tm API. Mail.tm receives the address and incoming messages.
- Temporary addresses may expire and are unsuitable for important recovery-dependent accounts.
- Some services reject disposable-email domains. Use an email address or alias the service accepts rather than attempting to evade restrictions.

## Privacy and limits
- No analytics or tracking is included.
- Profile details, credentials, mailbox access and bridge token are stored in Chrome local extension storage; this is not an encrypted password vault.
- SMS is held in server memory for at most five minutes; a bridge restart clears it. The bridge does not keep a long-term SMS archive.
- Use only a number and messages you control. This does not create or rent phone numbers, bypass verification policies, or auto-submit verification steps.
- Form detection is best effort and cannot cover every site's custom controls or multi-step flows.

## Permissions
- `activeTab`, `scripting`, and `storage`.
- `https://api.mail.tm/*` for temporary email.
- Optional permission for the specific SMS bridge origin you enter. Chrome requests permission when you connect it.

## Files
- `manifest.json` — extension metadata/permissions.
- `popup.html`, `popup.css`, `popup.js` — UI, profile, mailbox and SMS filtering.
- `content.js` — registration form detection and fill-only autofill.
- `sms-bridge/` — private Node.js SMS receiver.
