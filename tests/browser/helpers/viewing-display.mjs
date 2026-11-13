/** Open the single settings dialog on desktop and mobile; no retired View drawer. */
export async function openViewingDisplay(page) {
  if (await page.locator('#preferencesModal').isVisible()) return;
  const desktop = page.locator('#preferencesBtn');
  if (await desktop.isVisible()) {
    try {
      await desktop.click({timeout:3000});
      return;
    } catch (error) {
      // Responsive reflow can hide the desktop command after the visibility
      // probe. Only switch to mobile when it actually disappeared; otherwise
      // preserve the real desktop interaction failure.
      if (await desktop.isVisible()) throw error;
    }
  }
  await page.locator('#mobileMenuBtn').click();
  await page.locator('#mobilePreferencesBtn').click();
}
export async function setViewingLayer(page,group,value) {
  const ids={rivers:'preferencesRiversInput',lakes:'preferencesLakesInput',
    genericFeatures:'genericFeaturesVisible',distributions:'distributionsVisible'};
  if (!ids[group]) throw new TypeError('Unsupported settings toggle: '+group);
  const input=page.locator('#'+ids[group]);
  if (await input.isChecked()!==value) await input.locator('..').click();
}
export async function closeViewingDisplay(page) {
  if (await page.locator('#preferencesModal').isVisible())
    await page.locator('#preferencesCloseBtn').click();
}
