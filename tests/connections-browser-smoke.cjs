const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const dependencyRoot = process.argv[2];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

const CLIENT_ID = "1234567890123.9876543210987";
const CLIENT_SECRET = "0123456789abcdef0123456789abcdef";
const WEBHOOK = ["https://hooks.slack.com/services", "T00000000", "B00000000", "XXXXXXXXXXXXXXXXXXXXXXXX"].join("/");
const EXTENSION_ID = "lokfigpomklcecmpkjlkheeidacjdfjo";
const DISCORD_ID = "1234567890123456789";
const DISCORD_TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789";
const DISCORD_WEBHOOK = `https://discord.com/api/webhooks/${DISCORD_ID}/${DISCORD_TOKEN}`;

const server = http.createServer((request, response) => {
  const pathname = request.url === "/" ? "/dashboard.html" : new URL(request.url, "http://localhost").pathname;
  const filename = path.resolve(root, pathname.replace(/^\/+/, ""));
  if (!filename.startsWith(`${root}${path.sep}`) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});

// 拡張機能の API と Slack への通信を差し替え、連携の一連の流れだけを確かめる。
function installMocks({ extensionId, webhook, clientId }) {
  const store = {
    studylogBridgeSnapshotV1: {
      schemaVersion: 1,
      academicYear: 2026,
      collectedAt: "2026-09-07T00:00:00.000Z",
      courses: [{ classId: "10175", name: "データベース", academicYear: 2026, totalLessons: 30, attended: 10, absent: 1, publicAbsent: 0 }],
      reports: [],
      directories: [],
      directoryItems: [],
      visibleTimetable: [],
      timetableSlots: []
    },
    studylogDashboardPreferencesV1: { manualCompleted: [] }
  };
  const calls = { permissionRequests: [], permissionRemovals: [], authorizeUrls: [], token: [], revoke: [], notices: [], discordInspects: [], discordDeletes: [] };
  const granted = new Set();
  window.__slack = { store, calls, denyAuth: false, tokenResponse: { ok: true }, discordResponse: null };
  window.open = () => null;

  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, store[key]]));
        },
        async set(values) { Object.assign(store, JSON.parse(JSON.stringify(values))); }
      },
      onChanged: { addListener() {} }
    },
    permissions: {
      async contains(query) { return (query.origins || []).every((origin) => granted.has(origin)); },
      async request(query) {
        calls.permissionRequests.push(query.origins || query.permissions || []);
        (query.origins || []).forEach((origin) => granted.add(origin));
        return true;
      },
      async remove(query) {
        calls.permissionRemovals.push(query.origins || []);
        (query.origins || []).forEach((origin) => granted.delete(origin));
        return true;
      }
    },
    identity: {
      getRedirectURL() { return `https://${extensionId}.chromiumapp.org/`; },
      async launchWebAuthFlow({ url }) {
        calls.authorizeUrls.push(url);
        const state = new URL(url).searchParams.get("state");
        if (window.__slack.denyAuth) return `https://${extensionId}.chromiumapp.org/?error=access_denied&state=${state}`;
        return `https://${extensionId}.chromiumapp.org/?code=test-code&state=${state}`;
      }
    },
    runtime: {
      getURL(file) { return new URL(`/${file}`, location.origin).href; },
      async sendMessage(message) {
        if (message?.type === "studylog-bridge:attendance-test") {
          const channels = message.channels || [];
          calls.notices.push({ channels, slackWebhookUrl: message.slackWebhookUrl, discordWebhookUrl: message.discordWebhookUrl });
          return {
            badge: false,
            desktop: false,
            sound: false,
            slack: channels.includes("slack") && granted.has("https://hooks.slack.com/*"),
            discord: channels.includes("discord") && granted.has("https://discord.com/*")
          };
        }
        return null;
      }
    },
    tabs: { async query() { return []; }, async sendMessage() { return null; } }
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === "https://slack.com/api/oauth.v2.access") {
      calls.token.push(String(init.body || ""));
      const override = window.__slack.tokenResponse;
      const payload = override.ok === false ? override : {
        ok: true,
        access_token: "xoxb-test",
        app_id: "A00000000",
        team: { id: "T00000000", name: "岩崎学園" },
        incoming_webhook: { channel: "#出席", channel_id: "C00000000", configuration_url: "https://example.slack.com/services/B0", url: webhook }
      };
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://slack.com/api/auth.revoke") {
      calls.revoke.push(String(init.body || ""));
      return new Response(JSON.stringify({ ok: true, revoked: true }), { headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("https://discord.com/api/webhooks/")) {
      if (String(init.method || "GET").toUpperCase() === "DELETE") {
        calls.discordDeletes.push(url);
        return new Response(null, { status: 204 });
      }
      calls.discordInspects.push(url);
      const override = window.__slack.discordResponse;
      const payload = override || { id: "1234567890123456789", name: "出席通知", channel_id: "999", guild_id: "888" };
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    }
    return realFetch(input, init);
  };
  window.__slack.seedClientId = clientId;
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(installMocks, { extensionId: EXTENSION_ID, webhook: WEBHOOK, clientId: CLIENT_ID });
    await page.goto(`http://127.0.0.1:${port}/dashboard.html`, { waitUntil: "networkidle" });
    await page.click("#open-attendance-watch-dialog");
    await page.waitForSelector("#attendance-watch-dialog[open]");

    // 見張りの画面には状態と入口だけがあり、ログインの手順は混ざらない。
    assert.equal(await page.locator("#attendance-watch-body #slack-link-start").count(), 0, "the login steps do not sit inside the watch settings");
    assert.match(await page.locator(".connection-summary[data-service='slack']").innerText(), /まだ連携していません/);
    assert.equal(await page.locator(".connection-summary").count(), 2, "every destination gets a row of its own");
    assert.equal(await page.locator("[data-attendance-watch='slack']").isDisabled(), true, "the Slack channel cannot be turned on before linking");
    assert.equal(await page.locator("[data-attendance-watch='discord']").isDisabled(), true, "the Discord channel cannot be turned on before linking");

    // 連携の作業は、専用のダイアログを開いて行う。
    await page.click(".connection-summary[data-service='slack'] [data-open-connection]");
    await page.waitForSelector("#connection-dialog[open]");
    assert.equal(await page.locator("#attendance-watch-dialog[open]").count(), 1, "the watch dialog stays open behind it");
    assert.equal(await page.locator("#connection-dialog #slack-link-start").count(), 1, "the guide lives in the connection dialog");
    assert.match(await page.locator("#connection-dialog .connection-card[data-service='slack'] .connection-state").innerText(), /未連携/);
    assert.match(await page.locator(".connection-card[data-service='slack'] .connection-steps").innerText(), new RegExp(`${EXTENSION_ID}\\.chromiumapp\\.org`), "the redirect URL to register is shown");

    // 迷いやすいSlack側の画面については、押す場所を画面内に書いておく。
    const guide = await page.evaluate(() => document.querySelector("#connection-dialog .connection-card[data-service='slack']").textContent);
    assert.match(guide, /Pick a workspace to develop your app in/, "the workspace picker is named");
    assert.match(guide, /App Credentials/, "where the two values live is named");
    assert.match(guide, /管理者の承認/, "the school workspace may need approval");
    assert.equal(await page.locator("#slack-create-workspace").count(), 1, "creating a personal workspace is offered");
    assert.equal(await page.locator("#slack-open-apps").count(), 1, "the app list can be reopened after losing the tab");

    // 入力の取り違えは、通信する前に弾く。
    await page.fill("#slack-client-id", CLIENT_ID);
    await page.fill("#slack-client-secret", CLIENT_ID);
    await page.click("#slack-link-start");
    await page.waitForFunction(() => document.querySelector(".connection-progress[data-service='slack']").textContent.includes("入れ替えて"));
    assert.equal((await page.evaluate(() => window.__slack.calls.authorizeUrls.length)), 0, "a swapped secret never reaches Slack");

    // 正しい値なら、許可 → 認可 → 送り先の取得 → 有効化 → テスト送信までが1回の操作で終わる。
    await page.fill("#slack-client-secret", CLIENT_SECRET);
    await page.click("#slack-link-start");
    await page.waitForSelector(".connection-status[data-linked='true']");

    const calls = await page.evaluate(() => window.__slack.calls);
    assert.deepEqual(calls.permissionRequests[0], ["https://slack.com/*", "https://hooks.slack.com/*"], "both origins are asked for in one prompt");
    const authorize = new URL(calls.authorizeUrls[0]);
    assert.equal(authorize.origin + authorize.pathname, "https://slack.com/oauth/v2/authorize");
    assert.equal(authorize.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(authorize.searchParams.get("scope"), "incoming-webhook");
    assert.equal(authorize.searchParams.get("redirect_uri"), `https://${EXTENSION_ID}.chromiumapp.org/`);
    const tokenBody = new URLSearchParams(calls.token[0]);
    assert.equal(tokenBody.get("code"), "test-code");
    assert.equal(tokenBody.get("client_secret"), CLIENT_SECRET);
    assert.equal(calls.notices.length, 1, "a single test message proves the channel works");
    assert.deepEqual(calls.notices[0].channels, ["slack"]);
    assert.equal(calls.notices[0].slackWebhookUrl, WEBHOOK);

    assert.match(await page.locator("#connection-dialog .connection-card[data-service='slack'] .connection-state").innerText(), /岩崎学園 の #出席/, "the card header says where it posts now");
    const linkedText = await page.locator("#connection-dialog .connection-card[data-service='slack']").innerText();
    assert.match(linkedText, /岩崎学園 の #出席 につながっています/);
    assert.ok(!linkedText.includes("XXXXXXXXXXXXXXXXXXXXXXXX"), "the webhook URL is not shown in full");

    const saved = await page.evaluate(() => window.__slack.store.studylogDashboardPreferencesV1.attendanceWatch);
    assert.equal(saved.slackWebhookUrl, WEBHOOK, "the webhook is stored for the background worker");
    assert.equal(saved.slack.channelName, "出席");
    assert.equal(saved.channels.slack, true, "the Slack channel is turned on without another click");
    assert.equal(saved.slackClientId, CLIENT_ID, "the client id is kept so linking again needs no retyping");
    const dump = await page.evaluate(() => JSON.stringify(window.__slack.store));
    assert.ok(!dump.includes(CLIENT_SECRET), "the client secret is never written to storage");
    assert.equal(await page.locator("#slack-client-secret").count(), 0, "the secret field is gone once linking is done");

    // 閉じると、開いたままだった見張りの画面の表示も連携済みに変わる。
    await page.click("#connection-dialog [data-close-dialog]");
    await page.waitForFunction(() => document.querySelector(".connection-summary[data-service='slack']")?.dataset.linked === "true");
    assert.equal(await page.locator("[data-attendance-watch='slack']").isChecked(), true);
    assert.match(await page.locator(".connection-summary[data-service='slack']").innerText(), /岩崎学園 の #出席 に送ります/);

    // 記録のコピーには、送り先も権限の証書も含めない。
    const log = await page.evaluate(async () => {
      const written = [];
      navigator.clipboard.writeText = async (value) => { written.push(value); };
      document.querySelector("#attendance-watch-copy").click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      return written.join("");
    });
    assert.ok(log.includes("以降は伏せています"), "the copied log masks the webhook");
    assert.ok(!log.includes("XXXXXXXXXXXXXXXXXXXXXXXX") && !log.includes("xoxb-test"), "no secret leaves through the copied log");

    // 解除は、Slack 側の許可の取り消しと、端末に残した権限の返却まで行う。
    await page.click(".connection-summary[data-service='slack'] [data-open-connection]");
    await page.waitForSelector("#connection-dialog[open]");
    await page.click("#slack-unlink");
    await page.waitForSelector("#slack-link-start");
    const afterUnlink = await page.evaluate(() => ({
      calls: window.__slack.calls,
      settings: window.__slack.store.studylogDashboardPreferencesV1.attendanceWatch
    }));
    assert.equal(new URLSearchParams(afterUnlink.calls.revoke[0]).get("token"), "xoxb-test", "the Slack side is revoked too");
    assert.deepEqual(afterUnlink.calls.permissionRemovals[0], ["https://slack.com/*", "https://hooks.slack.com/*"], "the granted origins are handed back");
    assert.equal(afterUnlink.settings.slackWebhookUrl, "");
    assert.equal(afterUnlink.settings.slack, null);
    assert.equal(afterUnlink.settings.channels.slack, false);
    assert.equal(afterUnlink.settings.slackClientId, CLIENT_ID, "the client id survives so the next link is one field shorter");

    // Slack 側で断られた場合は、その理由を出して何も保存しない。
    await page.evaluate(() => { window.__slack.denyAuth = true; });
    await page.fill("#slack-client-secret", CLIENT_SECRET);
    await page.click("#slack-link-start");
    await page.waitForFunction(() => document.querySelector(".connection-progress[data-service='slack']").textContent.includes("許可されなかった"));
    assert.equal(await page.locator(".connection-status").count(), 0, "a refused authorisation leaves the extension unlinked");

    // Slack が値を受け付けなかった場合も、原因の分かる日本語を出す。
    await page.evaluate(() => { window.__slack.denyAuth = false; window.__slack.tokenResponse = { ok: false, error: "invalid_client_id" }; });
    await page.click("#slack-link-start");
    await page.waitForFunction(() => document.querySelector(".connection-progress[data-service='slack']").textContent.includes("Client ID が違います"));
    assert.equal(await page.locator(".connection-status").count(), 0);

    // Discord は同じダイアログの別カードで、URLを貼るだけで完結する。
    const discordCard = "#connection-dialog .connection-card[data-service='discord']";
    assert.equal(await page.locator(discordCard).count(), 1, "Discord is a second card in the same dialog");
    assert.match(await page.locator(`${discordCard} .connection-state`).innerText(), /未連携/);
    assert.equal(await page.locator("#discord-client-secret").count(), 0, "Discord asks for no credentials");

    // 形の違うURLは、通信する前に弾く。
    await page.fill("#discord-webhook-url", "https://discord.com/channels/@me");
    await page.click("#discord-link-start");
    await page.waitForFunction(() => document.querySelector(".connection-progress[data-service='discord']").textContent.includes("api/webhooks"));
    assert.equal(await page.evaluate(() => window.__slack.calls.discordInspects.length), 0, "a channel link never reaches Discord");

    // 別のクライアントのURLで貼られても、同じ1つの送り先として扱う。
    await page.fill("#discord-webhook-url", `https://canary.discord.com/api/webhooks/${DISCORD_ID}/${DISCORD_TOKEN}`);
    await page.click("#discord-link-start");
    await page.waitForSelector(`${discordCard} .connection-status[data-linked='true']`);

    const discordCalls = await page.evaluate(() => window.__slack.calls);
    assert.deepEqual(discordCalls.permissionRequests.at(-1), ["https://discord.com/*"], "only the Discord origin is asked for");
    assert.equal(discordCalls.discordInspects.at(-1), DISCORD_WEBHOOK, "the pasted URL is checked in its canonical form");
    assert.deepEqual(discordCalls.notices.at(-1).channels, ["discord"]);
    assert.equal(discordCalls.notices.at(-1).discordWebhookUrl, DISCORD_WEBHOOK, "a test message proves the webhook works");

    const discordSaved = await page.evaluate(() => window.__slack.store.studylogDashboardPreferencesV1.attendanceWatch);
    assert.equal(discordSaved.discordWebhookUrl, DISCORD_WEBHOOK, "the canonical URL is stored for the background worker");
    assert.equal(discordSaved.discord.name, "出席通知", "the webhook name is shown instead of the raw URL");
    assert.equal(discordSaved.channels.discord, true, "the Discord channel is turned on without another click");
    assert.equal(discordSaved.channels.slack, false, "linking Discord does not touch Slack");
    const discordText = await page.locator(discordCard).innerText();
    assert.match(discordText, /Discord の「出席通知」 に送ります/);
    assert.ok(!discordText.includes(DISCORD_TOKEN), "the webhook token is not shown in full");

    // 解除しても Discord 側のウェブフックは消さない。消すかどうかは持ち主が決める。
    await page.click("#discord-unlink");
    await page.waitForSelector("#discord-link-start");
    const afterDiscordUnlink = await page.evaluate(() => ({
      calls: window.__slack.calls,
      settings: window.__slack.store.studylogDashboardPreferencesV1.attendanceWatch
    }));
    assert.deepEqual(afterDiscordUnlink.calls.discordDeletes, [], "the webhook itself is left alone");
    assert.deepEqual(afterDiscordUnlink.calls.permissionRemovals.at(-1), ["https://discord.com/*"]);
    assert.equal(afterDiscordUnlink.settings.discordWebhookUrl, "");
    assert.equal(afterDiscordUnlink.settings.discord, null);
    assert.equal(afterDiscordUnlink.settings.channels.discord, false);

    // 消えたウェブフックには、Discord の理由をそのまま日本語で出す。
    await page.evaluate(() => { window.__slack.discordResponse = { message: "Unknown Webhook", code: 10015 }; });
    await page.fill("#discord-webhook-url", DISCORD_WEBHOOK);
    await page.click("#discord-link-start");
    await page.waitForFunction(() => document.querySelector(".connection-progress[data-service='discord']").textContent.includes("削除されています"));
    assert.equal(await page.locator(`${discordCard} .connection-status`).count(), 0, "a dead webhook is not saved");

    // 出席確認とは関係なく、サイドバーからも同じ画面に入れる。
    await page.click("#connection-dialog [data-close-dialog]");
    await page.click("#attendance-watch-dialog [data-close-dialog]");
    await page.click("#open-connection-dialog");
    await page.waitForSelector("#connection-dialog[open]");
    assert.equal(await page.locator("#connection-dialog .connection-card[data-service='slack']").count(), 1);
    assert.equal(await page.locator("#connection-dialog .connection-card[data-service='discord']").count(), 1);
    assert.equal(await page.locator("#attendance-watch-dialog[open]").count(), 0, "the connection dialog stands on its own");

    assert.deepEqual(errors, [], "the connection dialog must render and run without errors");
    console.log("connections browser smoke test: ok");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
