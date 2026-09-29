const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = { URL, URLSearchParams, Date, JSON };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync("slack-link-rules.js", "utf8"), context);
const rules = context.StudylogSlackLinkRules;

const EXTENSION_ID = "lokfigpomklcecmpkjlkheeidacjdfjo";
const REDIRECT = `https://${EXTENSION_ID}.chromiumapp.org/`;
const CLIENT_ID = "1234567890123.9876543210987";
const CLIENT_SECRET = "0123456789abcdef0123456789abcdef";
const WEBHOOK = ["https://hooks.slack.com/services", "T00000000", "B00000000", "XXXXXXXXXXXXXXXXXXXXXXXX"].join("/");

// 戻り先は拡張機能IDから決まるため、利用者が考えて入力する余地がない
assert.equal(rules.buildRedirectUri(EXTENSION_ID), REDIRECT);
assert.equal(rules.buildRedirectUri(""), "");
assert.equal(rules.isRedirectUri(REDIRECT), true);
assert.equal(rules.isRedirectUri("https://example.com/"), false);

// 入力の取り違えは通信する前に弾く
assert.equal(rules.validateCredentials({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET }).ok, true);
assert.equal(rules.validateCredentials({ clientId: ` ${CLIENT_ID} `, clientSecret: CLIENT_SECRET }).clientId, CLIENT_ID, "前後の空白は落とす");
assert.equal(rules.validateCredentials({ clientId: "", clientSecret: CLIENT_SECRET }).field, "clientId");
assert.equal(rules.validateCredentials({ clientId: "not-an-id", clientSecret: CLIENT_SECRET }).field, "clientId");
assert.equal(rules.validateCredentials({ clientId: CLIENT_ID, clientSecret: "" }).field, "clientSecret");
assert.equal(rules.validateCredentials({ clientId: CLIENT_ID, clientSecret: CLIENT_ID }).field, "clientSecret", "ID と Secret の逆貼りを見分ける");
assert.match(rules.validateCredentials({ clientId: CLIENT_ID, clientSecret: "short" }).message, /Signing Secret/);

// アプリ作成のマニフェストに、必要な権限と戻り先が入っている
const manifest = rules.buildAppManifest({ redirectUri: REDIRECT });
assert.equal(manifest.oauth_config.redirect_urls.join(","), REDIRECT);
assert.equal(manifest.oauth_config.scopes.bot.join(","), "incoming-webhook");
assert.equal(manifest.features.bot_user.display_name, "Studylog Bridge");
assert.ok(manifest.display_information.name.length <= 35);
const createUrl = new URL(rules.buildAppCreateUrl(manifest));
assert.equal(createUrl.origin + createUrl.pathname, "https://api.slack.com/apps");
assert.equal(createUrl.searchParams.get("new_app"), "1");
assert.equal(createUrl.searchParams.get("manifest_json"), JSON.stringify(manifest), "マニフェストがそのまま渡る");

// 迷った時の入口も定数として持つ
assert.equal(rules.APP_DIRECTORY_URL, "https://api.slack.com/apps");
assert.match(rules.WORKSPACE_CREATE_URL, /^https:\/\/slack\.com\//);

// 認可URL
const authorizeUrl = new URL(rules.buildAuthorizeUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT, state: "s-1" }));
assert.equal(authorizeUrl.origin + authorizeUrl.pathname, "https://slack.com/oauth/v2/authorize");
assert.equal(authorizeUrl.searchParams.get("client_id"), CLIENT_ID);
assert.equal(authorizeUrl.searchParams.get("scope"), "incoming-webhook", "投稿以外の権限は求めない");
assert.equal(authorizeUrl.searchParams.get("redirect_uri"), REDIRECT);
assert.equal(authorizeUrl.searchParams.get("state"), "s-1");

// 戻り先の読み取り
const parsed = rules.parseAuthRedirect(`${REDIRECT}?code=abc&state=s-1`, "s-1");
assert.equal(parsed.ok, true);
assert.equal(parsed.code, "abc");
assert.equal(rules.parseAuthRedirect(`${REDIRECT}?code=abc&state=other`, "s-1").error, "state-mismatch");
assert.equal(rules.parseAuthRedirect(`${REDIRECT}?error=access_denied&state=s-1`, "s-1").error, "access_denied");
assert.equal(rules.parseAuthRedirect("", "s-1").error, "cancelled", "画面を閉じた場合も理由を返す");
assert.equal(rules.parseAuthRedirect(undefined, "s-1").error, "cancelled");
assert.equal(rules.parseAuthRedirect(`${REDIRECT}?state=s-1`, "s-1").error, "no-code");
assert.equal(rules.parseAuthRedirect("not a url", "s-1").error, "bad-redirect");

// 交換の本文
const body = new URLSearchParams(rules.buildTokenExchangeBody({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: "abc", redirectUri: REDIRECT }));
assert.equal(body.get("client_id"), CLIENT_ID);
assert.equal(body.get("client_secret"), CLIENT_SECRET);
assert.equal(body.get("code"), "abc");
assert.equal(body.get("redirect_uri"), REDIRECT);
assert.equal(new URLSearchParams(rules.buildRevokeBody("xoxb-1")).get("token"), "xoxb-1");

// Slack の応答から保存する値だけを取り出す
const success = rules.parseTokenResponse({
  ok: true,
  access_token: "xoxb-1",
  app_id: "A00000000",
  team: { id: "T00000000", name: "岩崎学園" },
  incoming_webhook: { channel: "#出席", channel_id: "C00000000", configuration_url: "https://example.slack.com/services/B0", url: WEBHOOK }
}, { now: Date.parse("2026-09-07T09:00:00Z") });
assert.equal(success.ok, true);
assert.equal(success.link.webhookUrl, WEBHOOK);
assert.equal(success.link.channelName, "出席", "先頭の # は落とす");
assert.equal(success.link.teamName, "岩崎学園");
assert.equal(success.link.accessToken, "xoxb-1");
assert.equal(success.link.linkedAt, "2026-09-07T09:00:00.000Z");

assert.equal(rules.parseTokenResponse({ ok: false, error: "invalid_client_id" }).error, "invalid_client_id");
assert.match(rules.parseTokenResponse({ ok: false, error: "invalid_client_id" }).message, /Client ID/);
assert.equal(rules.parseTokenResponse({ ok: true, incoming_webhook: { url: "https://example.com/hook" } }).error, "no-webhook", "別のあて先は受け付けない");
assert.equal(rules.parseTokenResponse(null).error, "bad-response");
assert.match(rules.describeSlackError("なにか"), /なにか/);

// 保存済みの値の読み直し
assert.equal(rules.normalizeLink({ webhookUrl: WEBHOOK, channelName: "#出席" }).channelName, "出席");
assert.equal(rules.normalizeLink({ webhookUrl: "https://example.com/hook" }), null, "別のあて先が入っていたら連携なし");
assert.equal(rules.normalizeLink({}), null);
assert.equal(rules.normalizeLink({ webhookUrl: WEBHOOK, configurationUrl: "javascript:alert(1)" }).configurationUrl, "", "http(s) 以外のリンクは落とす");
assert.equal(rules.linkFromWebhookUrl(WEBHOOK).webhookUrl, WEBHOOK, "手貼りの URL からも同じ形を作れる");
assert.equal(rules.linkFromWebhookUrl("https://hooks.slack.com/"), null);
assert.equal(rules.isWebhookUrl(WEBHOOK), true);
assert.equal(rules.isWebhookUrl("https://hooks.slack.com.evil.example/services/x"), false, "似た名前のホストは弾く");

// 記録や画面に出す時は、送り先の後ろを伏せる
assert.equal(rules.maskWebhookUrl(WEBHOOK), "https://hooks.slack.com/services/T00000000/…（以降は伏せています）");
assert.ok(!rules.maskWebhookUrl(WEBHOOK).includes("XXXXXXXXXXXXXXXXXXXXXXXX"));
assert.equal(rules.maskWebhookUrl("https://example.com/hook"), "");
assert.equal(rules.summarizeLink({ webhookUrl: WEBHOOK, teamName: "岩崎学園", channelName: "出席" }), "岩崎学園 の #出席");
assert.equal(rules.summarizeLink({ webhookUrl: WEBHOOK }), "選んだチャンネル");
assert.equal(rules.summarizeLink({}), "");

console.log("slack-link-rules smoke ok");
