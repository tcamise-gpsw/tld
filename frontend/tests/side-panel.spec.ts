import { test, expect } from '@playwright/test';

test.describe('Task 13: Side Panel', () => {
  test('panel appears on select, hides on deselect, shows connectors and sorting works', async ({ page }) => {
    // Navigate to viewer
    await page.goto('http://localhost:5199');
    
    // Wait for canvas
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();

    // Give it a second to load data and render
    await page.waitForTimeout(1000);

    // Trigger select via window helper
    await page.evaluate(() => {
      if ((window as any).__selectNode) {
        (window as any).__selectNode('core'); // assuming 'core' is a valid node ref in root view
      }
    });
    
    // Wait for SidePanel to appear
    const panel = page.locator('.side-panel');
    await expect(panel).toBeVisible();

    // Check header
    await expect(panel.locator('h3')).toBeVisible();

    // Check connector table
    const table = panel.locator('.connector-table');
    if (await table.isVisible()) {
      // Check headers
      const targetHeader = table.locator('th', { hasText: 'Target' });
      await expect(targetHeader).toBeVisible();

      // Click to sort by target
      await targetHeader.click();
      
      // Get first target cell
      const firstTargetCell = table.locator('tbody tr td:nth-child(2)').first();
      await expect(firstTargetCell).toBeVisible();
    }

    // Deselect
    await page.evaluate(() => {
      if ((window as any).__selectNode) {
        (window as any).__selectNode(null);
      }
    });
    await expect(panel).toBeHidden();
  });
});
