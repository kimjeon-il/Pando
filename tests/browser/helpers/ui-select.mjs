export async function selectUiOption(page, selector, value) {
  const select = page.locator(selector);
  await page.waitForFunction(
    ({ selectSelector, expectedValue }) => [...document.querySelectorAll(`${selectSelector} option`)]
      .some(option => option.value === expectedValue),
    { selectSelector: selector, expectedValue: value },
    { timeout: 30_000 },
  );
  const label = await select.locator('option').evaluateAll((options, expectedValue) => {
    const option = options.find(candidate => candidate.value === expectedValue);
    return option?.textContent?.trim() || '';
  }, value);
  if (!label) throw new Error(`${selector}에서 값 ${value}에 해당하는 옵션을 찾지 못했습니다.`);

  const control = select.locator('..').locator('.ui-select-control');
  if (await control.count() && await control.isVisible()) {
    await control.click();
    await page.locator('.ui-select-popover:not([hidden])')
      .getByRole('option', { name: label, exact: true })
      .click();
  } else {
    await select.evaluate((element, nextValue) => {
      element.value = nextValue;
      const BrowserEvent = element.ownerDocument.defaultView.Event;
      element.dispatchEvent(new BrowserEvent('input', { bubbles: true }));
      element.dispatchEvent(new BrowserEvent('change', { bubbles: true }));
    }, value);
  }
  return select;
}
