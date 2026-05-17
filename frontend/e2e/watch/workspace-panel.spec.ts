import { expect, test } from '@playwright/test'
import {
  createAndLoadDiagramWithNodes,
  mockWatchRuntime,
  prepareStorage,
} from '../helpers/vieweditor'

test.beforeEach(async ({ page }) => {
  await prepareStorage(page)
})

async function openWorkspacePanel(page: import('@playwright/test').Page) {
  const trigger = page.getByTestId('workspace-watch-trigger').or(page.getByTestId('workspace-versions-trigger')).first()
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('workspace-panel')).toBeVisible()
}

test('inactive workspace versions panel opens from the top bar', async ({ page }) => {
  await mockWatchRuntime(page, { active: false })
  await page.goto('/views')

  await openWorkspacePanel(page)

  await expect(page.getByTestId('workspace-panel')).toBeVisible()
  await expect(page.getByTestId('workspace-toggle-list')).toBeVisible()
})

test('active watch panel shows live status and runtime lines', async ({ page }) => {
  const { elements } = await createAndLoadDiagramWithNodes(page, 1, 'Watch Runtime')
  await mockWatchRuntime(page, { elementId: elements[0].id, elementName: elements[0].name })
  await page.goto('/views')

  await openWorkspacePanel(page)

  await expect(page.getByTestId('workspace-panel')).toBeVisible()
  await expect(page.getByTestId('workspace-panel').getByText('LIVE')).toBeVisible()
  await expect(page.getByText('Watch stream connected')).toBeVisible()
  await expect(page.getByText(/internal\/app\/service\.go changed the diagram/)).toBeVisible()
})

test('watch pause resume and stop send websocket commands', async ({ page }) => {
  await mockWatchRuntime(page)
  await page.goto('/views')
  await openWorkspacePanel(page)

  await page.getByTestId('workspace-watch-pause').click({ force: true })
  await page.getByTestId('workspace-watch-resume').click({ force: true })
  await page.getByTestId('workspace-watch-stop').click({ force: true })

  const sentTypes = await page.evaluate(() => {
    const sent = (window as unknown as { __TLD_WATCH_SENT__?: string[] }).__TLD_WATCH_SENT__ ?? []
    return sent.map((item) => JSON.parse(item).type)
  })
  expect(sentTypes).toContain('watch.pause')
  expect(sentTypes).toContain('watch.resume')
  expect(sentTypes).toContain('watch.stop')
})

test('diff preview list can be expanded and toggled on', async ({ page }) => {
  const { diagram, elements } = await createAndLoadDiagramWithNodes(page, 1, 'Watch Diff')
  await mockWatchRuntime(page, { viewId: diagram.id, elementId: elements[0].id, elementName: elements[0].name })
  await page.goto(`/views/${diagram.id}`)

  await openWorkspacePanel(page)
  await page.getByTestId('workspace-toggle-list').click()

  await expect(page.getByTestId('workspace-diff-location').filter({ hasText: elements[0].name })).toBeVisible()
  await page.getByTestId('workspace-toggle-diff').click()
  await expect(page.getByTestId('workspace-toggle-diff')).toBeVisible()
})

test('diff map button navigates to explore diff mode', async ({ page }) => {
  const { diagram, elements } = await createAndLoadDiagramWithNodes(page, 1, 'Watch Diff Map')
  await mockWatchRuntime(page, { viewId: diagram.id, elementId: elements[0].id, elementName: elements[0].name })
  await page.goto(`/views/${diagram.id}`)

  await openWorkspacePanel(page)
  await page.getByTestId('workspace-diff-map').click()

  await expect(page).toHaveURL(/\/views\?view=explore&diffVersion=2001/)
})

test('next and previous diff controls focus available diff targets', async ({ page }) => {
  const { diagram, elements } = await createAndLoadDiagramWithNodes(page, 1, 'Watch Diff Nav')
  await mockWatchRuntime(page, { viewId: diagram.id, elementId: elements[0].id, elementName: elements[0].name })
  await page.goto(`/views/${diagram.id}`)

  await openWorkspacePanel(page)
  await page.getByTestId('workspace-toggle-list').click()
  await page.getByTestId('workspace-diff-next').click()
  await expect(page.getByTestId('workspace-panel').getByText(/1 of 1:/)).toBeVisible()
  await expect(page.getByTestId('workspace-diff-location').filter({ hasText: elements[0].name })).toBeVisible()
  await page.getByTestId('workspace-diff-previous').click()
  await expect(page.getByTestId('workspace-panel').getByText(/1 of 1:/)).toBeVisible()
})
