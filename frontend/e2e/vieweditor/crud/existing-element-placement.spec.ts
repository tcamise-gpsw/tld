import { expect, test } from '../../fixtures'
import {
  addExistingNodeWithInlineSearch,
  addNodeWithToolbar,
  createDiagram,
  expectPlacement,
  listPlacements,
  removeNodeFromPanel,
  uniqueName,
} from '../../helpers/vieweditor'


test('reuses an existing element in another diagram and removes only that placement', async ({ page }) => {
  const source = await createDiagram(page, uniqueName('Existing Source Diagram'))
  const nodeName = await addNodeWithToolbar(page, uniqueName('Reusable Node'))
  await expectPlacement(page, nodeName, true, source.id)

  const target = await createDiagram(page, uniqueName('Existing Target Diagram'))
  await addExistingNodeWithInlineSearch(page, nodeName)
  await expectPlacement(page, nodeName, true, target.id)

  await removeNodeFromPanel(page, nodeName)
  await expectPlacement(page, nodeName, false, target.id)

  const sourcePlacements = await listPlacements(page, source.id)
  expect(sourcePlacements.some((placement) => placement.name === nodeName)).toBeTruthy()
})
