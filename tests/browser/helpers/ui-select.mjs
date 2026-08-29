export async function selectUiOption(page, selector, value) {
  const select = page.locator(selector);
  const label = await select.locator('option').evaluateAll((options, expectedValue) => {
    const option = options.find(candidate => candidate.value === expectedValue);
    return option?.textContent?.trim() || '';
  }, value);
  if (!label) throw new Error(`${selector}에서 값 ${value}에 해당하는 옵션을 찾지 못했습니다.`);

  const control = select.locator('..').locator('.ui-select-control');
  if (await control.count()) {
    await control.click();
    await page.locator('.ui-select-popover:not([hidden])')
      .getByRole('option', { name: label, exact: true })
      .click();
  } else {
    await select.selectOption(value);
  }
  return select;
}
