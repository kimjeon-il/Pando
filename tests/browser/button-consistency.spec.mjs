import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildUiBundles } from '../../scripts/build-ui-bundle.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const bundles = buildUiBundles(fileURLToPath(root));
const styles = [read('assets/css/app.css'), bundles.main, bundles.modal, read('assets/css/viewer.css')].join('\n');
const sprite = read('apps/editor/editor.html').match(/<svg class="icon-sprite"[^>]*>[\s\S]*?<\/svg>/)[0];
const icon = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 4v16"/></svg>';
const sourceButton = (path, id) => {
  const button = read(path).match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0];
  if (!button) throw new Error(`Missing real button ${path}:${id}`);
  return button;
};
const literalIcons = ['ui', 'assets/js/modules'].flatMap(directory => readdirSync(new URL(directory + '/', root), { recursive: true })
  .filter(file => /\.(html|js)$/.test(file)).flatMap(file => [...read(`${directory}/${file}`).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .filter(match => /<svg\b/.test(match[1]) && !match[1].replace(/<svg\b[\s\S]*?<\/svg>/g, '').replace(/<[^>]*>/g, '').trim())
    .map(match => match[0])));

for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 },
  { width: 390, height: 844 }, { width: 320, height: 700 }]) {
  test(`shared button sizing and icon slots remain aligned at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const mobile = viewport.width < 800 || viewport.height < 500;
    const size = mobile ? 40 : 36;
    await page.goto('/assets/css/app.css');
    await page.setContent(`<style>${styles}
      .fixture { padding:16px; display:grid; gap:16px; align-content:start; }
      html, body { overflow:auto; }
      .app-root { height:auto; min-height:100vh; grid-template-rows:none; overflow:visible; }
      .fixture-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
      .fixture .action-status { position:static; transform:none; }
      .fixture .timeline-controls { position:relative; inset:auto; width:min(23rem,100%); }
      </style>${sprite}<div class="app-root viewer-root" data-layout="${mobile ? viewport.height < 500 ? 'phone-landscape' : 'mobile' : 'wide'}">
      <main class="fixture">
        <div class="fixture-row">${literalIcons.map((markup, i) => markup.replace(/\bid="[^"]*"/, '').replace('<button ', `<button data-icon-check="source-${i}" `)).join('')}</div>
        <div class="fixture-row" id="ordinary-icons">${['icon-btn', 'icon-btn compact', 'sheet-close-btn',
          'icon-btn editor-focus-action', 'icon-btn distribution-entry-delete'].map((classes, i) =>
          `<button class="ui-button ${classes}" data-icon-check="ordinary-${i}" aria-label="시험 ${i}">${icon}</button>`).join('')}</div>
        <div class="surface-header fixture-row">${sourceButton('ui/templates/editor.html', 'modeTaskMinimizeBtn')}
          </div>
        <nav class='topbar-history fixture-row'>${sourceButton('ui/templates/editor.html', 'undoBtn')}${sourceButton('ui/templates/editor.html', 'redoBtn')}</nav>
        <div class='workflow-map-session fixture-row'><div class='mode-draft-actions'>${['modeDraftInsertBtn', 'modeDraftDeleteBtn', 'modeDraftRedrawBtn', 'modeDraftDoneBtn'].map(id => sourceButton('ui/templates/editor.html', id)).join('')}</div>
          <button class='ui-button icon-btn workflow-result-remove' data-icon-check='result-remove' aria-label='선택 제외'>${icon}</button></div>
        <div class="surface-editor fixture-row"><button class="ui-button icon-btn editor-relation-focus" data-icon-check="relation" aria-label="위치">${icon}</button></div>
        <div class='ui-search-field'><span></span><input type='search' aria-label='검색'><button class='ui-button ui-icon-button ui-search-clear' data-icon-check='clear' aria-label='검색 지우기'>${icon}</button></div>
        <div class="action-status ui-toast"><span></span><strong>완료</strong>${sourceButton('ui/fragments/notification.html', 'notificationCloseBtn')}</div>
        <div class="territorial-library-time-control">${sourceButton('ui/templates/editor.html', 'territorialLibraryTimeSuggestBtn')}
          <input class="ui-input" aria-label="자료 시점" value="1989-04-25"></div>
        ${read('ui/fragments/timeline.html')}
        <div class="fixture-row"><button id="mixed" class="ui-button btn">${icon}<span>이미지 추가</span></button>
          <div class="ui-menu-list"><button id="menu" class="ui-button btn ghost ui-menu-item">${icon}<span>프로젝트 불러오기</span></button></div></div>
        <button id="command" class="ui-button editor-action-row has-command-row-icon">${icon.replace('ui-icon', 'ui-icon command-row-icon')}
          <span><strong>영역 선택</strong><small>선택한 객체에서 실행</small></span>${icon}</button>
      </main></div>`);
    const checks = '[data-icon-check], #ordinary-icons ~ .topbar-history button, .mode-draft-actions button, #modeTaskMinimizeBtn, #notificationCloseBtn, #territorialLibraryTimeSuggestBtn, .timeline-step';
    const metrics = () => page.locator(checks).evaluateAll(elements => elements.filter(button => button.getBoundingClientRect().width > 0).map(button => {
      const box = button.getBoundingClientRect(), svg = button.querySelector('svg').getBoundingClientRect();
      return { name: button.id || button.dataset.iconCheck, width: box.width, height: box.height,
        dx: svg.x + svg.width / 2 - box.x - box.width / 2,
        dy: svg.y + svg.height / 2 - box.y - box.height / 2, iconWidth: svg.width };
    }));
    for (const value of await metrics()) {
      expect(value.width, `${value.name} width`).toBe(size);
      expect(value.height, `${value.name} height`).toBe(size);
      expect(Math.abs(value.dx), `${value.name} horizontal center`).toBeLessThanOrEqual(1);
      expect(Math.abs(value.dy), `${value.name} vertical center`).toBeLessThanOrEqual(1);
      expect(value.iconWidth, `${value.name} icon size`).toBe(16);
    }
    const mixed = await page.locator('#mixed').evaluate(button => {
      const r = button.getBoundingClientRect(), [svg, text] = [...button.children].map(e => e.getBoundingClientRect());
      return { dx: (svg.left + text.right) / 2 - (r.left + r.right) / 2, dy: (svg.top + svg.bottom - text.top - text.bottom) / 2 };
    });
    expect(Math.abs(mixed.dx)).toBeLessThanOrEqual(1); expect(Math.abs(mixed.dy)).toBeLessThanOrEqual(1);
    for (const id of ['menu', 'command']) {
      const slots = await page.locator(`#${id}`).evaluate(button => {
        const r = button.getBoundingClientRect(), svg = button.querySelector('svg').getBoundingClientRect();
        return { dx: svg.x + svg.width / 2 - r.x - r.width / 2,
          dy: svg.y + svg.height / 2 - r.y - r.height / 2, textAlign: getComputedStyle(button).textAlign };
      });
      expect(slots.dx).toBeLessThan(-8); expect(Math.abs(slots.dy)).toBeLessThanOrEqual(1);
      expect(slots.textAlign).toBe('left');
    }
    await page.screenshot({ path: info.outputPath(`button-types-${viewport.width}.png`), fullPage: true });
    const before = await metrics();
    await page.locator('[data-icon-check="ordinary-0"]').hover();
    await page.locator('[data-icon-check="ordinary-0"]').focus();
    await page.locator(checks).evaluateAll(buttons => { for (const button of buttons) { button.disabled = true; button.setAttribute('aria-pressed', 'true'); } });
    expect(await metrics()).toEqual(before);
    expect(await page.locator('.timeline-controls').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  });
}
