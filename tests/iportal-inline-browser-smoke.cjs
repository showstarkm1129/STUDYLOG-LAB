const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const root = path.resolve(__dirname, "..");
const files = new Set(["content.css", "iportal-inline.css", "iportal-api.js", "iportal.js", "iportal-inline.js", "iportal.html", "iportal.css", "dashboard.css"]);

function createFixture() {
  const state = { calls: [], failRead: false, read: false };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/portal/api/portalApi.php") {
      const type = url.searchParams.get("type");
      state.calls.push(type);
      res.setHeader("Content-Type", "application/json");
      if (type === "infoviewupdate") {
        if (state.failRead) { res.statusCode = 503; return res.end('{}'); }
        assert.equal(url.searchParams.get("infoCode"), "123");
        state.read = true;
        return res.end('{"result":"success"}');
      }
      return res.end(JSON.stringify({ result: "success", records: [{ infoCode: 123, eventCode: 456, pastinfo: 0,
        viewDateTime: state.read ? "2026-09-29 12:00:00" : "", infoTitle: "動作確認用の記事", categoryName: "お知らせ",
        infoStart: "20260929", name: "検証用", infoDescription: "これは架空の記事です。\nスタログから移動せずに本文を読めます。\nhttps://example.com\n<script>alert(1)</script>", attachedFile1: "案内.pdf" }] }));
    }
    if (url.pathname === "/lms/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.end(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iPORTAL 簡易パネルの検証</title>
        <link rel="stylesheet" href="/content.css"><link rel="stylesheet" href="/iportal-inline.css">
        <style>body{margin:0;font:14px/1.5 sans-serif;color:#333;background:#f6f7f5}.top{background:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ddd}.nav{display:flex;list-style:none;margin:0;padding:0;align-items:center;gap:3px}.btn{display:inline-block;padding:6px 12px;background:#333;color:white;border:0;border-radius:4px;text-decoration:none;font:inherit}main{margin:32px}table{background:white;border-collapse:collapse;width:100%;margin-top:16px}td,th{border:1px solid #ddd;padding:20px}</style>
        <script>const nativeFetch=window.fetch;window.fetch=(url,options)=>nativeFetch(String(url).replace('https://portal.iwasaki.ac.jp',''),options);</script>
        <script src="/iportal-api.js"></script><script src="/iportal.js"></script><script src="/iportal-inline.js"></script></head>
        <body><div class="top"><strong>岩崎学園スタログ · 検証用</strong><ul class="nav navbar-nav navbar-right"><li style="margin-right:3px"><a href="/portal/index.php" class="btn btn-black btn-sm logout" style="background-color:green" id="toportal">iポータルへ</a></li><li><a class="btn" href="/lms/logout/">ログアウト</a></li></ul></div>
        <main><h2>スケジュール</h2><p>簡易パネルの動作確認用ページです。記事と時間割は架空のデータです。</p><table><tr><th>火曜日</th><th>水曜日</th><th>木曜日</th></tr><tr><td>Webフレームワーク</td><td>脆弱性診断</td><td>クラウドコンピューティングⅠ</td></tr></table></main></body></html>`);
    }
    const file = url.pathname.slice(1);
    if (!files.has(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html; charset=utf-8");
    res.end(fs.readFileSync(path.join(root, file)));
  });
  return { server, state };
}

async function test() {
  const { server, state } = createFixture();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/lms/");
    const toggle = page.getByRole("button", { name: "未読記事", exact: true });
    const panel = page.getByRole("dialog");
    await expect(toggle).toBeVisible();
    const buttonBox = await toggle.boundingBox();
    const portalBox = await page.locator("#toportal").boundingBox();
    assert.ok(buttonBox.x + buttonBox.width <= portalBox.x, "記事ボタンはiポータルへの左");
    assert.deepEqual(state.calls, [], "パネルを開くまで通信しない");
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("status")).toContainText("未読 1件");
    assert.deepEqual(state.calls, ["infolistJ"], "一覧取得では既読にしない");
    state.failRead = true;
    await panel.getByRole("button", { name: /動作確認用の記事/ }).click();
    await expect(panel.getByRole("status")).toContainText("取得・更新できませんでした");
    await expect(panel.locator(".portal-item")).toHaveCount(1);
    await expect(panel.locator(".portal-body")).toContainText("<script>alert(1)</script>");
    state.failRead = false;
    await panel.getByRole("button", { name: "既読にする", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("未読 0件");
    await expect(panel.locator(".portal-item")).toHaveCount(0);
    await expect(panel.locator(".portal-body")).toContainText("スタログから移動せずに本文を読めます。");
    await expect(panel.getByRole("link", { name: "案内.pdf" })).toHaveAttribute("href", /zfileDownload\.php\?ph=456&fn=/);
    await panel.getByLabel("未読のみ").uncheck();
    await expect(panel.locator(".portal-item")).toHaveCount(1);
    await panel.getByRole("searchbox").fill("該当しない検索");
    await expect(panel.locator(".portal-item")).toHaveCount(0);
    await panel.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await toggle.click();
    await expect(panel.getByRole("status")).toContainText("未読 0件");
    await expect(panel.locator(".portal-body")).toHaveCount(0);
    await panel.getByRole("button", { name: "記事パネルを閉じる" }).click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    assert.equal(page.url(), base + "/lms/");

    await page.setViewportSize({ width: 390, height: 844 });
    await toggle.click();
    await expect(panel.getByRole("status")).toContainText("未読 0件");
    await panel.getByLabel("未読のみ").uncheck();
    await panel.getByRole("button", { name: /動作確認用の記事/ }).click();
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
    await page.mouse.click(2, 2);
    await expect(panel).toHaveCount(0);
    assert.deepEqual(errors, []);

    // 読み込み完了後にヘッダーを構築・再描画するページでも設置できる。
    const lateHeader = await browser.newPage();
    await lateHeader.goto(base + "/lms/");
    await lateHeader.setContent('<ul id="late-header"></ul>');
    await lateHeader.addScriptTag({ path: path.join(root, "iportal-inline.js") });
    assert.equal(await lateHeader.locator("#studylog-iportal-toggle").count(), 0);
    await lateHeader.evaluate(() => {
      document.querySelector("#late-header").innerHTML = '<li><a id="toportal" href="/portal/index.php">iポータルへ</a></li>';
    });
    await expect(lateHeader.getByRole("button", { name: "未読記事", exact: true })).toBeVisible();
    await lateHeader.evaluate(() => {
      document.querySelector("#late-header").innerHTML = '<li><a id="toportal" href="/portal/index.php">iポータルへ</a></li>';
    });
    await expect(lateHeader.getByRole("button", { name: "未読記事", exact: true })).toHaveCount(1);
    await lateHeader.close();

    // 共有したリーダーの単独ページも取得・描画できる。
    await page.route("https://portal.iwasaki.ac.jp/portal/api/**", route => route.fulfill({ json: { result: "success", records: [] } }));
    await page.goto(base + "/iportal.html");
    await expect(page.getByRole("status")).toContainText("未読 0件 / 全 0件");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    const content = manifest.content_scripts[0];
    assert.ok(content.js.indexOf("iportal-api.js") < content.js.indexOf("iportal.js"));
    assert.ok(content.js.indexOf("iportal.js") < content.js.indexOf("iportal-inline.js"));
    assert.ok(content.css.includes("iportal-inline.css"));
    console.log("iPORTAL inline browser smoke passed");
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { createFixture };
if (require.main === module) test().catch(error => { console.error(error); process.exitCode = 1; });
