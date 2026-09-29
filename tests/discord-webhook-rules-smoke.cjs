const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = { URL, URLSearchParams, Date, JSON, Number };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync("discord-webhook-rules.js", "utf8"), context);
const rules = context.StudylogDiscordWebhookRules;

const ID = "1234567890123456789";
const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG";
const WEBHOOK = `https://discord.com/api/webhooks/${ID}/${TOKEN}`;

// クライアントの種類や旧ドメインで貼られても、同じ1つの送り先として扱う
assert.equal(rules.normalizeWebhookUrl(WEBHOOK), WEBHOOK);
assert.equal(rules.normalizeWebhookUrl(` ${WEBHOOK} `), WEBHOOK, "前後の空白は落とす");
assert.equal(rules.normalizeWebhookUrl(`https://canary.discord.com/api/webhooks/${ID}/${TOKEN}`), WEBHOOK);
assert.equal(rules.normalizeWebhookUrl(`https://ptb.discord.com/api/webhooks/${ID}/${TOKEN}`), WEBHOOK);
assert.equal(rules.normalizeWebhookUrl(`https://discordapp.com/api/webhooks/${ID}/${TOKEN}`), WEBHOOK, "旧ドメインも受ける");
assert.equal(rules.normalizeWebhookUrl(`https://discord.com/api/v10/webhooks/${ID}/${TOKEN}`), WEBHOOK, "版つきのURLも受ける");
assert.equal(rules.normalizeWebhookUrl(`${WEBHOOK}/`), WEBHOOK);

// 別物は受け付けない
assert.equal(rules.normalizeWebhookUrl(""), "");
assert.equal(rules.normalizeWebhookUrl(`http://discord.com/api/webhooks/${ID}/${TOKEN}`), "", "httpは受けない");
assert.equal(rules.normalizeWebhookUrl(`https://discord.com.evil.example/api/webhooks/${ID}/${TOKEN}`), "", "似た名前のホストは弾く");
assert.equal(rules.normalizeWebhookUrl(`https://discord.com/api/webhooks/${ID}`), "", "トークンがない");
assert.equal(rules.normalizeWebhookUrl("https://discord.com/channels/@me"), "");
assert.equal(rules.normalizeWebhookUrl("https://hooks.slack.com/services/T0/B0/xxxxxxxxxxxxxxxxxxxxxxxx"), "", "Slackの送り先は別物");
assert.equal(rules.isWebhookUrl(WEBHOOK), true);
assert.equal(rules.isWebhookUrl("https://discord.com/channels/@me"), false);
assert.equal(rules.webhookId(WEBHOOK), ID);

// 貼られた URL が生きているかは、その URL 自身への問い合わせで確かめる
assert.equal(rules.buildInspectUrl(`https://ptb.discord.com/api/webhooks/${ID}/${TOKEN}`), WEBHOOK);
const info = rules.parseWebhookInfo({ name: "出席通知", channel_id: "999", guild_id: "888", token: TOKEN });
assert.equal(info.ok, true);
assert.equal(info.info.name, "出席通知");
assert.equal(info.info.channelId, "999");
assert.equal(rules.parseWebhookInfo({ message: "Unknown Webhook", code: 10015 }).ok, false);
assert.match(rules.parseWebhookInfo({ message: "Unknown Webhook", code: 10015 }).message, /削除されています/);
assert.match(rules.parseWebhookInfo({ message: "Invalid Webhook Token", code: 50027 }).message, /トークン/);
assert.match(rules.parseWebhookInfo({ message: "You are being rate limited." }).message, /rate limited/);
assert.equal(rules.parseWebhookInfo(null).ok, false);

// 保存する形
const link = rules.linkFromWebhookUrl(`https://discordapp.com/api/webhooks/${ID}/${TOKEN}`, {
  info: { name: "出席通知", channelId: "999", guildId: "888" },
  now: Date.parse("2026-09-07T09:00:00Z")
});
assert.equal(link.webhookUrl, WEBHOOK, "保存するのは正規化した形");
assert.equal(link.webhookId, ID);
assert.equal(link.name, "出席通知");
assert.equal(link.linkedAt, "2026-09-07T09:00:00.000Z");
assert.equal(rules.linkFromWebhookUrl("https://example.com/hook"), null);
assert.equal(rules.normalizeLink({ webhookUrl: WEBHOOK, name: "出席通知" }).name, "出席通知");
assert.equal(rules.normalizeLink({ webhookUrl: "https://example.com/hook" }), null);
assert.equal(rules.normalizeLink({}), null);

// 画面と記録では、投稿の鍵になるトークンを伏せる
assert.equal(rules.maskWebhookUrl(WEBHOOK), `https://discord.com/api/webhooks/${ID}/…（以降は伏せています）`);
assert.ok(!rules.maskWebhookUrl(WEBHOOK).includes(TOKEN));
assert.equal(rules.maskWebhookUrl("https://example.com/hook"), "");
assert.equal(rules.summarizeLink({ webhookUrl: WEBHOOK, name: "出席通知" }), "Discord の「出席通知」");
assert.equal(rules.summarizeLink({ webhookUrl: WEBHOOK }), "Discord の Webhook");
assert.equal(rules.summarizeLink({}), "");

// 送る本文。メンションは解釈させない
const body = rules.buildMessageBody("出席確認の受付を検知しました");
assert.equal(body.content, "出席確認の受付を検知しました");
assert.equal(body.allowed_mentions.parse.length, 0, "@everyone を書かれても鳴らさない");

console.log("discord-webhook-rules smoke ok");
