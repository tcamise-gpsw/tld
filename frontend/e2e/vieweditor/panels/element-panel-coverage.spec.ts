import { expect, test } from '../../fixtures'
import {
  addPlacement,
  createAndLoadDiagramWithNodes,
  createApiView,
  expectPlacement,
  getElement,
  listPlacements,
  openElementPanel,
  updateElement,
  uniqueName,
} from '../../helpers/vieweditor'


test('adds and removes a custom technology chip', async ({ page }) => {
  const { elements } = await createAndLoadDiagramWithNodes(page, 1, 'Tech Chip')

  await openElementPanel(page, elements[0].name)
  await page.getByTestId('element-panel-technology-input').fill('custom-runtime')
  await page.getByTestId('element-panel-technology-add').click()
  await expect(page.getByTestId('element-panel-technology-chip').filter({ hasText: 'custom-runtime' })).toBeVisible()

  await page.getByTestId('element-panel-technology-chip').filter({ hasText: 'custom-runtime' }).getByTestId('element-panel-technology-remove').click()
  await page.getByTestId('element-panel-url-input').blur()

  await expect.poll(async () => {
    const element = await getElement(page, elements[0].id)
    return (element.technology_connectors ?? []).some((link) => link.label === 'custom-runtime')
  }).toBeFalsy()
})

test('removes an existing tag from the element panel', async ({ page }) => {
  const tag = uniqueName('remove-tag')
  const { elements } = await createAndLoadDiagramWithNodes(page, 1, 'Tag Remove')

  await openElementPanel(page, elements[0].name)
  await page.getByTestId('tag-upsert-input').fill(tag)
  await page.getByTestId('tag-upsert-input').press('Enter')
  await expect(page.getByTestId('element-panel-tag-chip').filter({ hasText: tag })).toBeVisible()

  await page.getByTestId('element-panel-tag-chip').filter({ hasText: tag }).getByTestId('element-panel-tag-remove').click()

  await expect(page.getByTestId('element-panel-tag-chip').filter({ hasText: tag })).toHaveCount(0)
})

test('remove from view leaves the shared element in another diagram', async ({ page }) => {
  const { diagram: first, elements } = await createAndLoadDiagramWithNodes(page, 1, 'Shared Placement')
  const second = await createApiView(page, uniqueName('Shared Placement Target'))
  await addPlacement(page, second.id, elements[0].id, 200, 180)

  await openElementPanel(page, elements[0].name)
  await page.getByTestId('element-panel-remove').click()

  await expectPlacement(page, elements[0].name, false, first.id)
  await expect.poll(async () => {
    const placements = await listPlacements(page, second.id)
    return placements.some((placement) => placement.elementId === elements[0].id)
  }).toBeTruthy()
})

test('type autocomplete selection persists', async ({ page }) => {
  const { elements } = await createAndLoadDiagramWithNodes(page, 1, 'Type Persist')

  await openElementPanel(page, elements[0].name)
  await page.getByTestId('element-panel-type-input').fill('queue')
  await page.getByTestId('element-panel-type-input').press('Enter')

  await expect(page.getByTestId('element-panel-type-input')).toHaveValue('queue')
})

test('url changes are reflected after reload', async ({ page }) => {
  const { elements } = await createAndLoadDiagramWithNodes(page, 1, 'URL Persist')
  const nextUrl = 'https://example.com/e2e-url'

  await updateElement(page, elements[0].id, { url: nextUrl })
  await openElementPanel(page, elements[0].name)
  await page.reload()
  await openElementPanel(page, elements[0].name)

  await expect(page.getByTestId('element-panel-url-input')).toHaveValue(nextUrl)
})
