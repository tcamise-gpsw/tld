import { expect, test } from '@playwright/test'
import {
  createDependencyGraph,
  createElement,
  prepareStorage,
  uniqueName,
} from '../helpers/vieweditor'

test.beforeEach(async ({ page }) => {
  await prepareStorage(page)
})

test('search empty state can be cleared in inventory', async ({ page }) => {
  await page.goto('/inventory')
  await page.getByTestId('inventory-search').fill(uniqueName('no-match'))

  await expect(page.getByText('0 of')).toBeVisible()
  await page.getByTestId('inventory-search').fill('')
  await expect(page.getByTestId('inventory-search')).toHaveValue('')
})

test('lists elements, totals, and connector counts from the workspace', async ({ page }) => {
  const graph = await createDependencyGraph(page, 'Deps Totals')

  await page.goto('/inventory')
  await page.getByTestId('inventory-search').fill(graph.center.name)

  await expect(page.getByTestId('inventory-row').filter({ hasText: graph.center.name })).toBeVisible()
})

test('query param selects an element and renders its neighbor graph', async ({ page }) => {
  const graph = await createDependencyGraph(page, 'Deps Query')

  // Tests redirect from /dependencies to /inventory?object=element:ID
  await page.goto(`/dependencies?element=${graph.center.id}`)

  await expect(page.getByTestId('dependencies-selected-card')).toContainText(graph.center.name)
  await expect(page.getByTestId('dependencies-neighbour-card')).toHaveCount(4)
})

test('dependency graph groups incoming outgoing bidirectional and undirected links', async ({ page }) => {
  const graph = await createDependencyGraph(page, 'Deps Directions')

  await page.goto('/inventory')
  await page.getByTestId('inventory-search').fill(graph.center.name)
  await page.getByTestId('inventory-row').filter({ hasText: graph.center.name }).click({ force: true })

  await expect(page.locator(`[data-testid="dependencies-neighbour-card"][data-element-id="${graph.incoming.id}"]`)).toHaveAttribute('data-position', 'left')
  await expect(page.locator(`[data-testid="dependencies-neighbour-card"][data-element-id="${graph.outgoing.id}"]`)).toHaveAttribute('data-position', 'right')
  await expect(page.locator(`[data-testid="dependencies-neighbour-card"][data-element-id="${graph.both.id}"]`)).toHaveAttribute('data-position', 'top')
  await expect(page.locator(`[data-testid="dependencies-neighbour-card"][data-element-id="${graph.undirected.id}"]`)).toHaveAttribute('data-position', 'bottom')
})

test('selecting a neighbor recenters the graph on that element', async ({ page }) => {
  const graph = await createDependencyGraph(page, 'Deps Neighbor Select')

  await page.goto(`/dependencies?element=${graph.center.id}`)
  await page.locator(`[data-testid="dependencies-neighbour-card"][data-element-id="${graph.outgoing.id}"]`).click({ force: true })

  await expect(page.getByTestId('dependencies-selected-card')).toContainText(graph.outgoing.name)
})
