const assert = require("node:assert/strict");
const layout = require("../dashboard-layout.js");

const definitions = [
  { id: "summary", allowedSizes: ["small", "medium"], defaultSize: "medium" },
  { id: "table", allowedSizes: ["large"], defaultSize: "large" }
];

const normalized = layout.normalizePreferences({
  customPages: [
    {
      id: "custom-study",
      name: "  学習チェック  ",
      icon: "✓",
      cards: [
        { cardId: "summary", size: "large" },
        { cardId: "summary", size: "small" },
        { cardId: "table", size: "small" },
        { cardId: "missing", size: "small" }
      ]
    }
  ],
  pageOrder: ["custom-study", "courses", "home", "custom-study", "unknown"],
  lastPageId: "custom-study"
}, definitions);

assert.equal(normalized.layoutSchemaVersion, 2);
assert.deepEqual(normalized.pageOrder, ["custom-study", "courses", "home", "tasks", "attendance"]);
assert.equal(normalized.lastPageId, "custom-study");
assert.equal(normalized.startPageId, "home", "existing users should start on home until they choose another tab");
assert.deepEqual(normalized.customPages, [{
  id: "custom-study",
  name: "学習チェック",
  icon: "✓",
  cards: [
    { cardId: "summary", size: "medium", x: 1, y: 1 },
    { cardId: "table", size: "large", x: 1, y: 2 }
  ]
}]);

const retiredCardLayout = layout.normalizePreferences({
  customPages: [{
    id: "custom-retired-card",
    name: "旧カード",
    icon: "◇",
    cards: [
      { cardId: "course-health", size: "medium", x: 1, y: 1 },
      { cardId: "summary", size: "small", x: 7, y: 1 }
    ]
  }]
}, definitions);
assert.deepEqual(retiredCardLayout.customPages[0].cards, [
  { cardId: "summary", size: "small", x: 7, y: 1 }
], "saved layouts should discard removed widgets");

const freeLayout = layout.normalizePreferences({
  customPages: [{
    id: "custom-free",
    name: "自由配置",
    icon: "◇",
    cards: [
      { cardId: "summary", size: "small", x: 5, y: 4 },
      { cardId: "table", size: "large", x: 1, y: 6 }
    ]
  }]
}, definitions).customPages[0].cards;
assert.deepEqual(freeLayout, [
  { cardId: "summary", size: "small", x: 5, y: 4 },
  { cardId: "table", size: "large", x: 1, y: 6 }
], "intentional gaps must be preserved");

const selectedStartPage = layout.normalizePreferences({
  customPages: [{ id: "custom-free", name: "自由配置", icon: "◇", cards: [] }],
  startPageId: "custom-free"
}, definitions);
assert.equal(selectedStartPage.startPageId, "custom-free");
assert.equal(layout.normalizePreferences({ startPageId: "missing" }, definitions).startPageId, "home");
assert.equal(layout.gridRows(freeLayout, 6), 7);
assert(layout.isPositionFree(freeLayout, { cardId: "new", size: "small", x: 1, y: 1 }));
assert(!layout.isPositionFree(freeLayout, { cardId: "new", size: "medium", x: 4, y: 4 }));
assert.deepEqual(layout.findOpenPosition(freeLayout, "small", { x: 5, y: 4 }), { x: 9, y: 4 });
assert.deepEqual(layout.pointToGridPosition({
  pointerX: 454,
  pointerY: 772,
  gridLeft: 0,
  gridTop: 0,
  gridWidth: 1200,
  columnGap: 12,
  rowGap: 14,
  offsetX: 50,
  offsetY: 100,
  size: "small"
}), { x: 5, y: 4 }, "the preview must follow the pointer instead of snapping to the first cell");

assert.deepEqual(
  layout.reorder(["home", "tasks", "attendance", "courses"], "courses", "home"),
  ["courses", "home", "tasks", "attendance"]
);
assert.deepEqual(
  layout.reorder([{ cardId: "a" }, { cardId: "b" }, { cardId: "c" }], "c", "a", (card) => card.cardId),
  [{ cardId: "c" }, { cardId: "a" }, { cardId: "b" }]
);

const id = layout.createPageId(["custom-loyw3v280"], 1_700_000_000_000, 0.25);
assert.match(id, /^custom-/);
assert.notEqual(id, "custom-loyw3v280");

console.log("dashboard layout smoke test: ok");
