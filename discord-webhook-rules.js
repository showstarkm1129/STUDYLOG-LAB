(() => {
  "use strict";

  // Discord 連携の判定と組み立てだけを持つ。通信・権限要求・保存は dashboard.js が行う。
  //
  // Discord の通知は Webhook だけで完結する。Slack と違ってアプリの作成も OAuth も要らず、
  // チャンネル設定で作った Webhook の URL を1つ貼れば済む。そのかわり URL そのものが秘密になる。

  const API_ORIGIN = "https://discord.com";
  const REQUIRED_ORIGINS = Object.freeze(["https://discord.com/*"]);
  const APP_URL = "https://discord.com/channels/@me";
  const WEBHOOK_GUIDE_URL = "https://support.discord.com/hc/ja/articles/228383668";

  // 正規化後の形。id は数字、token は英数字と - _ だけ。
  const WEBHOOK_PATTERN = /^https:\/\/discord\.com\/api\/webhooks\/(\d{5,})\/([A-Za-z0-9_-]{20,})$/;
  // クライアントの種類や旧ドメインで貼られても同じものとして扱う。
  const HOST_ALIASES = Object.freeze(["discord.com", "www.discord.com", "canary.discord.com", "ptb.discord.com", "discordapp.com", "www.discordapp.com", "canary.discordapp.com", "ptb.discordapp.com"]);

  const text = (value) => String(value ?? "").trim();

  // 貼り付けられた URL を、api.discord.com の正規の形に直す。直せなければ空文字。
  function normalizeWebhookUrl(value) {
    const raw = text(value);
    if (!raw) return "";
    let url;
    try {
      url = new URL(raw);
    } catch {
      return "";
    }
    if (url.protocol !== "https:") return "";
    if (!HOST_ALIASES.includes(url.hostname.toLowerCase())) return "";
    const path = url.pathname.replace(/\/+$/, "");
    const match = /^\/api(?:\/v\d+)?\/webhooks\/(\d{5,})\/([A-Za-z0-9_-]{20,})$/.exec(path);
    if (!match) return "";
    return `${API_ORIGIN}/api/webhooks/${match[1]}/${match[2]}`;
  }

  function isWebhookUrl(value) {
    return WEBHOOK_PATTERN.test(text(value));
  }

  function webhookId(value) {
    const match = WEBHOOK_PATTERN.exec(normalizeWebhookUrl(value));
    return match ? match[1] : "";
  }

  // 貼られた URL が生きているかを確かめるための問い合わせ先。Webhook 自身の情報だけが返る。
  function buildInspectUrl(webhookUrl) {
    return normalizeWebhookUrl(webhookUrl);
  }

  function parseWebhookInfo(payload) {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "bad-response", message: "Discord からの応答を読み取れませんでした。" };
    }
    if (payload.message || payload.code) {
      return { ok: false, error: text(payload.code) || "error", message: describeDiscordError(payload) };
    }
    return {
      ok: true,
      info: {
        name: text(payload.name),
        channelId: text(payload.channel_id),
        guildId: text(payload.guild_id)
      }
    };
  }

  function linkFromWebhookUrl(webhookUrl, { info = {}, now = Date.now() } = {}) {
    const url = normalizeWebhookUrl(webhookUrl);
    if (!url) return null;
    return {
      webhookUrl: url,
      webhookId: webhookId(url),
      name: text(info.name),
      channelId: text(info.channelId),
      guildId: text(info.guildId),
      linkedAt: new Date(now).toISOString()
    };
  }

  function normalizeLink(stored) {
    const url = normalizeWebhookUrl(stored?.webhookUrl);
    if (!url) return null;
    return {
      webhookUrl: url,
      webhookId: webhookId(url),
      name: text(stored?.name),
      channelId: text(stored?.channelId),
      guildId: text(stored?.guildId),
      linkedAt: text(stored?.linkedAt)
    };
  }

  // URL そのものが投稿の鍵になるため、token は画面にも記録にも出さない。
  function maskWebhookUrl(value) {
    const url = normalizeWebhookUrl(value);
    if (!url) return "";
    return `${API_ORIGIN}/api/webhooks/${webhookId(url)}/…（以降は伏せています）`;
  }

  function summarizeLink(link) {
    const normalized = normalizeLink(link);
    if (!normalized) return "";
    return normalized.name ? `Discord の「${normalized.name}」` : "Discord の Webhook";
  }

  // 送るのは本文だけ。メンションは解釈させない。
  function buildMessageBody(message) {
    return { content: text(message), allowed_mentions: { parse: [] } };
  }

  const ERROR_MESSAGES = Object.freeze({
    10015: "この Webhook は Discord 側で削除されています。チャンネル設定で作り直して、URLを貼り直してください。",
    50027: "URLの後半（トークン）が違います。コピーし直してください。"
  });

  function describeDiscordError(payload) {
    const code = Number(payload?.code);
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
    const message = text(payload?.message);
    return message ? `Discord が受け付けませんでした（${message}）。` : "Discord が受け付けませんでした。";
  }

  globalThis.StudylogDiscordWebhookRules = Object.freeze({
    API_ORIGIN,
    REQUIRED_ORIGINS,
    APP_URL,
    WEBHOOK_GUIDE_URL,
    normalizeWebhookUrl,
    isWebhookUrl,
    webhookId,
    buildInspectUrl,
    parseWebhookInfo,
    linkFromWebhookUrl,
    normalizeLink,
    maskWebhookUrl,
    summarizeLink,
    buildMessageBody,
    describeDiscordError
  });
})();
