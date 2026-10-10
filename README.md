# Account Forge — Sign-up Assistant

Chrome Extension Manifest V3 project that generates credentials, fills common registration fields, and can create and read a temporary Mail.tm inbox inside the extension.

## Install
1. Download this repository as a ZIP and extract it.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose the folder containing `manifest.json`.
5. Open a registration page and click the Account Forge toolbar icon.
6. Click **Create temporary inbox** to generate an address. It is inserted into the email field in the extension; then click **Create account on this site** to fill the page.
7. Reopen the extension and use **Refresh inbox** to check for incoming mail. Click **Read email** to view a message; the extension may show a button to copy a likely verification code.

## Features
- Browser-cryptographic random usernames and strong passwords.
- Best-effort detection and filling of email, username, full name, first/last name, age, date of birth, phone, country/region, password, and confirmation fields, using only profile values you manually enter.
- Reusable sign-up profile fields are saved locally in the extension so you can use them on later forms without retyping.
- Optional one-time submit only on a clearly detected registration form and when no visible security challenge is found.
- Temporary inbox creation, message reading, manual refresh, and copyable likely verification codes via the official Mail.tm API.
- Local account history, copy controls, JSON export and deletion.
- Sign-up drafts keep the same generated credentials between multi-step form screens.

## Temporary email and limitations
- The temporary mailbox feature uses `https://api.mail.tm`. Mail.tm receives the mailbox address and incoming emails. The extension stores the mailbox password/token and saved website credentials in Chrome's local extension storage so you can reopen the inbox.
- Temporary inboxes are not durable recovery addresses. Messages/accounts may expire or become unavailable; do not use these for important personal, work, financial, purchase, or recovery-dependent accounts.
- Some services reject disposable email domains. Canva may reject Mail.tm addresses. If it does, use an email address or alias you control that the service permits. The extension does not bypass such restrictions.
- Use this for occasional, user-initiated account creation you are permitted to perform, not bulk account creation. Follow each website's rules.
- CAPTCHA, email/phone checks, terms and consent checkboxes, and other security measures are not bypassed or automatically accepted. Review those steps yourself.
- Name, age, birthday, phone, and country/region details you enter are stored in Chrome local extension storage for reuse. This storage is not encrypted; avoid entering details you do not want saved in this browser profile.
- Form detection is best-effort and won't work on every website or every multi-step/cross-origin form.

## Privacy and security
- No analytics or tracking is included. Mail.tm API calls happen only when creating a mailbox, refreshing the inbox, or opening a message.
- `chrome.storage.local` is not an encrypted password vault. Anyone with access to the browser profile or a malicious extension may be able to read stored credentials and inbox access data. Avoid sensitive accounts and do not export secrets to shared locations.
- Email messages may contain phishing attempts. Review senders and URLs carefully before acting on messages. Message bodies are displayed as text rather than executed as HTML.

## Permissions
- `activeTab`: interact with the active page after your click.
- `scripting`: inject the registration helper after your click.
- `storage`: save account records, drafts, and inbox access data locally.
- `host_permissions` for `https://api.mail.tm/*`: create temporary inboxes and retrieve messages.

## Files
- `manifest.json`: extension metadata and permissions.
- `popup.html`: UI.
- `popup.js`: credentials, account history, temporary mailbox API and inbox view.
- `content.js`: registration form detection and fill/optional submit logic.
