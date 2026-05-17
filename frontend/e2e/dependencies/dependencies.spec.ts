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

test('search empty state can be cleared', async ({ page }) => {
  await page.goto('/dependencies')
  await page.getByTestId('dependencies-search').fill(uniqueName('no-match'))

  await expect(page.getByTestId('dependencies-empty-state')).toBeVisible()
  await page.getByTestId('dependencies-clear-filters').click({ force: true })
  await expect(page.getByTestId('dependencies-search')).toHaveValue('')
})

test('lists elements, totals, and connector counts from the workspace', async ({ page }) => {
  const graph = await createDependencyGraph(page, 'Deps Totals')

  await page.goto('/dependencies')
  await page.getByTestId('dependencies-search').fill(graph.center.name)

  await expect(page.getByTestId('dependencies-row').filter({ hasText: graph.center.name })).toBeVisible()
  await expect(page.getByTestId('dependencies-element-total')).not.toHaveText('0')
  await expect(page.getByTestId('dependencies-connector-total')).not.toHaveText('0')
})

test('type filter narrows dependency rows', async ({ page }) => {
  const prefix = uniqueName('Deps Filter')
  const service = await createElement(page, { name: `${prefix} Service`, kind: 'service', technology: 'go' })
  const database = await createElement(page, { name: `${prefix} Database`, kind: 'database', technology: 'postgres' })

  await page.goto('/dependencies')
  await page.getByTestId('dependencies-search').fill(prefix)
  await expect(page.getByTestId('dependencies-row').filter({ hasText: service.name })).toBeVisible()
  await expect(page.getByTestId('dependencies-row').filter({ hasText: database.name })).toBeVisible()

  await page.getByTestId('dependencies-type-filter').click({ force: true })
  await page.getByTestId('dependencies-type-option').filter({ hasText: 'database' }).click()

  await expect(page.getByTestId('dependencies-row').filter({ hasText: database.name })).toBeVisible()
  await expect(page.getByTestId('dependencies-row').filter({ hasText: service.name })).toHaveCount(0)
})

test('query param selects an element and renders its neighbor graph', async ({ page }) => {
  const graph = await createDependencyGraph(page, 'Deps Query')

  await page.goto(`/dependencies?element=${graph.center.id}`)

  await expect(page.getByTestId('dependencies-selected-card')).toContainText(graph.center.name)
  await expect(page.getByTestId('dependencies-neighbour-card')).toHaveCount(4)
})

test('dependency graph groups incoming outgoing bidirectional and undirected links', async ({ page }) => {
  const graph = await createDependencyGraph(page, 'Deps Directions')

  await page.goto('/dependencies')
  await page.getByTestId('dependencies-search').fill(graph.center.name)
  await page.getByTestId('dependencies-row').filter({ hasText: graph.center.name }).click({ force: true })

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

test('pagination advances and returns within a filtered result set', async ({ page }) => {
  const prefix = uniqueName('Deps Page')
  for (let index = 0; index < 55; index += 1) {
    await createElement(page, { name: `${prefix} ${String(index).padStart(2, '0')}`, kind: 'service' })
  }

  await page.goto('/dependencies')
  await page.getByTestId('dependencies-search').fill(prefix)
  await expect(page.getByTestId('dependencies-range')).toContainText('1-50')

  await page.getByTestId('dependencies-next-page').click({ force: true })
  await expect(page.getByTestId('dependencies-page-label')).toContainText('Page 2')
  await expect(page.getByTestId('dependencies-range')).toContainText('51-55')

  await page.getByTestId('dependencies-prev-page').click({ force: true })
  await expect(page.getByTestId('dependencies-page-label')).toContainText('Page 1')
})

test('filtered dependency results auto-select the highest-connected element', async ({ page }) => {
  const graph = await createDependencyGraph(page, 'Deps Prompt')

  await page.goto('/dependencies')
  await page.getByTestId('dependencies-search').fill(graph.center.name)

  await expect(page.getByTestId('dependencies-selected-card')).toContainText(graph.center.name)
})
