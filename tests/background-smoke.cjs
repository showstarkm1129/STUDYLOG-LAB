const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const listeners = {};
const createdTabs = [];
const disabledTabs = [];
const enabledTabs = [];
const chrome = {
  action: {
    onClicked: { addListener(listener) { listeners.clicked = listener; } },
    disable(id) { disabledTabs.push(id); return Promise.resolve(); },
    enable(id) { enabledTabs.push(id); return Promise.resolve(); }
  },
  runtime: {
    getURL(path) { return `chrome-extension://test/${path}`; },
    onMessage: { addListener(listener) { listeners.message = listener; } }
  },
  tabs: { create(options) { createdTabs.push(options); return Promise.resolve(); } }
};

vm.runInNewContext(fs.readFileSync("background.js", "utf8"), { chrome, URL });

listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/content/1/quiz/2/" });
listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/content/1/?module=quiz" });
assert.equal(createdTabs.length, 0, "quiz tabs must not open the dashboard");

listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/" });
listeners.message({ type: "stalog-bridge:open-dashboard", view: "courses" }, { tab: { id: 8 } });
assert.equal(createdTabs.length, 2);
assert.match(createdTabs[1].url, /dashboard\.html\?view=courses$/);

listeners.message({ type: "stalog-bridge:page-mode", quiz: true }, { tab: { id: 8 } });
listeners.message({ type: "stalog-bridge:page-mode", quiz: false }, { tab: { id: 8 } });
assert.deepEqual(disabledTabs, [8]);
assert.deepEqual(enabledTabs, [8]);
console.log("background quiz guard smoke test: ok");
