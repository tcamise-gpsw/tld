import { test } from '../../fixtures'
import {
  addNodeWithToolbar,
  createDiagram,
  deleteSelectedNodeWithKeyboard,
  expectPlacement,
  uniqueName,
} from '../../helpers/vieweditor'


test('creates a diagram, adds a node with the toolbar, and deletes it with the keyboard', async ({ page }) => {
  await createDiagram(page, uniqueName('Toolbar CRUD Diagram'))
  const nodeName = await addNodeWithToolbar(page, uniqueName('Toolbar CRUD Node'))
  await expectPlacement(page, nodeName, true)

  await deleteSelectedNodeWithKeyboard(page, nodeName)
  await expectPlacement(page, nodeName, false)
})
