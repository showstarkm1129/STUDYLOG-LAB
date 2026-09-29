const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { SIZE_SPECS } = require('../dashboard-layout.js');

const courses = Array.from({ length: 20 }, (_, i) => ({ classId: String(i + 1), name: `科目${i + 1}：長い科目名の表示を確認する応用演習`, totalLessons: 30, attended: 12, absent: 2 }));
const snapshot = {
  schemaVersion: 3, collectedAt: '2026-09-24T08:00:00+09:00', courses,
  reports: courses.map(c => ({ classId: c.classId, directoryId: c.classId, title: '長い課題タイトルの表示と操作を確認する提出課題', status: '未完了', kind: '課題', scheduledAt: '2026-09-24', href: `/lms/class/${c.classId}/${c.classId}/` })),
  directories: courses.map(c => ({ classId: c.classId, directoryId: c.classId, lessonDate: '2026-09-24' })),
  timetableSlots: courses.slice(0, 8).map((c, i) => ({ classId: c.classId, courseName: c.name, teacherName: `教師${i + 1}先生`, date: '2026-09-24', period: i + 1, room: '201' }))
};
const server = http.createServer((req, res) => {
  const file = path.join(process.cwd(), new URL(req.url, 'http://localhost').pathname);
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(data => {
    if (localStorage.getItem('test-empty-lists')) data = { ...data, reports: [], directories: [], timetableSlots: [] };
    localStorage.setItem('studylogBridgeSnapshotV1', JSON.stringify(data));
  }, snapshot);
  const url = `http://127.0.0.1:${server.address().port}/dashboard.html?now=2026-09-24T08:00:00`;
  await page.goto(url);
  await page.click('#add-custom-page');
  await page.fill('#page-settings-name', 'サイズ検証');
  await page.click('#page-settings-form button[type="submit"]');
  await page.click('[data-toggle-layout-edit]');
  await page.click('[data-open-card-catalog]');
  const ids = await page.locator('[data-add-card]').evaluateAll(nodes => nodes.map(n => n.dataset.addCard));
  assert.equal(ids.length, 9);
  for (const [i, id] of ids.entries()) {
    if (i) await page.click('[data-open-card-catalog]');
    await page.click(`[data-add-card="${id}"]`);
  }
  assert.match(await page.locator('[data-custom-card="next-course"]').innerText(), /教師1先生/, "the next-course card should show the teacher");
  assert.match(await page.locator('[data-custom-card="today-lessons"]').innerText(), /教師1先生/, "the today-lessons card should show teachers");
  const variants = await page.locator('[data-card-size]:not(:disabled)').evaluateAll(nodes => nodes.map(n => ({ id: n.closest('[data-custom-card]').dataset.customCard, size: n.dataset.cardSize })));
  assert.deepEqual(variants.filter(({ id }) => id === 'today-lessons').map(({ size }) => size), ['medium']);
  assert.deepEqual(variants.filter(({ id }) => id === 'absence-safety').map(({ size }) => size), ['medium']);
  assert.equal(await page.locator('[data-custom-card="completion"] [data-view-target="tasks"]').count(), 1, 'medium completion should link to tasks');
  assert.equal(await page.locator('[data-custom-card="completion"] [data-open-completion-settings]').count(), 1, 'medium completion should expose its settings');
  const failures = [];
  const sharedMarkup = new Map();
  async function inspect(label, selector, expectedSize) {
    const result = await page.locator(selector).evaluate(card => {
      const rect = card.getBoundingClientRect();
      const grid = card.parentElement;
      const style = getComputedStyle(grid);
      const content = card.querySelector('.custom-widget-content');
      const list = card.querySelector(".widget-list");
      const listClipped = list && list.scrollHeight > list.clientHeight + 1;
      const lessonRows = card.dataset.dashboardCard === 'today-lessons' ? [...card.querySelectorAll('.widget-list-row')] : [];
      const lessonsClipped = lessonRows.some(row => row.getBoundingClientRect().bottom > list.getBoundingClientRect().bottom + 1);
      const clipped = content && content.scrollHeight > content.clientHeight + 1 && getComputedStyle(content).overflowY === 'hidden';
      return { width: rect.width, height: rect.height, gridWidth: grid.clientWidth, gap: parseFloat(style.columnGap) || 14, clipped, listClipped, lessonCount: lessonRows.length, lessonsClipped, horizontal: content && content.scrollWidth > content.clientWidth + 1 };
    });
    if (label.includes('today-lessons') && !label.startsWith('empty')) {
      assert.equal(result.lessonCount, 3, `${label}: show three lessons`);
      assert.equal(Boolean(result.listClipped || result.lessonsClipped), false, `${label}: all three lessons must fit without scrolling`);
    }
    if (expectedSize === "medium" && label.endsWith("normal")) assert.equal(Boolean(result.listClipped), false, `${label}: all three summary rows must fit`);
    const spec = SIZE_SPECS[expectedSize];
    const width = (result.gridWidth + result.gap) / 12 * spec.columns - result.gap;
    if (Math.abs(result.height - (spec.rows * 210 + (spec.rows - 1) * 14)) > 1 || Math.abs(result.width - width) > 1 || result.clipped || result.horizontal) failures.push({ label, ...result, expectedWidth: width });
  }
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const { id, size } of variants) {
      const selector = `[data-custom-card="${id}"]`;
      await page.locator(`${selector} [data-card-size="${size}"]`).click();
      await inspect(`${width} ${id} ${size} editing`, selector, size);
      if (width === 1440 && id === 'today-lessons' && process.env.CARD_SCREENSHOTS) {
        fs.mkdirSync(process.env.CARD_SCREENSHOTS, { recursive: true });
        await page.locator(selector).screenshot({ path: path.join(process.env.CARD_SCREENSHOTS, 'today-lessons-medium-editing.png') });
      }
      await page.click('[data-toggle-layout-edit]');
      await inspect(`${width} ${id} ${size} normal`, selector, size);
      if (width === 1440) {
        sharedMarkup.set(`${id}:${size}`, (await page.locator(`${selector} .custom-widget-content`).innerHTML()).replaceAll(' style=""', ''));
        if (process.env.CARD_SCREENSHOTS) {
          fs.mkdirSync(process.env.CARD_SCREENSHOTS, { recursive: true });
          await page.locator(selector).screenshot({ style: ".toast-region { visibility: hidden; }", path: path.join(process.env.CARD_SCREENSHOTS, `${id}-${size}.png`) });
        }
      }
      await page.click('[data-toggle-layout-edit]');
    }
    for (const view of ['home', 'attendance', 'tasks', 'courses']) {
      if (width < 760) await page.click("#menu-toggle");
      await page.click(`[data-view="${view}"]`);
      if (width === 1440 && process.env.CARD_SCREENSHOTS) {
        fs.mkdirSync(process.env.CARD_SCREENSHOTS, { recursive: true });
        await page.screenshot({ style: ".toast-region { visibility: hidden; }", path: path.join(process.env.CARD_SCREENSHOTS, `${view}.png`) });
      }
      const cards = page.locator('#app-view .card, #app-view .course-card');
      for (let i = 0; i < await cards.count(); i++) {
        const card = cards.nth(i);
        const size = await card.evaluate(n => [...n.classList].find(c => c.startsWith('card-size-'))?.replace('card-size-', ''));
        assert(size, `${view} card ${i} must declare a shared size`);
        const id = await card.getAttribute('data-dashboard-card');
        if (id) assert.equal((await card.locator('.custom-widget-content').innerHTML()).replaceAll(' style=""', ''), sharedMarkup.get(`${id}:${size}`), `${view}: ${id} must use identical custom card content`);
        // Standalone task page uses all available width; grid cards share exact columns.
        if (view !== 'tasks') await inspect(`${width} ${view} ${i}`, `#app-view .${view === 'courses' ? 'course-card' : 'card'}:nth-child(${i + 1})`, size);
        else assert.equal(Math.round((await card.boundingBox()).height), 434);
      }
      if (view === 'courses') {
        await cards.first().click();
        await inspect(`${width} course detail tasks`, '#course-dialog .card-size-large', 'large');
        await inspect(`${width} course detail timeline`, '#course-dialog .card-size-medium', 'medium');
        await page.click('[data-close-dialog="course-dialog"]');
      }
    }
    if (width < 760) await page.click("#menu-toggle");
    await page.click('[data-view^="custom-"]');
    await page.click('[data-toggle-layout-edit]');
  }
  // Both placements keep the same task and simulator interactions.
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const view of ['tasks', 'custom']) {
    await page.click(view === 'custom' ? '[data-view^="custom-"]' : '[data-view="tasks"]');
    if (view === 'custom') {
      await page.click('[data-toggle-layout-edit]');
      await page.click('[data-custom-card="pending-overview"] [data-card-size="large"]');
      await page.click('[data-toggle-layout-edit]');
    }
    const inbox = page.locator('[data-dashboard-card="pending-overview"]');
    const toggle = inbox.locator('[data-manual-toggle]').first();
    const key = await toggle.getAttribute('data-manual-toggle');
    await toggle.click();
    await inbox.locator('[data-task-filter="manual"]').click();
    assert.equal(await inbox.locator('[data-manual-toggle]').count(), 1);
    assert.equal(await inbox.locator('[data-manual-toggle]').getAttribute('data-manual-toggle'), key);
    await inbox.locator('[data-manual-toggle]').click();
    await inbox.locator('[data-task-filter="pending"]').click();
    assert.equal(await inbox.locator('[data-manual-toggle]').count(), 20);
  }
  for (const selector of ['[data-view="attendance"]', '[data-view^="custom-"]']) {
    await page.click(selector);
    await page.click('[data-sim-step="1"]');
    assert.equal(await page.locator('#sim-absence').inputValue(), '1');
    await page.click('[data-sim-step="-1"]');
    assert.equal(await page.locator('#sim-absence').inputValue(), '0');
  }
  const directCandidate = page.locator('[data-custom-card="next-candidates"] [data-report-key]').first();
  const directCandidateKey = await directCandidate.getAttribute('data-report-key');
  assert.equal(await directCandidate.locator('[data-manual-toggle]').count(), 1, 'candidate should be directly completable');
  assert.equal(await directCandidate.locator('[data-not-required-toggle]').count(), 1, 'candidate should be directly dismissible');
  assert.equal(await directCandidate.locator('a[target="_blank"]').count(), 1, 'candidate should link directly to the report');
  await directCandidate.locator('[data-manual-toggle]').click();
  assert.equal(await page.locator(`[data-custom-card="next-candidates"] [data-report-key=${JSON.stringify(directCandidateKey)}]`).count(), 0, 'direct completion should remove the candidate');
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.evaluate(() => localStorage.setItem('test-empty-lists', '1'));
  await page.reload();
  await page.click('#menu-toggle');
  await page.click('[data-view^="custom-"]');
  await page.click('[data-toggle-layout-edit]');
  for (const { id, size } of variants) {
    const selector = `[data-custom-card="${id}"]`;
    await page.locator(`${selector} [data-card-size="${size}"]`).click();
    await inspect(`empty ${id} ${size} editing`, selector, size);
    await page.click('[data-toggle-layout-edit]');
    await inspect(`empty ${id} ${size} normal`, selector, size);
    await page.click('[data-toggle-layout-edit]');
  }
  for (const { id, size } of variants) {
    await page.locator(`[data-custom-card="${id}"] [data-card-size="${size}"]`).click();
    sharedMarkup.set(`${id}:${size}`, (await page.locator(`[data-custom-card="${id}"] .custom-widget-content`).innerHTML()).replaceAll(' style=""', ''));
  }
  // Verify the dormant home layout too, without enabling it in the product.
  await page.route('**/dashboard.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('const SHOW_HOME_INSIGHTS = false;', 'const SHOW_HOME_INSIGHTS = true;') });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page.click('[data-view="home"]');
  const homeSizes = await page.locator('#app-view .card').evaluateAll(nodes => nodes.map(n => [...n.classList].find(c => c.startsWith('card-size-')).replace('card-size-', '')));
  assert.equal(homeSizes.length, 5);
  for (const card of await page.locator('#app-view [data-dashboard-card]').all()) {
    const id = await card.getAttribute('data-dashboard-card');
    const size = await card.evaluate(n => [...n.classList].find(c => c.startsWith('card-size-')).replace('card-size-', ''));
    assert.equal((await card.locator('.custom-widget-content').innerHTML()).replaceAll(' style=""', ''), sharedMarkup.get(`${id}:${size}`), `${id}: dormant home must share content too`);
  }
  for (const [i, size] of homeSizes.entries()) await inspect(`home insights ${i}`, `#app-view .card:nth-child(${i + 1})`, size);
  await page.evaluate(() => {
    const key = 'studylogDashboardPreferencesV1';
    const prefs = JSON.parse(localStorage.getItem(key));
    const customPage = prefs.customPages.find(page => page.cards.some(card => card.cardId === 'today-lessons'));
    customPage.cards.find(card => card.cardId === 'today-lessons').size = 'large';
    customPage.cards.find(card => card.cardId === 'absence-safety').size = 'large';
    prefs.startPageId = customPage.id;
    localStorage.setItem(key, JSON.stringify(prefs));
  });
  await page.reload();
  assert.equal(await page.locator('[data-custom-card="today-lessons"].card-size-medium').count(), 1, 'saved large lesson cards should migrate to medium');
  assert.equal(await page.locator('[data-custom-card="absence-safety"].card-size-medium').count(), 1, 'saved large safety cards should migrate to medium');
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, [], JSON.stringify(failures, null, 2));
  console.log(`dashboard card sizes: ${variants.length} variants × 3 widths × normal/edit, plus built-in pages: ok`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.close(); });
