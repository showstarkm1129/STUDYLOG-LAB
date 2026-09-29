const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const context = { URL };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync("ms-signin-rules.js", "utf8"), context);
const rules = context.StudylogMsSigninRules;

const LOGIN = "https://login.microsoftonline.com/a4c016dc-0000-0000-0000-000000000000/saml2";
const REGISTER = "https://mysignins.microsoft.com/register";
// 実際に採取した本文。
const PROOF_UP_TEXT = "アカウントをセキュリティ保護しましょう 別の方法で本人確認を行う設定をお手伝いします。 別のアカウントを使用する ID の確認に関する詳細情報";
const REGISTER_TEXT = "メイン コンテンツにスキップ Microsoft Authenticator のインストール モバイル デバイスにアプリをインストールしてから、ここに戻って続行します。 別の認証アプリを設定する その他のオプション セットアップをスキップします 次へ";

// 画面の見分け
assert.equal(rules.assess({ url: LOGIN, text: PROOF_UP_TEXT }).screen, "security-info");
assert.equal(rules.assess({ url: LOGIN, text: PROOF_UP_TEXT }).hostKind, "interrupt");
assert.equal(rules.assess({ url: REGISTER, referrer: LOGIN, text: REGISTER_TEXT }).screen, "security-info");
assert.equal(rules.assess({ url: REGISTER, referrer: LOGIN, text: REGISTER_TEXT }).hostKind, "registration");
assert.equal(rules.assess({ url: LOGIN, text: "サインインの状態を維持しますか?" }).screen, "stay-signed-in");
assert.equal(rules.assess({ url: LOGIN, text: "パスワードの入力" }).screen, "other", "通常のサインイン画面には触れない");
assert.equal(rules.assess({ url: "https://portal.iwasaki.ac.jp/lms/", text: PROOF_UP_TEXT }).screen, "other", "スタログ側では動かない");

// 登録画面は、サインインから飛ばされた時だけ扱う
assert.equal(rules.assess({ url: REGISTER, referrer: "", text: REGISTER_TEXT }).reason, "not-interrupt", "本人が設定しに来た場合は邪魔しない");
assert.equal(rules.assess({ url: REGISTER, referrer: "https://portal.iwasaki.ac.jp/lms/", text: REGISTER_TEXT }).reason, "not-interrupt");
// referrer が落ちるリダイレクトに備えて、直前の中断画面の印でも通す
assert.equal(rules.assess({ url: REGISTER, referrer: "", text: REGISTER_TEXT, recentInterrupt: true }).screen, "security-info");

// 押してよい文言と、押してはいけない文言
assert.equal(rules.labelScore("セットアップをスキップします"), 2, "実物のスキップ操作");
assert.equal(rules.labelScore("今はスキップ (14 日残っています)"), 2);
assert.equal(rules.labelScore("Skip setup"), 2);
assert.equal(rules.labelScore("後で確認する"), 2);
assert.equal(rules.labelScore("スキップ"), 1);
assert.equal(rules.labelScore("メイン コンテンツにスキップ"), 0, "本文へ飛ぶだけの補助リンクは押さない");
assert.equal(rules.labelScore("次へ"), 0);
assert.equal(rules.labelScore("別の認証アプリを設定する"), 0);
assert.equal(rules.labelScore("その他のオプション"), 0);
assert.equal(rules.labelScore("別のアカウントを使用する"), 0);
assert.equal(rules.labelScore("2 段階認証の詳細"), 0);
assert.equal(rules.labelScore("別の方法を設定します"), 0);
assert.equal(rules.labelScore("今すぐダウンロード"), 0);
assert.equal(rules.labelScore("サインイン"), 0);
assert.equal(rules.labelScore("スキップせずに設定する"), 0, "スキップを含んでも設定を進める操作は除外する");
assert.equal(rules.labelScore(""), 0);

// 実物の登録画面から、押してよいものだけを選ぶ
const registerControls = [
  { id: "", label: "メイン コンテンツにスキップ", visible: true },
  { id: "", label: "別の認証アプリを設定する", visible: true },
  { id: "", label: "その他のオプション", visible: true },
  { id: "", label: "セットアップをスキップします", visible: true },
  { id: "", label: "次へ", visible: true }
];
assert.equal(rules.chooseSkip(registerControls).label, "セットアップをスキップします");
assert.equal(rules.chooseSkip([{ label: "今はスキップ", visible: false }]), null, "見えない要素は押さない");
assert.equal(rules.chooseSkip([{ label: "今はスキップ", visible: true, disabled: true }]), null, "無効な要素は押さない");
assert.equal(rules.chooseSkip([{ id: "idSIButton9", label: "次へ", visible: true }]), null);
assert.equal(rules.chooseSkip([]), null);

// 実物の「アカウントをセキュリティ保護しましょう」にはスキップが無い
const proofUpControls = [
  { id: "cancelLink", label: "別のアカウントを使用する", visible: true },
  { id: "moreInfoLink", label: "2 段階認証の詳細", visible: true },
  { id: "idSubmit_ProofUp_Redirect", label: "次へ", visible: true },
  { id: "ftrTerms", label: "利用規約", visible: true }
];
assert.equal(rules.chooseSkip(proofUpControls), null, "スキップは存在しない");
assert.equal(rules.chooseProofUpAdvance(proofUpControls).id, "idSubmit_ProofUp_Redirect");
assert.equal(rules.chooseProofUpAdvance(registerControls), null, "id が無い次へは押さない");
assert.equal(rules.chooseProofUpAdvance([{ id: "idSIButton9", label: "次へ", visible: true }]), null, "別の次へは押さない");
assert.equal(rules.chooseProofUpAdvance([{ id: "idSubmit_ProofUp_Redirect", label: "次へ", visible: false }]), null);

// サインイン状態の維持は「はい」ボタンだけを対象にする
const kmsi = [{ id: "idBtn_Back", label: "いいえ", visible: true }, { id: "idSIButton9", label: "はい", visible: true }];
assert.equal(rules.chooseKeepSignedIn(kmsi).id, "idSIButton9");
assert.equal(rules.chooseKeepSignedIn([{ id: "idSIButton9", label: "次へ", visible: true }]), null, "同じidでも文言が違えば押さない");
assert.equal(rules.chooseKeepSignedIn([{ id: "", label: "はい", visible: true }]), null);

console.log("ms-signin-rules smoke ok");
