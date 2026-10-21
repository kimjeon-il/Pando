import { expect, test } from '@playwright/test';
import { UI_REFERENCE_IMAGE_SOURCES } from '../../scripts/lib/ui-source-catalog.mjs';

test('reference factory and Surface binding preserve existing controls, focus and single event ownership', async ({ page }) => {
  await page.route('**/reference-surface-contract', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><main class="workspace"><div id="map"></div><button id="referenceImageBtn" aria-controls="referenceImageSurface">이미지 추가</button></main></body></html>',
  }));
  await page.goto('/reference-surface-contract');
  const result = await page.evaluate(async () => {
    const { createReferenceImagePanel } = await import('/assets/js/modules/reference-image-ui.js');
    const { installReferenceImageSurface } = await import('/assets/js/modules/reference-image-surface.js');
    const { createSurfaceController } = await import('/assets/js/modules/surface-controller.js');
    const panel = createReferenceImagePanel();
    const body = panel.querySelector(':scope > .surface-body');
    const header = panel.querySelector(':scope > .surface-header');
    const footer = panel.querySelector(':scope > .surface-footer');
    if (!body || !header || !footer || panel.id !== 'referenceImageSurface') {
      throw new Error('The factory must return the complete common Surface before installation.');
    }
    const controlsReady = ['workspace-surface', 'surface-reference', 'ui-sheet'].every(name => panel.classList.contains(name))
      && header.querySelectorAll('.sheet-drag-handle').length === 1
      && header.querySelectorAll('[data-reference-panel-toggle]').length === 1
      && panel.querySelectorAll('.reference-image-resize-handle').length === 1
      && body.querySelector('[data-ref-editor]')?.parentElement === body
      && body.querySelector('.reference-image-collection')?.parentElement === body
      && footer.querySelectorAll('[data-ref-action]').length === 5;
    document.querySelector('.workspace').append(panel);
    panel.hidden = false;
    const elements = [panel, ...panel.querySelectorAll('*')];
    const parents = elements.map(element => element.parentElement);
    const add = body.querySelector('[data-ref-action="add"]');
    add.focus();
    let layout = 'wide';
    let registration;
    let opens = 0;
    const controller = createSurfaceController({ document, getElement: id => document.getElementById(id), getLayout: () => layout });
    controller.open('reference');
    const sync = () => { controller.render(); registration?.sync(); };
    const workspaceSurfaces = {
      surfaceController: controller,
      isMobile: () => layout === 'mobile',
      registerReferenceImageSurface(adapter) { registration = adapter; sync(); return () => { registration = null; }; },
      openSurface(name) { controller.open(name); sync(); },
      closeSurface(name) { controller.close(name); sync(); },
      toggleSurface(name) { controller.toggle(name); sync(); },
      setMobileSheetHeight(_panel, height) { panel.dataset.sheetSnap = String(height); },
      setReferenceImageGestureActive() {},
    };
    const install = () => installReferenceImageSurface({
      panel, launcher: document.getElementById('referenceImageBtn'), mapElement: document.getElementById('map'),
      workspaceSurfaces, onAction() {}, onAuxiliaryEditingStart() {}, onOpen() { opens += 1; },
    });
    const adapter = install();
    const focusAfterInstall = document.activeElement === add;
    const collapse = header.querySelector('[data-reference-panel-toggle]');
    collapse.focus();
    collapse.click();
    collapse.click();
    layout = 'mobile';
    controller.syncLayout('wide');
    adapter.setEditing(true, '배치 중');
    collapse.click();
    const focusAfterModes = document.activeElement === collapse;
    adapter.setEditing(false);
    const stable = elements.every((element, index) => element.parentElement === parents[index])
      && panel.querySelectorAll('*').length === elements.length - 1;
    adapter.destroy();
    const replacement = install();
    const beforeClick = opens;
    document.getElementById('referenceImageBtn').click();
    const clickOpenedOnce = opens === beforeClick + 1 && !panel.hidden;
    replacement.destroy();
    return { controlsReady, focusAfterInstall, focusAfterModes, stable, clickOpenedOnce };
  });
  expect(result).toEqual({ controlsReady: true, focusAfterInstall: true, focusAfterModes: true, stable: true, clickOpenedOnce: true });
});

for (const theme of ['light', 'dark']) {
  test(`reference fields retain common field paint and focus in ${theme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const styles = ['assets/css/app.css', 'assets/css/ui.bundle.css', ...UI_REFERENCE_IMAGE_SOURCES];
    await page.route('**/reference-field-contract', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html data-theme="${theme}"><head>${styles.map(path => `<link rel="stylesheet" href="/${path}">`).join('')}</head><body><div class="app-root" data-layout="wide"><main class="workspace reference-image-docked"></main></div></body></html>`,
    }));
    await page.goto('/reference-field-contract');
    const fields = await page.evaluate(async () => {
      const { createReferenceImagePanel, referenceImageEditorMarkup } = await import('/assets/js/modules/reference-image-ui.js');
      const panel = createReferenceImagePanel();
      const editor = panel.querySelector('[data-ref-editor]');
      editor.innerHTML = referenceImageEditorMarkup({
        record: { id: 'field-contract', name: '참조 지도', opacity: 0.5, blendMode: 'source-over', warpMode: 'auto',
          visible: true, locked: false, flipX: false, flipY: false, controlPoints: [], anchor: null },
        warp: { ok: false, minimumPoints: 2 }, placementEditing: false, index: 0, count: 1,
        blendOptions: [['source-over', '일반']], warpOptions: [['auto', '자동']],
      });
      editor.hidden = false;
      panel.hidden = false;
      for (const section of editor.querySelectorAll('[data-ref-section]')) section.hidden = false;
      for (const details of editor.querySelectorAll('details')) details.open = true;
      document.querySelector('.workspace').append(panel);
      const paintKeys = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth',
        'borderTopStyle', 'borderTopColor', 'borderRadius', 'backgroundColor', 'color'];
      const readStyle = (element, keys) => {
        const computed = getComputedStyle(element);
        return Object.fromEntries(keys.map(key => [key, computed[key]]));
      };
      return ['name', 'opacity', 'rotation', 'warp', 'blend'].map(name => {
        const input = editor.querySelector(`[data-ref-field="${name}"]`);
        const shared = document.createElement('label');
        shared.className = 'ui-field field-group';
        const sample = input.cloneNode(true);
        sample.removeAttribute('data-ref-field');
        shared.append(sample);
        document.body.append(shared);
        const normal = readStyle(input, paintKeys);
        const expectedNormal = readStyle(sample, paintKeys);
        input.focus();
        const focused = document.activeElement === input;
        const focus = readStyle(input, ['borderTopColor', 'boxShadow']);
        sample.focus();
        const expectedFocus = readStyle(sample, ['borderTopColor', 'boxShadow']);
        shared.remove();
        return { name, normal, expectedNormal, focused, focus, expectedFocus };
      });
    });
    for (const field of fields) {
      expect(field.normal, `${field.name} uses the common field paint`).toEqual(field.expectedNormal);
      expect(field.focused, `${field.name} remains focusable`).toBe(true);
      expect(field.focus, `${field.name} retains the common focus indicator`).toEqual(field.expectedFocus);
      expect(field.expectedFocus.boxShadow).not.toBe('none');
      if (field.name !== 'opacity') expect(field.expectedNormal.borderTopStyle).toBe('solid');
    }
  });
}
