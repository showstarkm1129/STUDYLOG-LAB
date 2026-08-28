const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");

const listeners = {};
const createdTabs = [];
const disabledTabs = [];
const enabledTabs = [];
const localState = {};
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
  tabs: { create(options) { createdTabs.push(options); return Promise.resolve(); } },
  storage: {
    local: {
      async get(key) { return { [key]: localState[key] }; },
      async set(values) { Object.assign(localState, values); }
    }
  }
};

vm.runInNewContext(fs.readFileSync("background.js", "utf8"), { chrome, URL, crypto: { randomUUID: () => "test-uuid" } });

listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/content/1/quiz/2/" });
listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/content/1/?module=quiz" });
assert.equal(createdTabs.length, 0, "quiz tabs must not open the dashboard");

listeners.clicked({ url: "https://portal.iwasaki.ac.jp/lms/" });
listeners.message({ type: "studylog-bridge:open-dashboard", view: "courses" }, { tab: { id: 8 } });
assert.equal(createdTabs.length, 2);
assert.match(createdTabs[1].url, /dashboard\.html\?view=courses$/);

listeners.message({ type: "studylog-bridge:page-mode", quiz: true }, { tab: { id: 8 } });
listeners.message({ type: "studylog-bridge:page-mode", quiz: false }, { tab: { id: 8 } });
assert.deepEqual(disabledTabs, [8]);
assert.deepEqual(enabledTabs, [8]);

const sendMessage = (message) => new Promise((resolve) => listeners.message(message, { tab: { id: 8 } }, resolve));
(async () => {
  const first = await sendMessage({ type: "studylog-bridge:auto-collection-acquire", leaseMs: 300000 });
  const second = await sendMessage({ type: "studylog-bridge:auto-collection-acquire", leaseMs: 300000 });
  assert.equal(first.granted, true);
  assert.equal(second.granted, false, "a second tab must not acquire the active automatic collection lease");
  assert.equal((await sendMessage({ type: "studylog-bridge:auto-collection-release", leaseId: first.leaseId })).released, true);
  assert.equal((await sendMessage({ type: "studylog-bridge:auto-collection-acquire", leaseMs: 300000 })).granted, true);
  console.log("background quiz guard and collection lease smoke test: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
