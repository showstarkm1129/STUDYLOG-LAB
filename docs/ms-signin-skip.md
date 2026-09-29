# Microsoft サインインの追加設定を飛ばす

## 目的

スタログのログインは Microsoft (Entra ID) を経由する。ログインのたびに「アカウントをセキュリティ保護しましょう」が割り込み、進むと「Microsoft Authenticator のインストール」へ誘導される。これを毎回手で閉じる手間をなくす。

やるのは、Microsoft 自身が用意している **「次へ」と「セットアップをスキップします」を押すこと** だけである。認証を回避するものではなく、パスワードやコードには一切触れない。学校側が登録を必須にした時点でスキップの選択肢そのものが消えるため、その場合は素直に登録するしかない。

## 実際の2画面

採取した実物は次のとおりで、**1枚目にはスキップが存在しない**。

| | 1枚目 | 2枚目 |
| --- | --- | --- |
| URL | `login.microsoftonline.com/<tenant>/saml2` | `mysignins.microsoft.com/register` |
| 見出し | アカウントをセキュリティ保護しましょう | Microsoft Authenticator のインストール |
| 押すもの | `#idSubmit_ProofUp_Redirect`（次へ） | 「セットアップをスキップします」 |
| 他の操作 | 別のアカウントを使用する / 2 段階認証の詳細 | 別の認証アプリを設定する / その他のオプション / 次へ |

1枚目の「次へ」は登録を始めるボタンではなく、2枚目へ移すだけのリダイレクト（ProofUp）である。そのため文言ではなく **id で限定して** 許可している。他の「次へ」は id が違うので押さない。

2枚目のスキップは id も `role` も持たない `<button class="ms-Link">` で、同じ画面に「メイン コンテンツにスキップ」というスキップリンクも並ぶ。文言だけが手がかりになるため、そこを間違えないことが判定の要になっている。

## 動く条件

次の3つがすべて成り立ったときだけ操作する。

1. 画面のURLが Microsoft のサインイン系ホストであること。
   - 常に対象: `login.microsoftonline.com` / `login.microsoft.com` / `login.windows.net`
   - サインインから飛ばされた場合だけ対象: `mysignins.microsoft.com` / `account.activedirectory.windowsazure.com`
2. 本文に「アカウントをセキュリティ保護」「詳細情報が必要」「Microsoft Authenticator」などの文言があること。パスワード入力画面では動かない。
3. 押す候補が、スキップだと判断できる文言か、ProofUp の id を持つこと。

自分で MFA を設定しに `mysignins.microsoft.com` を開いた場合は、直前の画面がサインインではないため何もしない。設定したくなったときに邪魔をしない、という線引きである。リダイレクトで `document.referrer` が落ちる場合に備え、1枚目を見たときに `studylogMsSigninSeenV1` へ印を残し、2分以内に登録画面へ着いたときはこれも根拠として使う。印は一度使うと消す。

## 押す・押さないの判断

| 文言・id | 判断 |
| --- | --- |
| セットアップをスキップします / 今はスキップ / Skip setup / 後で確認する | 押す（明示的なスキップ） |
| スキップ / Skip / Not now | 押す（弱い一致。明示的なものがあればそちらを優先） |
| `#idSubmit_ProofUp_Redirect` | 押す（1枚目のみ。スキップが見つからなかったときだけ） |
| メイン コンテンツにスキップ | 押さない（本文へ飛ぶだけの補助リンク） |
| 次へ / サインイン / 今すぐダウンロード / 別の認証アプリを設定する / 別の方法を設定します | 押さない |
| スキップせずに設定する | 押さない（スキップ語を含んでも設定を進める側） |

判定は [ms-signin-rules.js](../ms-signin-rules.js) にまとめてある。押すのは1画面につき最大3回まで、間隔は1.2秒以上空ける。画面を見張るのは読み込みから30秒間だけで、その後は何もしない。

## 設定

`chrome.storage.local` の `studylogMsSigninV1` に持つ。

| キー | 既定 | 内容 |
| --- | --- | --- |
| `skipSecurityInfo` | `true` | セキュリティ情報の登録画面をスキップする |
| `advanceProofUp` | `true` | スキップが無い1枚目で、2枚目へ進む「次へ」を押す |
| `keepSignedIn` | `false` | 「サインインの状態を維持しますか?」で「はい」を押す |
| `lastAction` | — | 最後に押した内容の記録（動作確認用） |

ダッシュボードの DevTools コンソールから切り替えられる。

```js
chrome.storage.local.set({ studylogMsSigninV1: { skipSecurityInfo: true, advanceProofUp: true, keepSignedIn: true } })
```

`advanceProofUp` を切ると1枚目は手で「次へ」を押すことになる。学校側が登録を必須にしてスキップが消えている場合、自動で進むと1枚目にあった「別のアカウントを使用する」に戻れなくなるため、そのときはここを `false` にするとよい。`skipSecurityInfo` が `false` のときは `advanceProofUp` も働かない（進んだ先で閉じられないため）。

`keepSignedIn` を有効にすると「今後このメッセージを表示しない」にチェックを入れてから「はい」を押す。サインインの有効期間が延び、ログイン画面自体に飛ばされる回数が減るため、割り込みに出会う機会も減る。ただし共用端末では、そのブラウザに他人がアクセスできる状態でログインが残る。既定を `false` にしてあるのはこのためで、自分だけが使う端末で有効にすること。

## うまく動かない場合

スキップが押されないときは、その画面の DevTools コンソールに次が出ている。

```
[studylog:ms-signin] スキップできる操作が見つかりません (押せる文言の一覧)
```

一覧にスキップらしき文言があるのに押されていなければ、判定表に文言が足りていない。文言を [ms-signin-rules.js](../ms-signin-rules.js) の `STRONG_SKIP` に足す。一覧そのものにスキップが無ければ、学校側が登録を必須にしているか、猶予期間が切れている。この場合は拡張機能側でできることはない。

押した記録は `[studylog:ms-signin] security-info: 「セットアップをスキップします」を押しました` として残る。1枚目は `proof-up:` として残る。

## 試験

- [tests/ms-signin-rules-smoke.cjs](../tests/ms-signin-rules-smoke.cjs): 画面の見分けと文言の判断。
- [tests/ms-signin-browser-smoke.cjs](../tests/ms-signin-browser-smoke.cjs): 実際のブラウザで、どれを押すかを確認する。相手にする [tests/ms-signin.html](../tests/ms-signin.html) は、採取した実物の文言・id・class をそのまま写したもの。2枚目は `mysignins.microsoft.com` として配信し、`referer` の有無で挙動が変わることまで確かめている。
