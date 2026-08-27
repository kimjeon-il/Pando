import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
}

async function appendSearchableSelect(page, id) {
  await page.evaluate(selectId => {
    const field = document.createElement('label');
    field.className = 'ui-field field-group';
    field.style.position = 'fixed';
    field.style.inset = '80px auto auto 24px';
    field.style.width = '280px';
    field.style.zIndex = '20000';
    field.innerHTML = `<span>소속 국가</span><select id="${selectId}"></select>`;
    const select = field.querySelector('select');
    const names = ['가나', '가봉', '가이아나', '감비아', '과테말라', '그리스', '기니', '나미비아', '남아프리카 공화국', '네덜란드', '네팔', '노르웨이', '뉴질랜드'];
    names.forEach((name, index) => select.add(new Option(name, String(index), index === 0, index === 0)));
    document.querySelector('#app').append(field);
  }, id);
  const control = page.locator(`#${id}Control`);
  await expect(control).toBeVisible();
  await expect(control).toHaveValue('가나');
  return control;
}

test.describe('coarse-pointer native selection suppression', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('touch activation opens a searchable select without selecting its current label', async ({ page }) => {
    await openApp(page);
    const control = await appendSearchableSelect(page, 'touchCountrySelect');

    await control.tap();
    await expect(control).toHaveValue('');
    await expect(control).toHaveAttribute('aria-expanded', 'true');
    const popover = page.locator('.ui-select-popover:not([hidden])');
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('option', { name: '가나', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => control.evaluate(element => ({
      start: element.selectionStart,
      end: element.selectionEnd,
    }))).toEqual({ start: 0, end: 0 });

    await page.keyboard.press('Escape');
    await expect(control).toHaveValue('가나');
    await expect(control).toHaveAttribute('aria-expanded', 'false');

    await control.tap();
    await control.fill('가봉');
    await expect(popover.getByRole('option')).toHaveText(['가봉']);
    await popover.getByRole('option', { name: '가봉', exact: true }).tap();
    await expect(control).toHaveValue('가봉');
    await expect(page.locator('#touchCountrySelect')).toHaveValue('1');
  });

  test('non-editable controls suppress native selection while editable text remains selectable', async ({ page }) => {
    await openApp(page);
    const styles = await page.evaluate(() => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '테스트 버튼';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = '복사 가능한 입력';
      const helper = document.createElement('p');
      helper.textContent = '복사 가능한 설명문';
      document.querySelector('#app').append(button, input, helper);
      const read = element => {
        const style = getComputedStyle(element);
        return {
          userSelect: style.userSelect,
          webkitUserSelect: style.webkitUserSelect,
          tapHighlight: style.webkitTapHighlightColor,
        };
      };
      return { button: read(button), input: read(input), helper: read(helper) };
    });

    expect(styles.button.userSelect).toBe('none');
    expect(styles.button.webkitUserSelect).toBe('none');
    expect(styles.button.tapHighlight).toBe('rgba(0, 0, 0, 0)');
    expect(styles.input.userSelect).not.toBe('none');
    expect(styles.helper.userSelect).not.toBe('none');
  });

  test('Korean IME composition filters options before the composition is committed', async ({ page }) => {
    await openApp(page);
    const control = await appendSearchableSelect(page, 'imeCountrySelect');
    await control.tap();
    const popover = page.locator('.ui-select-popover:not([hidden])');

    await control.evaluate(element => {
      const view = element.ownerDocument.defaultView;
      element.dispatchEvent(new view.CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      element.value = '가';
      element.dispatchEvent(new view.CompositionEvent('compositionupdate', { bubbles: true, data: '가' }));
      element.dispatchEvent(new view.InputEvent('input', {
        bubbles: true,
        data: '가',
        inputType: 'insertCompositionText',
        isComposing: true,
      }));
    });
    await expect(popover.getByRole('option')).toHaveText(['가나', '가봉', '가이아나']);

    await control.evaluate(element => {
      const view = element.ownerDocument.defaultView;
      element.value = '가봉';
      element.dispatchEvent(new view.CompositionEvent('compositionupdate', { bubbles: true, data: '가봉' }));
      element.dispatchEvent(new view.InputEvent('input', {
        bubbles: true,
        data: '가봉',
        inputType: 'insertCompositionText',
        isComposing: true,
      }));
    });
    await expect(popover.getByRole('option')).toHaveText(['가봉']);

    await control.evaluate(element => {
      const view = element.ownerDocument.defaultView;
      element.dispatchEvent(new view.CompositionEvent('compositionend', { bubbles: true, data: '가봉' }));
    });
    await popover.getByRole('option', { name: '가봉', exact: true }).tap();
    await expect(page.locator('#imeCountrySelect')).toHaveValue('1');
  });
});

test('mouse activation keeps fast replacement selection for searchable selects', async ({ page }) => {
  await openApp(page);
  const control = await appendSearchableSelect(page, 'mouseCountrySelect');

  await control.click();
  await expect(control).toHaveValue('가나');
  await expect.poll(() => control.evaluate(element => ({
    start: element.selectionStart,
    end: element.selectionEnd,
  }))).toEqual({ start: 0, end: 2 });
});
