(async () => {
  // 実際に採取した Microsoft の中断画面を、文言・id・役割まで写した土台。
  // 押された操作を試験側から読めるようにする。
  const params = new URLSearchParams(location.search);
  const screen = params.get("screen") || "proofup";

  const SCREENS = {
    // login.microsoftonline.com/<tenant>/saml2 — スキップは存在せず、次へしかない。
    proofup: `
      <h1>アカウントをセキュリティ保護しましょう</h1>
      <p>別の方法で本人確認を行う設定をお手伝いします。</p>
      <a id="cancelLink" href="#">別のアカウントを使用する</a>
      <a id="moreInfoLink" href="#">2 段階認証の詳細</a>
      <input type="submit" id="idSubmit_ProofUp_Redirect" class="win-button button_primary" value="次へ">
      <a id="ftrTerms" href="#">利用規約</a>
      <a id="ftrPrivacy" href="#">プライバシーと Cookie</a>
      <a id="moreOptions" role="button" href="#">トラブルシューティング情報についてはここをクリックしてください</a>`,
    // mysignins.microsoft.com/register — スキップは id も role も持たない button。
    register: `
      <button class="css-181">メイン コンテンツにスキップ</button>
      <h1>Microsoft Authenticator のインストール</h1>
      <p>モバイル デバイスにアプリをインストールしてから、ここに戻って続行します。</p>
      <button class="ms-Link" role="link">別の認証アプリを設定する</button>
      <button class="ms-Link">その他のオプション</button>
      <button class="ms-Link">セットアップをスキップします</button>
      <button class="ms-Button ms-Button--primary">次へ</button>
      <a href="#">Help</a>
      <a href="#">使用条件</a>
      <a href="#">プライバシーと Cookie</a>`,
    // 旧来の「今はスキップ」型。文言が変わっても拾えることを確かめる。
    legacy: `
      <h1>アカウントをセキュリティ保護しましょう</h1>
      <button id="idSIButton9" type="button">次へ</button>
      <a role="button" tabindex="0" id="different-method">別の方法を設定します</a>
      <a role="button" tabindex="0" id="skip">今はスキップ (14 日残っています)</a>`,
    password: `
      <h1>パスワードの入力</h1>
      <input type="password" name="passwd">
      <button id="idSIButton9" type="button">サインイン</button>
      <a role="button" tabindex="0" id="forgot">パスワードを忘れた場合</a>`,
    kmsi: `
      <h1>サインインの状態を維持しますか?</h1>
      <p>これにより、サインインを求められる回数を減らすことができます。</p>
      <input id="KmsiCheckboxField" type="checkbox">
      <label for="KmsiCheckboxField">今後このメッセージを表示しない</label>
      <button id="idBtn_Back" type="button">いいえ</button>
      <button id="idSIButton9" type="button">はい</button>`
  };

  const clicks = [];
  window.studylogClicks = clicks;
  const render = (html) => { document.getElementById("screen").innerHTML = html; };

  document.addEventListener("click", (event) => {
    const control = event.target.closest("button, a, input");
    if (!control) return;
    const name = control.id || (control.textContent || control.value || "").trim();
    clicks.push(name);
    // 実物は押すと次へ進むため、押し直しが起きないよう画面を差し替える。
    if (name === "idSubmit_ProofUp_Redirect" || name === "skip" || name === "セットアップをスキップします") render("<h1>移動しました</h1>");
    if (control.id === "idSIButton9" && screen === "kmsi") render("<h1>移動しました</h1>");
  }, true);

  // 遅れて描画される画面では、スキップが後から現れる場合を再現する。
  if (screen === "delayed") setTimeout(() => render(SCREENS.register), 400);
  else render(SCREENS[screen] || SCREENS.proofup);

  const settings = JSON.parse(params.get("settings") || "null");
  const store = {};
  if (settings) store.studylogMsSigninV1 = settings;
  if (params.get("mark") === "1") store.studylogMsSigninSeenV1 = { at: Date.now() };
  window.studylogTestStore = store;
  window.chrome = {
    storage: {
      local: {
        get(keys, callback) {
          const names = Array.isArray(keys) ? keys : [keys];
          const result = {};
          for (const name of names) if (name in store) result[name] = store[name];
          callback(result);
        },
        set(values, callback) { Object.assign(store, values); callback?.(); },
        remove(keys, callback) {
          for (const name of (Array.isArray(keys) ? keys : [keys])) delete store[name];
          callback?.();
        }
      }
    }
  };

  const loadScript = (src) => new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.addEventListener("load", resolve, { once: true });
    document.head.append(script);
  });
  await loadScript("/ms-signin-rules.js");
  await loadScript("/ms-signin.js");
  document.body.dataset.ready = "1";
})();
