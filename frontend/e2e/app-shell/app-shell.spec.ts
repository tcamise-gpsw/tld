import { expect, test } from '@playwright/test'
import {
  createApiView,
  createDiagram,
  prepareStorage,
  uniqueName,
} from '../helpers/vieweditor'

test.beforeEach(async ({ page }) => {
  await prepareStorage(page)
})

test('home redirects to the first available root diagram', async ({ page }) => {
  await createApiView(page, uniqueName('Home Redirect Root'))

  await page.goto('/')

  await expect(page).toHaveURL(/\/views\/\d+$/)
  await expect(page.getByTestId('vieweditor-canvas')).toBeVisible()
})

test('top navigation opens core pages and marks route changes', async ({ page }) => {
  await createDiagram(page, uniqueName('Top Nav Diagram'))

  await page.getByTestId('topnav-inventory').click()
  await expect(page).toHaveURL(/\/inventory$/)
  await expect(page.getByTestId('inventory-page')).toBeVisible()

  await page.getByTestId('topnav-diagrams').click()
  await expect(page).toHaveURL(/\/views(\?.*)?$/)
  await expect(page.getByRole('button', { name: 'Hierarchy view' })).toBeVisible()

  await page.getByTestId('topnav-editor').click()
  await expect(page).toHaveURL(/\/views\/\d+$/)
  await expect(page.getByTestId('vieweditor-canvas')).toBeVisible()
})

test('appearance popover applies settings from the top bar', async ({ page }) => {
  await createDiagram(page, uniqueName('Appearance Popover'))

  await page.getByTestId('topnav-appearance').click()
  await page.getByRole('button', { name: 'Teal accent color', exact: true }).click()

  await expect.poll(async () => page.evaluate(() => localStorage.getItem('diag:accent-color'))).toBe('#4fd1c5')
})

test('settings api-key route falls back to appearance in local platform mode', async ({ page }) => {
  await page.goto('/settings/api-keys')

  await expect(page).toHaveURL(/\/settings\/appearance$/)
  await expect(page.getByRole('button', { name: /accent color/ }).first()).toBeVisible()
})

test('mobile bottom navigation reaches app pages', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 })
  await createDiagram(page, uniqueName('Mobile Nav'))

  await page.getByTestId('mobile-topnav-inventory').dispatchEvent('click')
  await expect(page).toHaveURL(/\/inventory$/)

  await page.getByTestId('mobile-topnav-diagrams').dispatchEvent('click')
  await expect(page).toHaveURL(/\/views(\?.*)?$/)
})
