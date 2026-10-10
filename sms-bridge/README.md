# Account Forge private SMS bridge

This Node.js service connects Account Forge to SMS messages from a number you control. It is separate from the Chrome extension because Chrome cannot directly read normal SMS delivered to a phone SIM.

## Run / deploy

1. Use Node.js 20 or newer.
2. Copy `.env.example` to `.env`. Set strong random values for `SMS_READ_TOKEN` and `SMS_INGEST_TOKEN`. Never commit real secrets.
3. Run `npm install` and `npm start`.
4. Use HTTPS when connecting from another device or the internet. HTTP is suitable only for localhost testing.

The extension uses `GET /api/messages` with `Authorization: Bearer <SMS_READ_TOKEN>`. It displays only code-bearing messages received in the previous five minutes whose sender or body includes a keyword matching the active website. Matching is heuristic and may miss some messages.

## Forward SMS from a normal phone SIM

Configure a trusted phone-side forwarding app or automation on a phone you own to send only the messages you want to process:

- Method: `POST`
- URL: `https://YOUR-BRIDGE/api/forward`
- Headers: `Authorization: Bearer <SMS_INGEST_TOKEN>` and `Content-Type: application/json`
- JSON body: `{"from":"OpenAI","to":"+357...","body":"Your OpenAI code is 123456","receivedAt":"2026-10-10T12:34:56.000Z"}`

Use the timestamp at which the SMS actually arrived so the five-minute retention rule works correctly. The server stores only messages with a plausible 4–8 digit code, keeps them in memory, and removes them after five minutes. It does not log message bodies. Forwarding codes to any server carries risk: deploy only to a server you control, use HTTPS and long random tokens, and do not forward other people's messages.

## Twilio option

For a Twilio-controlled number, set `PUBLIC_BASE_URL`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` in your host environment and configure the inbound SMS webhook to `https://YOUR-BRIDGE/webhook/sms` using POST. The server validates Twilio's request signature before processing the message.

A regular cellular number is not automatically accessible to Twilio; use the phone-side forwarding route for that number.

Official documentation: https://www.twilio.com/docs/usage/webhooks/messaging-webhooks

## API

- `GET /api/health`: basic health response.
- `GET /api/messages`: requires `SMS_READ_TOKEN`; returns only messages in the rolling five-minute window.
- `POST /api/forward`: requires `SMS_INGEST_TOKEN`; accepts `from`, `to`, `body`, and `receivedAt`.
- `POST /webhook/sms`: optional Twilio inbound SMS webhook, signature checked.

The service is a starter, not managed hosting. Messages are not persisted to disk, so restarting the server clears the inbox. The bridge does not create phone numbers, bypass service restrictions, or auto-submit websites.
