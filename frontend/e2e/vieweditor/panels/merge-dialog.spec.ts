import { expect, test } from '../../fixtures'
import {
  createApiView,
  createConnector,
  createPlacedElement,
  getElement,
  gotoView,
  listConnectors,
  listElements,
  nodeByName,
  openElementPanel,
  uniqueName,
} from '../../helpers/vieweditor'

test('merge dialog resolves conflicts and reassigns connectors to the survivor', async ({ page }) => {
  const prefix = uniqueName('Merge Flow')
  const view = await createApiView(page, `${prefix} Diagram`)
  const source = await createPlacedElement(page, view.id, {
    name: `${prefix} Source`,
    kind: 'service',
    description: 'source description wins',
    tags: [`${prefix}-source`],
  }, 520, 160)
  const survivor = await createPlacedElement(page, view.id, {
    name: `${prefix} Survivor`,
    kind: 'database',
    description: 'survivor description',
    tags: [`${prefix}-survivor`],
  }, 780, 160)
  const target = await createPlacedElement(page, view.id, {
    name: `${prefix} Target`,
    kind: 'queue',
  }, 1040, 160)
  await createConnector(page, view.id, source.id, target.id, { label: 'source-to-target' })
  await gotoView(page, view.id)

  await openElementPanel(page, source.name)
  await page.getByTestId('element-panel-merge').click()
  await expect(page.getByTestId('merge-dialog')).toBeVisible()
  await page.getByTestId('merge-dialog-search').fill(survivor.name)
  await page.getByTestId('merge-dialog-candidate').filter({ hasText: survivor.name }).click()

  await expect(page.getByTestId('merge-dialog')).toContainText('Resolve Conflicts')
  await page.getByTestId('merge-dialog-conflict-kind-source').check({ force: true })
  await page.getByTestId('merge-dialog-conflict-description-source').check({ force: true })
  await page.getByTestId('merge-dialog-submit').click()

  await expect(page.getByTestId('merge-dialog')).toHaveCount(0)
  await expect(nodeByName(page, source.name)).toHaveCount(0)
  await expect(nodeByName(page, survivor.name)).toBeVisible()

  await expect.poll(async () => {
    const elements = await listElements(page, prefix)
    return elements.map((element) => element.name).sort()
  }).toEqual([survivor.name, target.name].sort())

  await expect.poll(async () => {
    const connectors = await listConnectors(page, view.id)
    return connectors.some((connector) =>
      connector.sourceElementId === survivor.id &&
      connector.targetElementId === target.id &&
      connector.label === 'source-to-target'
    )
  }).toBe(true)

  const merged = await getElement(page, survivor.id)
  expect(merged.description).toBe('source description wins')
  expect(merged.tags ?? []).toEqual(expect.arrayContaining([`${prefix}-source`, `${prefix}-survivor`]))
})
