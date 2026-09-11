import { expect, test } from '@playwright/test';

test.use({ trace: 'off' });

test('mobile sheet dispatches synthetic keys with the handle document realm', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });

  const result = await page.evaluate(async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const foreignWindow = iframe.contentWindow;
    const foreignDocument = iframe.contentDocument;
    foreignDocument.body.dataset.layout = 'mobile';
    foreignDocument.body.innerHTML = `
      <div id="app" data-layout="mobile"></div>
      <section id="rightPanel" class="mobile-open" data-sheet-snap="1">
        <button data-sheet-handle="rightPanel" aria-valuenow="1"></button>
      </section>
      <div id="modeEditingContext"></div>
    `;

    const handle = foreignDocument.querySelector('[data-sheet-handle]');
    let observed = null;
    handle.addEventListener('keydown', event => {
      observed = {
        key: event.key,
        foreignKeyboardEvent: event instanceof foreignWindow.KeyboardEvent,
        hostKeyboardEvent: event instanceof window.KeyboardEvent,
      };
    });

    const moduleUrl = new URL('/assets/js/modules/mobile-sheet-controller.js', location.href);
    moduleUrl.searchParams.set('cross-realm-test', String(Date.now()));
    const { installMobileSheetController } = await import(moduleUrl.href);
    installMobileSheetController(foreignDocument);
    await new Promise(resolve => setTimeout(resolve, 0));
    iframe.remove();
    return observed;
  });

  expect(result).toEqual({
    key: 'Home',
    foreignKeyboardEvent: true,
    hostKeyboardEvent: false,
  });
});
