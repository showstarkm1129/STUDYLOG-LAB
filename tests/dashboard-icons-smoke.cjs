const assert = require("node:assert/strict");
const icons = require("../dashboard-icons.js");

assert(icons.ICONS.length >= 40, "the picker should provide a useful range of icons");
assert.equal(new Set(icons.ICONS.map((icon) => icon.id)).size, icons.ICONS.length, "icon ids must be unique");
assert(icons.ICONS.every((icon) => icon.id && icon.glyph && icon.label), "every icon needs an id, glyph, and accessible label");
assert(icons.ICONS.every((icon) => !/[\u{1F300}-\u{1FAFF}]/u.test(icon.glyph)), "dashboard icons must not use color emoji glyphs");
assert.equal(icons.resolve("home").glyph, "⌂");
assert.equal(icons.resolve("✓").id, "tasks", "legacy glyphs should resolve to catalog ids");
assert.equal(icons.resolve("📚").id, "books", "saved emoji glyphs should migrate to monochrome icons");
assert.equal(icons.resolve("not-a-real-icon").id, "dashboard", "unknown saved icons should fall back safely");

console.log(`dashboard icons smoke test: ok (${icons.ICONS.length} icons)`);
