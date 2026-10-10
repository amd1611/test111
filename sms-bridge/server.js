"use strict";
require("dotenv").config();
const crypto = require("node:crypto");
const express = require("express");
const twilio = require("twilio");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use(express.json({ limit: "16kb" }));

const KEEP_MS = 5 * 60 * 1000;
const MAX_MESSAGES = 200;
const messages = [];
const codePattern = /(?<!\d)\d{4,8}(?!\d)/;

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
  return match ? match[1].trim() : "";
}
function requireToken(envName) {
  return (req, res, next) => {
    const expected = process.env[envName];
    if (!expected || !timingSafeEqual(bearer(req), expected)) {
      return res.status(401).json({ error: "Unauthorized. Check the private bridge token." });
    }
    next();
  };
}
function prune() {
  const cutoff = Date.now() - KEEP_MS;
  for (let i = messages.length - 1; i >= 0; i--) {
    const stamp = Date.parse(messages[i].receivedAt);
    if (!Number.isFinite(stamp) || stamp < cutoff) messages.splice(i, 1);
  }
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
}
function normalizePhone(value) { return String(value || "").replace(/[^\d+]/g, ""); }
function storeMessage(input) {
  const body = String(input.body || "").trim().slice(0, 1600);
  const code = codePattern.exec(body);
  const stamp = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (!Number.isFinite(stamp.getTime())) return { stored: false, reason: "Invalid timestamp" };
  if (Date.now() - stamp.getTime() > KEEP_MS || stamp.getTime() > Date.now() + 60000) {
    return { stored: false, reason: "Message is outside the five-minute window" };
  }
  if (!code) return { stored: false, reason: "No likely numeric code in message" };
  const item = {
    id: String(input.id || crypto.randomUUID()).slice(0, 100),
    from: String(input.from || "Unknown sender").slice(0, 120),
    to: String(input.to || "").slice(0, 120),
    body,
    code: code[0],
    receivedAt: stamp.toISOString(),
    source: String(input.source || "phone-forwarder").slice(0, 24)
  };
  const old = messages.findIndex((m) => m.id === item.id);
  if (old >= 0) messages.splice(old, 1);
  messages.push(item);
  prune();
  return { stored: true, id: item.id };
}

app.get("/", (_req, res) => res.json({ service: "Account Forge private SMS bridge", ok: true, retentionSeconds: 300 }));
app.get("/api/health", (_req, res) => res.json({ ok: true, retentionSeconds: 300 }));

app.get("/api/messages", requireToken("SMS_READ_TOKEN"), (req, res) => {
  prune();
  const parsedSince = req.query.since ? Date.parse(String(req.query.since)) : Date.now() - KEEP_MS;
  const since = Number.isFinite(parsedSince) ? Math.max(Date.now() - KEEP_MS, parsedSince) : Date.now() - KEEP_MS;
  const recent = messages.filter((item) => Date.parse(item.receivedAt) >= since)
    .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  res.json({ messages: recent, retentionSeconds: 300 });
});

app.post("/api/forward", requireToken("SMS_INGEST_TOKEN"), (req, res) => {
  const data = req.body || {};
  if (typeof data.body !== "string" || !data.body.trim()) return res.status(400).json({ error: "A non-empty message body is required." });
  const result = storeMessage({ id: data.id, from: data.from, to: data.to, body: data.body, receivedAt: data.receivedAt, source: "phone-forwarder" });
  res.status(result.stored ? 201 : 202).json(result);
});

app.post("/webhook/sms", (req, res) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!authToken || !publicBase) return res.status(503).type("text/plain").send("Twilio webhook is not configured.");
  const signature = req.get("X-Twilio-Signature") || "";
  if (!twilio.validateRequest(authToken, signature, publicBase + "/webhook/sms", req.body || {})) {
    return res.status(403).type("text/plain").send("Invalid provider signature.");
  }
  const allowed = String(process.env.TWILIO_PHONE_NUMBER || "").split(",").map(normalizePhone).filter(Boolean);
  const to = normalizePhone(req.body.To || "");
  if (allowed.length && !allowed.includes(to)) return res.status(403).type("text/plain").send("Destination is not configured.");
  storeMessage({ id: req.body.MessageSid, from: req.body.From, to: req.body.To, body: req.body.Body, receivedAt: new Date().toISOString(), source: "twilio" });
  res.status(200).type("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
});

setInterval(prune, 15000).unref();
const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log("Account Forge private SMS bridge listening on port " + port);
  console.log("Message bodies are not logged; recent code-bearing messages are kept in memory only.");
});
