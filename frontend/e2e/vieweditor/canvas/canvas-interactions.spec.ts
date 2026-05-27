import { expect, test } from '../../fixtures'
import {
  createAndLoadDiagramWithNodes,
  expectPlacement,
  listPlacements,
  nodeByName,
  reactFlowPaneBox,
  uniqueName,
} from '../../helpers/vieweditor'


test('clicking the canvas deselects nodes and closes the element panel', async ({ page }) => {
  const { elements } = await createAndLoadDiagramWithNodes(page, 1, 'Canvas Select')
  await nodeByName(page, elements[0].name).click()
  await expect(page.getByTestId('element-panel')).toBeVisible()

  const box = await reactFlowPaneBox(page)
  await page.mouse.click(box.x + 40, box.y + 40)
  await expect(page.getByTestId('element-panel')).toHaveCount(0)
})

test('dragging a node persists its position after debounce and reload', async ({ page }) => {
  const { diagram, elements } = await createAndLoadDiagramWithNodes(page, 1, 'Canvas Drag')
  const node = nodeByName(page, elements[0].name)
  const before = (await listPlacements(page, diagram.id)).find((placement) => placement.elementId === elements[0].id)
  expect(before).toBeTruthy()

  const box = await node.boundingBox()
  expect(box).toBeTruthy()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 280, box!.y + box!.height / 2 + 180, { steps: 12 })
  await page.mouse.up()

  await expect.poll(async () => {
    const after = (await listPlacements(page, diagram.id)).find((placement) => placement.elementId === elements[0].id)
    return Boolean(after && (Math.abs(after.positionX - before!.positionX) > 20 || Math.abs(after.positionY - before!.positionY) > 20))
  }).toBeTruthy()

  await page.reload()
  await expect(nodeByName(page, elements[0].name)).toBeVisible()
})

test('canvas context menu snap-to-grid toggle persists in local storage', async ({ page }) => {
  await createAndLoadDiagramWithNodes(page, 0, 'Snap Toggle')
  const box = await reactFlowPaneBox(page)
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5, { button: 'right' })
  await page.getByRole('button', { name: /Snap to Grid/ }).click()

  await expect.poll(async () => page.evaluate(() => localStorage.getItem('diag:snapToGrid'))).toBe('true')
})

test('Escape cancels an inline add operation without creating a placement', async ({ page }) => {
  await createAndLoadDiagramWithNodes(page, 0, 'Cancel Inline')
  const name = uniqueName('Canceled Node')
  await page.getByTestId('vieweditor-canvas').click()
  await page.keyboard.press('c')
  await page.getByTestId('inline-element-adder-input').fill(name)
  await page.keyboard.press('Escape')

  await expect(page.getByTestId('inline-element-adder-input')).toHaveCount(0)
  await expectPlacement(page, name, false)
})
