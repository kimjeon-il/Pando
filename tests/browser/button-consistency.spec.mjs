import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { buildUiBundles } from '../../scripts/build-ui-bundle.mjs';
import { buildFrontendIndex, frontendAsset } from '../../scripts/lib/frontend-layout.mjs';
import { renderProductHtml } from '../../scripts/lib/product-html.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const sourceRoot = fileURLToPath(root), sourceIndex = buildFrontendIndex(sourceRoot);
const bundles = buildUiBundles(sourceRoot, { readSource: path => frontendAsset(sourceRoot, path, { index: sourceIndex }).bytes.toString('utf8') });
const styles = [read('shared/frontend/css/app.css'), bundles.main, bundles.modal, read('apps/viewer/css/viewer.css')].join('\n');
const products = renderProductHtml(read);
const sprite = products.editor.match(/<svg class="icon-sprite"[^>]*>[\s\S]*?<\/svg>/)[0];
const icon = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M12 4v16"/></svg>';
const sourceButton = (path, id) => {
  const source = path === 'apps/editor/templates/index.html' ? products.editor : read(path);
  const button = source.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`))?.[0];
  if (!button) throw new Error(`Missing real button ${path}:${id}`);
  return button;
};
const literalIcons = ['shared/frontend/ui', 'shared/frontend/js/modules', 'apps/viewer/js/modules', 'apps/editor/frontend/js/modules'].flatMap(directory => readdirSync(new URL(directory + '/', root), { recursive: true })
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
        <div class="surface-header fixture-row">${sourceButton('apps/editor/templates/index.html', 'modeTaskMinimizeBtn')}
          </div>
        <nav class='topbar-history fixture-row'>${sourceButton('apps/editor/templates/index.html', 'undoBtn')}${sourceButton('apps/editor/templates/index.html', 'redoBtn')}</nav>
        <div class='workflow-map-session fixture-row'><div class='mode-draft-actions'>${['modeDraftInsertBtn', 'modeDraftDeleteBtn', 'modeDraftRedrawBtn', 'modeDraftDoneBtn'].map(id => sourceButton('apps/editor/templates/index.html', id)).join('')}</div>
          <button class='ui-button icon-btn workflow-result-remove' data-icon-check='result-remove' aria-label='선택 제외'>${icon}</button></div>
        <div class="surface-editor fixture-row"><button class="ui-button icon-btn editor-relation-focus" data-icon-check="relation" aria-label="위치">${icon}</button></div>
        <div class='ui-search-field'><span></span><input type='search' aria-label='검색'><button class='ui-button ui-icon-button ui-search-clear' data-icon-check='clear' aria-label='검색 지우기'>${icon}</button></div>
        <div class="action-status ui-toast"><span></span><strong>완료</strong>${sourceButton('shared/frontend/ui/fragments/notification.html', 'notificationCloseBtn')}</div>
        <div class="territorial-library-time-control">${sourceButton('apps/editor/templates/index.html', 'territorialLibraryTimeSuggestBtn')}
          <input class="ui-input" aria-label="자료 시점" value="1989-04-25"></div>
        ${read('shared/frontend/ui/fragments/timeline.html')}
        <div class="ui-dialog-actions"><button id="baselineAction" class="ui-button btn">이동</button></div>
        <select id="hiddenSelectProxy" class="ui-input ui-native-select" aria-hidden="true" tabindex="-1"><option>선택</option></select>
        <div class="fixture-row"><button id="mixed" class="ui-button btn">${icon}<span>이미지 추가</span></button>
          <div class="ui-menu-list"><button id="menu" class="ui-button btn ghost ui-menu-item">${icon}<span>프로젝트 불러오기</span></button></div></div>
        <button id="command" class="ui-button editor-action-row has-command-row-icon">${icon.replace('ui-icon', 'ui-icon command-row-icon')}
          <span><strong>영역 선택</strong><small>선택한 객체에서 실행</small></span>${icon}</button>
      </main></div>`);
    await page.locator('#timelineDateButtonText').evaluate(node => { node.textContent = '기원전 44년'; });
    await page.locator('#timelineDateBasis').evaluate(node => { node.textContent = '연말 기준'; });
    const dateHeight = await page.locator('#timelineDateButton').evaluate(node => node.getBoundingClientRect().height);
    expect(dateHeight, 'date text keeps common line height and may grow to fit both lines').toBeGreaterThanOrEqual(mobile ? 48 : 36);
    await page.locator('#timelinePopover').evaluate(node => { node.hidden = false; });
    await page.locator('#timelineMonthFields').evaluate(node => { node.hidden = false; });
    const buttonStyle = id => page.locator(`#${id}`).evaluate(node => {
      const style = getComputedStyle(node);
      return { height: node.getBoundingClientRect().height, radius: style.borderRadius, font: style.fontSize };
    });
    expect(await buttonStyle('timelineGoBtn')).toEqual(await buttonStyle('baselineAction'));
    expect(await page.locator('#hiddenSelectProxy').evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))).toEqual({width:1,height:1});
    for (const id of ['timelineViewUnit', 'timelineYearInput', 'timelineMonthInput', 'timelineGoBtn']) {
      expect((await buttonStyle(id)).height, `${id} ordinary control minimum`).toBeGreaterThanOrEqual(mobile ? 48 : 36);
    }
    const checks = '[data-icon-check], #ordinary-icons ~ .topbar-history button, .mode-draft-actions button, #modeTaskMinimizeBtn, #notificationCloseBtn, #territorialLibraryTimeSuggestBtn, .timeline-step, .timeline-month-navigation .icon-btn';
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
    await page.locator('#timelinePopover').evaluate(node => { node.hidden = true; });
    expect(await page.locator('.timeline-controls').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
  test(`real custom color controls share dimensions and type at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/assets/css/app.css');
    await page.setContent(`<style>${styles} html,body { overflow:auto; } .app-root { height:auto; min-height:100vh; }
      .ui-color-popover { position:static; width:min(20rem,100%); }</style>${sprite}
      <div class="app-root" data-layout="${viewport.width < 800 ? 'mobile' : 'wide'}"><div class="ui-color-popover is-custom"></div></div>`);
    await page.evaluate(async () => {
      const { createCustomColorControl } = await import('/assets/js/modules/custom-color-control.js');
      const control = createCustomColorControl({ onApply() {}, onCancel() {} });
      document.querySelector('.ui-color-popover').append(control.element);
      control.open('#316fd3');
    });
    const metrics = await page.locator('.ui-custom-color').evaluate(root => {
      const close = root.querySelector('.icon-btn'), box = close.getBoundingClientRect(), icon = close.querySelector('svg').getBoundingClientRect();
      return { close: { width: box.width, height: box.height, dx: icon.x + icon.width / 2 - box.x - box.width / 2,
        dy: icon.y + icon.height / 2 - box.y - box.height / 2 },
        types: [...root.querySelectorAll('.ui-button,.ui-field > span,.ui-field input')].map(e => ({ text:e.textContent.trim()||e.getAttribute('aria-label'),font:getComputedStyle(e).fontSize,line:getComputedStyle(e).lineHeight })),
        ordinary: [...root.querySelectorAll('.ui-button:not(.icon-btn),.ui-field input')].map(e => e.getBoundingClientRect().height) };
    });
    const size = viewport.width < 800 ? 40 : 36, height = viewport.width < 800 ? 48 : 36;
    expect(metrics.close.width).toBe(size); expect(metrics.close.height).toBe(size);
    expect(Math.abs(metrics.close.dx)).toBeLessThanOrEqual(1); expect(Math.abs(metrics.close.dy)).toBeLessThanOrEqual(1);
    for (const type of metrics.types) { expect(type.font, type.text).toBe('14px'); expect(Number.parseFloat(type.line), type.text).toBeCloseTo(19.6, 1); }
    for (const actual of metrics.ordinary) expect(actual).toBeGreaterThanOrEqual(height);
  });
}

test('touch landscape navigation retains its width and wraps common-size labels', async ({ browser }) => {
  const context = await browser.newContext({ viewport:{width:844,height:390},hasTouch:true,isMobile:true });
  const page = await context.newPage();
  try {
    await page.goto('/assets/css/app.css');
    const nav = products.editor.match(/<nav\b[^>]*class="[^"]*mobile-bottom-bar[^"]*"[\s\S]*?<\/nav>/)?.[0];
    expect(nav).toBeTruthy();
    const menu = products.editor.match(/<div\b[^>]*class="[^"]*mobile-menu-toolbar[^"]*"[\s\S]*?<\/div>/)[0];
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style>${sprite}<div class="app-root" data-layout="phone-landscape"><div class="mobile-workspace-controls">${menu}${nav}</div></div>`);
    expect(await page.evaluate(() => window.matchMedia('(pointer:coarse)').matches)).toBe(true);
    for (const scale of [100,200]) {
      await page.locator('html').evaluate((node, value) => { node.style.fontSize = `${value}%`; }, scale);
      const metrics = await page.locator('.mobile-bottom-bar').evaluate(nav => ({width:nav.getBoundingClientRect().width,overflow:getComputedStyle(nav).overflowY,
        rows:[...nav.querySelectorAll('.ui-nav-item')].map(button=>{ const label=button.querySelector('strong'), b=button.getBoundingClientRect(), l=label.getBoundingClientRect();return {display:getComputedStyle(button).display,font:getComputedStyle(label).fontSize,buttonHeight:b.height,labelHeight:l.height,clipped:button.scrollWidth>button.clientWidth||label.scrollWidth>label.clientWidth,labelBottom:l.bottom,buttonBottom:b.bottom}; })}));
      expect(metrics.width).toBe(48 * scale / 100 + 8); expect(metrics.overflow).toBe('auto');
      const menuBefore = await page.locator('#mobileMenuBtn').boundingBox();
      await page.locator('.mobile-bottom-bar').evaluate(node => { node.scrollTop = node.scrollHeight; });
      expect(await page.locator('#mobileMenuBtn').boundingBox()).toEqual(menuBefore);
      for (const row of metrics.rows) { expect(row.display).toBe('flex'); expect(row.font).toBe(`${14 * scale / 100}px`); expect(row.clipped).toBe(false);expect(row.labelBottom).toBeLessThanOrEqual(row.buttonBottom); }
    }
  } finally { await context.close(); }
});

test('landscape menu shares navigation hover and selected styles', async ({ browser }) => {
  const context = await browser.newContext({viewport:{width:844,height:390},hasTouch:false});
  const page = await context.newPage();
  try {
    const nav = products.editor.match(/<nav\b[^>]*class="[^"]*mobile-bottom-bar[^"]*"[\s\S]*?<\/nav>/)[0];
    const menu = products.editor.match(/<div\b[^>]*class="[^"]*mobile-menu-toolbar[^"]*"[\s\S]*?<\/div>/)[0];
    await page.setContent(`<style>${styles}*,*::after{transition:none!important}</style>${sprite}<div class="app-root" data-layout="phone-landscape"><div class="mobile-workspace-controls">${menu}${nav}</div></div>`);
    const appearance = selector => page.locator(selector).evaluate(node => {
      const style=getComputedStyle(node);
      return [style.color,style.backgroundColor,style.borderColor,style.boxShadow];
    });
    for (const selected of [false,true]) {
      await page.locator('#mobileMenuBtn, #mobileSearchBtn').evaluateAll((buttons,value)=>buttons.forEach(button=>button.setAttribute('aria-expanded',String(value))),selected);
      await page.locator('#mobileMenuBtn').hover();
      const menuStyle = await appearance('#mobileMenuBtn');
      await page.locator('#mobileSearchBtn').hover();
      expect(await appearance('#mobileSearchBtn')).toEqual(menuStyle);
    }
  } finally { await context.close(); }
});

test('narrow portrait navigation never shrinks text below the common body size', async ({ page }) => {
  const nav = products.editor.match(/<nav\b[^>]*class="[^"]*mobile-bottom-bar[^"]*"[\s\S]*?<\/nav>/)[0];
  await page.setViewportSize({width:320,height:700});
  await page.goto('/assets/css/app.css');
  const menu = products.editor.match(/<div\b[^>]*class="[^"]*mobile-menu-toolbar[^"]*"[\s\S]*?<\/div>/)[0];
  await page.setContent(`<style>${styles}</style>${sprite}<div class="app-root" data-layout="mobile"><div class="mobile-workspace-controls">${menu}${nav}</div></div>`);
  for (const font of await page.locator('.ui-nav-item strong').evaluateAll(labels=>labels.map(e=>getComputedStyle(e).fontSize))) expect(font).toBe('14px');
});

for (const collapsed of [false,true]) test(`mobile custom color close remains reachable outside the settled sheet clip (${collapsed ? 'collapsed' : 'expanded'})`, async ({ page }) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/assets/css/app.css');
  await page.setContent(`<style>${styles}</style>${sprite}<div class="app-root" data-layout="mobile"><div class="workspace">
    <aside class="workspace-surface ui-sheet surface-editor editor-drawer ${collapsed ? 'collapsed' : ''} mobile-open surface-open" style="--sheet-height:50dvh">
      <div class="surface-body"><div class="ui-color-picker is-open"><div class="ui-popover ui-color-popover is-custom"></div></div></div>
    </aside></div></div>`);
  await page.evaluate(async()=>{
    const {createCustomColorControl}=await import('/assets/js/modules/custom-color-control.js');
    const control=createCustomColorControl({onApply(){},onCancel(){}});
    document.querySelector('.ui-color-popover').append(control.element);control.open('#316fd3');
  });
  const close=page.getByRole('button',{name:'색상 선택 취소',exact:true});
  expect(await close.evaluate(e=>{const r=e.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return e===top||e.contains(top);})).toBe(true);
  await close.click();
  const sheet=page.locator('.workspace-surface');
  await sheet.evaluate(e=>{e.classList.add('is-sheet-dragging');e.style.setProperty('--sheet-drag-offset','12px');});
  expect(await sheet.evaluate(e=>getComputedStyle(e).transform)).not.toBe('none');
  await sheet.evaluate(e=>{e.classList.remove('is-sheet-dragging','mobile-open','surface-open');});
  await expect(sheet).not.toBeVisible();
});
