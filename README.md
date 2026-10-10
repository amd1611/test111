# Account Forge — Sign-up Assistant

A Chrome Extension Manifest V3 starter that generates fresh credentials, fills likely registration fields on the currently active website, and keeps an account list locally in the browser.

## Install

1. Download the repository as a ZIP (Code → Download ZIP) and extract it.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extracted folder containing `manifest.json`.
6. Open a site's sign-up page and click the Account Forge toolbar icon.
7. Optionally enter an email address you control and a name, then click **Create account on this site**.

## Features

- Random username and strong password generation using the browser's cryptographic random generator.
- Best-effort detection and filling of common email, username, name, password, and confirm-password fields.
- Optional one-time submit only when a page looks clearly like a sign-up form and an identifiable submit button exists.
- Local account history with credential-copy buttons, JSON export, status marking, and deletion.
- No external network calls, telemetry, remote scripts, or third-party dependencies.

## Limitations and safety

- No generic browser extension can guarantee account creation on every website. Custom frontends, cross-origin frames, and site-specific signup flows may not be detectable.
- This extension does not create email inboxes or aliases. Use an email address you own.
- CAPTCHA, email/phone verification, one-time codes, and security checks are not bypassed; complete them yourself.
- Some websites prohibit multiple accounts or automated registration. Follow each website's rules and use this for accounts you are permitted to create, one at a time.
- Saved passwords are stored in `chrome.storage.local`, which is local extension storage **but not an encrypted password vault**. Treat exports as sensitive and consider using a dedicated password manager for important credentials.
- The local “complete” status is only a personal note, not proof that the website accepted registration. Confirm success on the actual website.

## Permissions

- `activeTab`: lets the extension work on the active website after you click it.
- `scripting`: injects the form helper after your click.
- `storage`: saves the account list locally.

## Project files

- `manifest.json`: extension metadata and limited permissions.
- `popup.html`: extension interface and styles.
- `popup.js`: credential generator, form workflow, and account list.
- `content.js`: sign-up field detection and fill/submit logic.
