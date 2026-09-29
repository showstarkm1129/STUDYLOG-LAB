(() => {
  "use strict";

  // Slack 連携の「開通」に必要な組み立てと判定だけを持つ。
  // 実際の通信・権限要求・保存は dashboard.js が行い、ここでは通信を伴わない処理だけを扱う。
  //
  // 方式は Slack の OAuth v2（scope は incoming-webhook のみ）である。
  // 手で入力するのは、自分で作った Slack アプリの Client ID と Client Secret の2つだけで、
  // チャンネルの選択・Webhook URL の受け取り・権限の要求・保存はすべて自動で行う。

  const AUTHORIZE_ENDPOINT = "https://slack.com/oauth/v2/authorize";
  const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.access";
  const REVOKE_ENDPOINT = "https://slack.com/api/auth.revoke";
  const APP_DIRECTORY_URL = "https://api.slack.com/apps";
  // 学校のワークスペースが管理者の承認を要求する場合に備えて、自分専用のワークスペースを作る入口も案内する。
  const WORKSPACE_CREATE_URL = "https://slack.com/get-started#/createnew";

  // 受け取るのは「選んだチャンネルへ投稿する」権限だけ。読み取りの権限は求めない。
  const SCOPES = Object.freeze(["incoming-webhook"]);
  // 交換（slack.com）と投稿（hooks.slack.com）で必要になる任意ホスト権限。
  const REQUIRED_ORIGINS = Object.freeze(["https://slack.com/*", "https://hooks.slack.com/*"]);

  const WEBHOOK_PATTERN = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/;
  const CLIENT_ID_PATTERN = /^\d{6,}\.\d{6,}$/;
  const CLIENT_SECRET_PATTERN = /^[0-9a-f]{24,}$/i;
  const REDIRECT_PATTERN = /^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/;

  const APP_NAME = "Studylog Bridge 通知";
  const APP_DESCRIPTION = "出席確認の受付を検知した時に、科目名・時限・リンクだけを指定のチャンネルへ送ります。";

  const text = (value) => String(value ?? "").trim();

  function normalizeClientId(value) {
    return text(value);
  }

  function normalizeClientSecret(value) {
    return text(value);
  }

  // 入力の取り違え（Client ID と Secret の逆貼り、Signing Secret の貼り付け）をその場で弾く。
  function validateCredentials({ clientId, clientSecret } = {}) {
    const id = normalizeClientId(clientId);
    const secret = normalizeClientSecret(clientSecret);
    if (!id) return { ok: false, field: "clientId", message: "Client ID を入力してください。" };
    if (!CLIENT_ID_PATTERN.test(id)) return { ok: false, field: "clientId", message: "Client ID は 1234567890123.1234567890123 のような、数字とピリオドの形です。" };
    if (!secret) return { ok: false, field: "clientSecret", message: "Client Secret を入力してください。" };
    if (CLIENT_ID_PATTERN.test(secret)) return { ok: false, field: "clientSecret", message: "Client Secret の欄に Client ID が入っています。入れ替えて入力してください。" };
    if (!CLIENT_SECRET_PATTERN.test(secret)) return { ok: false, field: "clientSecret", message: "Client Secret は英小文字と数字だけの文字列です。Signing Secret ではなく Client Secret を貼ってください。" };
    return { ok: true, clientId: id, clientSecret: secret };
  }

  function buildRedirectUri(extensionId) {
    const id = text(extensionId);
    return id ? `https://${id}.chromiumapp.org/` : "";
  }

  function isRedirectUri(value) {
    return REDIRECT_PATTERN.test(text(value));
  }

  // Slack アプリの作成画面へ流し込むマニフェスト。権限とリダイレクト先を手で設定しなくて済む。
  function buildAppManifest({ redirectUri, appName = APP_NAME } = {}) {
    return {
      display_information: { name: text(appName).slice(0, 35), description: APP_DESCRIPTION },
      features: { bot_user: { display_name: "Studylog Bridge", always_online: false } },
      oauth_config: {
        redirect_urls: [text(redirectUri)],
        scopes: { bot: [...SCOPES] }
      },
      settings: { org_deploy_enabled: false, socket_mode_enabled: false, token_rotation_enabled: false }
    };
  }

  function buildAppCreateUrl(manifest) {
    const url = new URL(APP_DIRECTORY_URL);
    url.searchParams.set("new_app", "1");
    url.searchParams.set("manifest_json", JSON.stringify(manifest));
    return url.href;
  }

  function buildAuthorizeUrl({ clientId, redirectUri, state } = {}) {
    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set("client_id", normalizeClientId(clientId));
    url.searchParams.set("scope", SCOPES.join(","));
    url.searchParams.set("redirect_uri", text(redirectUri));
    url.searchParams.set("state", text(state));
    return url.href;
  }

  // 戻り先の URL から認可コードだけを取り出す。state が違えば、別の要求への応答として捨てる。
  function parseAuthRedirect(redirectUrl, expectedState) {
    const raw = text(redirectUrl);
    if (!raw) return { ok: false, error: "cancelled", message: describeSlackError("cancelled") };
    let params;
    try {
      const url = new URL(raw);
      params = new URLSearchParams(url.search || url.hash.replace(/^#/, ""));
    } catch {
      return { ok: false, error: "bad-redirect", message: "Slack からの戻り先を読み取れませんでした。" };
    }
    const error = text(params.get("error"));
    if (error) return { ok: false, error, message: describeSlackError(error) };
    const state = text(params.get("state"));
    if (text(expectedState) && state !== text(expectedState)) {
      return { ok: false, error: "state-mismatch", message: describeSlackError("state-mismatch") };
    }
    const code = text(params.get("code"));
    if (!code) return { ok: false, error: "no-code", message: "Slack から許可の合図を受け取れませんでした。" };
    return { ok: true, code };
  }

  function buildTokenExchangeBody({ clientId, clientSecret, code, redirectUri } = {}) {
    const body = new URLSearchParams();
    body.set("client_id", normalizeClientId(clientId));
    body.set("client_secret", normalizeClientSecret(clientSecret));
    body.set("code", text(code));
    body.set("redirect_uri", text(redirectUri));
    return body.toString();
  }

  function buildRevokeBody(accessToken) {
    const body = new URLSearchParams();
    body.set("token", text(accessToken));
    return body.toString();
  }

  // Slack の応答から、保存する値だけを取り出す。ここで取れなければ連携は成立していない。
  function parseTokenResponse(payload, { now = Date.now() } = {}) {
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: "bad-response", message: "Slack からの応答を読み取れませんでした。" };
    }
    if (payload.ok !== true) {
      const error = text(payload.error) || "unknown";
      return { ok: false, error, message: describeSlackError(error) };
    }
    const hook = payload.incoming_webhook || {};
    const webhookUrl = text(hook.url);
    if (!WEBHOOK_PATTERN.test(webhookUrl)) {
      return { ok: false, error: "no-webhook", message: "チャンネルへの送り先を受け取れませんでした。Slack アプリの権限に incoming-webhook が入っているか確認してください。" };
    }
    return {
      ok: true,
      link: {
        webhookUrl,
        channelName: text(hook.channel).replace(/^#/, ""),
        channelId: text(hook.channel_id),
        teamName: text(payload.team?.name),
        teamId: text(payload.team?.id),
        appId: text(payload.app_id),
        configurationUrl: /^https:\/\//.test(text(hook.configuration_url)) ? text(hook.configuration_url) : "",
        accessToken: text(payload.access_token),
        linkedAt: new Date(now).toISOString()
      }
    };
  }

  // 保存済みの連携情報を読み直す。壊れた値や別の URL が混ざっていた場合は、連携なしとして扱う。
  function normalizeLink(stored) {
    const webhookUrl = text(stored?.webhookUrl);
    if (!WEBHOOK_PATTERN.test(webhookUrl)) return null;
    return {
      webhookUrl,
      channelName: text(stored?.channelName).replace(/^#/, ""),
      channelId: text(stored?.channelId),
      teamName: text(stored?.teamName),
      teamId: text(stored?.teamId),
      appId: text(stored?.appId),
      configurationUrl: /^https:\/\//.test(text(stored?.configurationUrl)) ? text(stored.configurationUrl) : "",
      accessToken: text(stored?.accessToken),
      linkedAt: text(stored?.linkedAt)
    };
  }

  // 手貼りされた Webhook URL からでも同じ形の連携情報を作る（以前の設定の引き継ぎ用）。
  function linkFromWebhookUrl(webhookUrl, { now = Date.now() } = {}) {
    const url = text(webhookUrl);
    if (!WEBHOOK_PATTERN.test(url)) return null;
    return normalizeLink({ webhookUrl: url, linkedAt: new Date(now).toISOString() });
  }

  function isWebhookUrl(value) {
    return WEBHOOK_PATTERN.test(text(value));
  }

  // 記録のコピーや画面表示に使う。送り先そのものが秘密なので、末尾は伏せる。
  function maskWebhookUrl(value) {
    const url = text(value);
    if (!WEBHOOK_PATTERN.test(url)) return "";
    const head = url.replace("https://hooks.slack.com/services/", "").split("/")[0] || "";
    return `https://hooks.slack.com/services/${head}/…（以降は伏せています）`;
  }

  function summarizeLink(link) {
    const normalized = normalizeLink(link);
    if (!normalized) return "";
    const channel = normalized.channelName ? `#${normalized.channelName}` : "選んだチャンネル";
    return normalized.teamName ? `${normalized.teamName} の ${channel}` : channel;
  }

  const ERROR_MESSAGES = Object.freeze({
    access_denied: "Slack の画面で許可されなかったため、連携していません。",
    invalid_client_id: "Client ID が違います。Slack アプリの Basic Information にある値を貼り直してください。",
    bad_client_secret: "Client Secret が違います。Slack アプリの Basic Information にある値を貼り直してください。",
    invalid_client_secret: "Client Secret が違います。Slack アプリの Basic Information にある値を貼り直してください。",
    invalid_code: "許可の合図が期限切れです。もう一度「Slack と連携する」からやり直してください。",
    code_already_used: "許可の合図はすでに使われています。もう一度「Slack と連携する」からやり直してください。",
    bad_redirect_uri: "Slack アプリに登録した戻り先が違います。Redirect URL に、この画面に表示されている URL をそのまま登録してください。",
    invalid_grant: "許可の合図が無効です。もう一度やり直してください。",
    invalid_scope: "権限の指定が受け付けられませんでした。Slack アプリの権限に incoming-webhook を入れてください。",
    cancelled: "Slack の画面が閉じられたため、連携を中止しました。",
    "state-mismatch": "連携の途中で応答が入れ替わったため、中止しました。もう一度お試しください。"
  });

  function describeSlackError(code) {
    const key = text(code);
    return ERROR_MESSAGES[key] || `Slack が連携を受け付けませんでした（${key || "理由不明"}）。`;
  }

  globalThis.StudylogSlackLinkRules = Object.freeze({
    AUTHORIZE_ENDPOINT,
    TOKEN_ENDPOINT,
    REVOKE_ENDPOINT,
    APP_DIRECTORY_URL,
    WORKSPACE_CREATE_URL,
    SCOPES,
    REQUIRED_ORIGINS,
    APP_NAME,
    normalizeClientId,
    normalizeClientSecret,
    validateCredentials,
    buildRedirectUri,
    isRedirectUri,
    buildAppManifest,
    buildAppCreateUrl,
    buildAuthorizeUrl,
    parseAuthRedirect,
    buildTokenExchangeBody,
    buildRevokeBody,
    parseTokenResponse,
    normalizeLink,
    linkFromWebhookUrl,
    isWebhookUrl,
    maskWebhookUrl,
    summarizeLink,
    describeSlackError
  });
})();
