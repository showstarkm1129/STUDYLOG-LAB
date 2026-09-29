const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const dependencyRoot = process.argv[2];
const { chromium } = require(dependencyRoot ? path.join(dependencyRoot, "playwright") : "playwright");
const root = path.resolve(__dirname, "..");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://login.microsoftonline.com").pathname;
  const filename = path.resolve(root, decodeURIComponent(pathname).replace(/^\/+/, ""));
  if (!filename.startsWith(`${root}${path.sep}`) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    response.writeHead(404).end("not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(filename)] || "application/octet-stream" });
  fs.createReadStream(filename).pipe(response);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clicks = (page) => page.evaluate(() => window.studylogClicks || []);
const store = (page) => page.evaluate(() => window.studylogTestStore);

const SKIP_LABEL = "セットアップをスキップします";

async function waitFor(check, message, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(`timed out: ${message}`);
}

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({
    headless: true,
    args: ["--host-resolver-rules=MAP login.microsoftonline.com 127.0.0.1, MAP mysignins.microsoft.com 127.0.0.1"]
  });
  const LOGIN_ORIGIN = `http://login.microsoftonline.com:${port}`;
  const REGISTER_ORIGIN = `http://mysignins.microsoft.com:${port}`;

  // origin は画面が置かれているホスト、referer はそこへ飛ばした元のページ。
  const open = async (query, { origin = LOGIN_ORIGIN, referer } = {}) => {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.goto(`${origin}/tests/ms-signin.html${query}`, referer ? { referer } : undefined);
    await page.waitForSelector("body[data-ready='1']");
    return page;
  };
  const fromSignin = { origin: REGISTER_ORIGIN, referer: `${LOGIN_ORIGIN}/tenant/saml2` };

  try {
    // 1枚目。スキップが無いので、Microsoft 自身の次へで登録画面まで進める。
    const proofUp = await open("");
    await waitFor(async () => (await clicks(proofUp)).length >= 1, "アカウント保護の画面では次へを押す");
    await wait(1500);
    assert.deepEqual(await clicks(proofUp), ["idSubmit_ProofUp_Redirect"], "押すのは ProofUp の次へだけで、しかも1回だけ");
    const afterProofUp = await store(proofUp);
    assert.equal(afterProofUp.studylogMsSigninV1?.lastAction?.screen, "proof-up", "押した内容を記録する");
    assert.ok(afterProofUp.studylogMsSigninSeenV1?.at, "サインインから来たことを登録画面側に伝える");
    await proofUp.close();

    // 2枚目。サインインから飛ばされてきた登録画面ではスキップを押す。
    const register = await open("?screen=register", fromSignin);
    await waitFor(async () => (await clicks(register)).length >= 1, "登録画面ではスキップを押す");
    await wait(1500);
    assert.deepEqual(await clicks(register), [SKIP_LABEL], "次へ・別の認証アプリ・本文へのスキップは押さない");
    assert.equal((await store(register)).studylogMsSigninV1?.lastAction?.screen, "security-info");
    await register.close();

    // 自分で設定しに来た場合は邪魔しない。
    const visited = await open("?screen=register", { origin: REGISTER_ORIGIN });
    await wait(1500);
    assert.deepEqual(await clicks(visited), [], "自分で開いた登録画面には触れない");
    await visited.close();

    // referer が落ちるリダイレクトでも、直前の印があれば中断とみなす。
    const marked = await open("?screen=register&mark=1", { origin: REGISTER_ORIGIN });
    await waitFor(async () => (await clicks(marked)).length >= 1, "印があればスキップを押す");
    assert.deepEqual(await clicks(marked), [SKIP_LABEL]);
    assert.equal((await store(marked)).studylogMsSigninSeenV1, undefined, "使った印は消す");
    await marked.close();

    // 後から描画される場合。
    const delayed = await open("?screen=delayed", fromSignin);
    await waitFor(async () => (await clicks(delayed)).length >= 1, "後から現れるスキップも押す");
    assert.deepEqual(await clicks(delayed), [SKIP_LABEL]);
    await delayed.close();

    // 旧来の「今はスキップ」型でも動く。
    const legacy = await open("?screen=legacy");
    await waitFor(async () => (await clicks(legacy)).length >= 1, "今はスキップ型も押す");
    await wait(1500);
    assert.deepEqual(await clicks(legacy), ["skip"], "スキップがあれば次へは押さない");
    await legacy.close();

    const password = await open("?screen=password");
    await wait(1500);
    assert.deepEqual(await clicks(password), [], "通常のサインイン画面では何も押さない");
    await password.close();

    const noAdvance = await open(`?settings=${encodeURIComponent(JSON.stringify({ skipSecurityInfo: true, advanceProofUp: false }))}`);
    await wait(1500);
    assert.deepEqual(await clicks(noAdvance), [], "次へだけ切ることもできる");
    await noAdvance.close();

    const disabled = await open(`?screen=register&settings=${encodeURIComponent(JSON.stringify({ skipSecurityInfo: false }))}`, fromSignin);
    await wait(1500);
    assert.deepEqual(await clicks(disabled), [], "設定を切れば何もしない");
    await disabled.close();

    const kmsiOff = await open("?screen=kmsi");
    await wait(1500);
    assert.deepEqual(await clicks(kmsiOff), [], "サインイン状態の維持は既定では触らない");
    await kmsiOff.close();

    const kmsiOn = await open(`?screen=kmsi&settings=${encodeURIComponent(JSON.stringify({ skipSecurityInfo: true, keepSignedIn: true }))}`);
    await waitFor(async () => (await clicks(kmsiOn)).includes("idSIButton9"), "設定を入れれば「はい」を押す");
    assert.deepEqual(await clicks(kmsiOn), ["KmsiCheckboxField", "idSIButton9"], "次回から出さない指定をしてから「はい」を押す");
    await kmsiOn.close();

    console.log("ms-signin browser smoke ok");
  } finally {
    await browser.close();
    server.close();
  }
})();
