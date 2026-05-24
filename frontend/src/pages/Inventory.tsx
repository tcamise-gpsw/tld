import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge,
  Box,
  Button,
  Flex,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spinner,
  Tag,
  Text,
  VStack,
  Wrap,
  WrapItem,
} from '@chakra-ui/react'
import { ChevronDownIcon, SearchIcon } from '@chakra-ui/icons'
import { api } from '../api/client'
import ConnectorPanel from '../components/ConnectorPanel'
import ElementPanel from '../components/ElementPanel'
import ViewPanel from '../components/ViewPanel'
import RelationshipDrawer from '../components/RelationshipDrawer'
import { useSetHeader } from '../components/HeaderContext'
import { ViewEditorContext } from './ViewEditor/context'
import type { Connector, LibraryElement, ViewTreeNode } from '../types'
import {
  buildInventoryRows,
  dependencyConnectorToConnector,
  filterInventoryRows,
  flattenInventoryViews,
  type InventoryFilters,
  type InventoryObjectType,
  type InventoryRow,
  type InventoryType,
} from './inventoryData'

const TYPE_OPTIONS: { value: InventoryType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'elements', label: 'Elements' },
  { value: 'views', label: 'Views' },
  { value: 'connectors', label: 'Connectors' },
]

const QUALITY_OPTIONS = ['untagged', 'missing description', 'has child view', 'unused element', 'empty view', 'missing label']

function parseInventoryType(value: string | null): InventoryType {
  return value === 'elements' || value === 'views' || value === 'connectors' ? value : 'all'
}

function formatUpdated(value: string) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function typeColor(type: InventoryObjectType) {
  if (type === 'element') return 'green'
  if (type === 'view') return 'purple'
  return 'orange'
}

export default function Inventory() {
  const setHeader = useSetHeader()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [elements, setElements] = useState<LibraryElement[]>([])
  const [views, setViews] = useState<ViewTreeNode[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [countsByView, setCountsByView] = useState<Record<number, { placements: number; connectors: number }>>({})
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [editing, setEditing] = useState<InventoryRow | null>(null)

  const selectedType = parseInventoryType(searchParams.get('type'))
  const query = searchParams.get('q') ?? ''
  const selectedObject = searchParams.get('object')
  const tagFilter = searchParams.get('tag') ?? ''
  const kindFilter = searchParams.get('kind') ?? ''
  const qualityFilter = searchParams.get('quality') ?? ''

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [allElements, gridData, dependencies, tagColors] = await Promise.all([
        api.elements.list({ limit: 0 }),
        api.workspace.views.gridData(),
        api.dependencies.list(),
        api.workspace.orgs.tagColors.list().catch(() => ({})),
      ])
      const flatViews = flattenInventoryViews(gridData.views)
      const nextCounts = Object.fromEntries(
        Object.entries(gridData.content).map(([viewId, content]) => [
          Number(viewId),
          { placements: content.placements.length, connectors: content.connectors.length },
        ]),
      )
      const nextConnectors = dependencies.connectors.map(dependencyConnectorToConnector)
      const tagSet = new Set<string>(Object.keys(tagColors))
      allElements.forEach((element) => element.tags.forEach((tag) => tagSet.add(tag)))
      flatViews.forEach((view) => (view.tags ?? []).forEach((tag) => tagSet.add(tag)))
      nextConnectors.forEach((connector) => (connector.tags ?? []).forEach((tag) => tagSet.add(tag)))
      setElements(allElements)
      setViews(flatViews)
      setConnectors(nextConnectors)
      setCountsByView(nextCounts)
      setAvailableTags(Array.from(tagSet).sort((a, b) => a.localeCompare(b)))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setHeader({ node: <Text fontWeight="medium" fontSize="sm" color="gray.300">Inventory</Text> })
    return () => setHeader(null)
  }, [setHeader])

  useEffect(() => { void refresh() }, [refresh])

  const rows = useMemo(() => buildInventoryRows(elements, views, connectors, countsByView), [elements, views, connectors, countsByView])
  const filters = useMemo<InventoryFilters>(() => ({
    type: selectedType,
    query,
    tag: tagFilter,
    kind: kindFilter,
    quality: qualityFilter,
  }), [kindFilter, qualityFilter, query, selectedType, tagFilter])
  const filteredRows = useMemo(() => filterInventoryRows(rows, filters), [filters, rows])
  const selectedRow = useMemo(() => {
    if (!selectedObject) return filteredRows[0] ?? null
    return rows.find((row) => row.key === selectedObject) ?? filteredRows[0] ?? null
  }, [filteredRows, rows, selectedObject])



  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'object') next.delete('object')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const selectRow = (row: InventoryRow) => {
    const next = new URLSearchParams(searchParams)
    next.set('object', row.key)
    setSearchParams(next, { replace: true })
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches) {
      setEditing(row)
    }
  }

  const resetFilters = () => {
    setSearchParams(new URLSearchParams(selectedType === 'all' ? {} : { type: selectedType }), { replace: true })
  }



  const editorContext = useMemo(() => ({
    viewId: editing?.connector?.view_id ?? selectedRow?.connector?.view_id ?? null,
    canEdit: true,
    isOwner: true,
    isFreePlan: false,
    snapToGrid: false,
    setSnapToGrid: () => undefined,
    selectedElement: editing?.element ?? selectedRow?.element ?? null,
    selectedConnector: editing?.connector ?? selectedRow?.connector ?? null,
  }), [editing, selectedRow])

  const distinctTypeLabels = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.typeLabel).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [rows])

  return (
    <ViewEditorContext.Provider value={editorContext}>
      <Box data-testid="inventory-page" h="100%" bg="var(--bg-canvas)" display="flex" flexDir="column" overflow="hidden">
        <Flex px={4} py={3} gap={3} align="center" borderBottom="1px solid" borderColor="whiteAlpha.100" flexShrink={0} wrap={{ base: 'wrap', lg: 'nowrap' }}>
          <HStack spacing={1} p={1} bg="blackAlpha.300" border="1px solid" borderColor="whiteAlpha.100" borderRadius="lg">
            {TYPE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                data-testid={`inventory-tab-${option.value}`}
                size="sm"
                h="30px"
                variant={selectedType === option.value ? 'solid' : 'ghost'}
                colorScheme={selectedType === option.value ? 'blue' : undefined}
                onClick={() => setParam('type', option.value === 'all' ? '' : option.value)}
              >
                {option.label}
              </Button>
            ))}
          </HStack>
          <InputGroup size="sm" maxW={{ base: 'full', lg: '420px' }} flex={{ base: '1 0 100%', lg: '1' }}>
            <InputLeftElement pointerEvents="none" color="gray.500"><SearchIcon /></InputLeftElement>
            <Input
              data-testid="inventory-search"
              value={query}
              onChange={(event) => setParam('q', event.target.value)}
              placeholder="Search views, elements, connectors, tags..."
              variant="elevated"
              pl={9}
            />
          </InputGroup>
          <Text fontSize="xs" color="gray.500" ml="auto">{filteredRows.length} of {rows.length} objects</Text>
        </Flex>

        <Flex flex={1} minH={0} overflow="hidden">
          <Box w={{ base: '0', lg: '250px' }} display={{ base: 'none', lg: 'block' }} borderRight="1px solid" borderColor="whiteAlpha.100" overflowY="auto">
            <FilterSection title="Tags">
              <Wrap>
                {availableTags.slice(0, 24).map((tag) => (
                  <WrapItem key={tag}>
                    <Button size="xs" variant={tagFilter === tag ? 'solid' : 'subtle'} colorScheme={tagFilter === tag ? 'blue' : undefined} onClick={() => setParam('tag', tagFilter === tag ? '' : tag)}>
                      {tag}
                    </Button>
                  </WrapItem>
                ))}
              </Wrap>
            </FilterSection>
            <FilterSection title="Type / Kind">
              <Menu>
                <MenuButton as={Button} size="sm" variant="elevated" rightIcon={<ChevronDownIcon />} w="full">{kindFilter || 'Any type'}</MenuButton>
                <MenuList>
                  <MenuItem onClick={() => setParam('kind', '')}>Any type</MenuItem>
                  {distinctTypeLabels.map((label) => <MenuItem key={label} onClick={() => setParam('kind', label)}>{label}</MenuItem>)}
                </MenuList>
              </Menu>
            </FilterSection>
            <FilterSection title="Quality">
              <VStack align="stretch" spacing={2}>
                {QUALITY_OPTIONS.map((quality) => (
                  <Button key={quality} size="xs" justifyContent="flex-start" variant={qualityFilter === quality ? 'solid' : 'subtle'} colorScheme={qualityFilter === quality ? 'blue' : undefined} onClick={() => setParam('quality', qualityFilter === quality ? '' : quality)}>
                    {quality}
                  </Button>
                ))}
              </VStack>
            </FilterSection>
            <Box p={3}>
              <Button size="sm" variant="ghost" onClick={resetFilters}>Clear filters</Button>
            </Box>
          </Box>

          <Flex flex={1} minW={0} direction="column" overflow="hidden">
            <Box flex={1} overflow="auto">
              {loading ? (
                <Flex h="100%" align="center" justify="center"><Spinner size="xl" /></Flex>
              ) : (
                <Box minW="720px">
                  <Flex h="34px" px={4} align="center" borderBottom="1px solid" borderColor="whiteAlpha.100" color="gray.500" fontSize="10px" fontWeight="bold" textTransform="uppercase">
                    <Box flex={1}>Name</Box>
                    <Box w="210px">Tags</Box>
                    <Box w="170px">Usage</Box>
                    <Box w="90px">Updated</Box>
                  </Flex>
                  {filteredRows.map((row) => (
                    <Flex
                      data-testid="inventory-row"
                      key={row.key}
                      px={4}
                      py={3}
                      align="center"
                      borderBottom="1px solid"
                      borderColor="whiteAlpha.50"
                      bg={selectedRow?.key === row.key ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent'}
                      cursor="pointer"
                      _hover={{ bg: 'whiteAlpha.50' }}
                      onClick={() => selectRow(row)}
                    >
                      <HStack flex={1} minW={0} spacing={3}>
                        <Box w="4px" h="34px" borderRadius="full" bg={`${typeColor(row.objectType)}.300`} flexShrink={0} />
                        <Box minW={0}>
                          <HStack spacing={2}>
                            <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>{row.name}</Text>
                            <Badge size="sm" colorScheme={typeColor(row.objectType)}>{row.objectType}</Badge>
                          </HStack>
                          <Text fontSize="xs" color="gray.500" noOfLines={1}>{row.subtitle}</Text>
                        </Box>
                      </HStack>
                      <Box w="210px">
                        {row.tags.slice(0, 3).map((tag) => <Tag key={tag} size="sm" mr={1} bg="whiteAlpha.100">{tag}</Tag>)}
                        {row.tags.length === 0 && <Text fontSize="xs" color="gray.600">-</Text>}
                      </Box>
                      <Text w="170px" fontSize="xs" color="gray.400" noOfLines={1}>{row.usageLabel}</Text>
                      <Text w="90px" fontSize="xs" color="gray.500">{formatUpdated(row.updatedAt)}</Text>
                    </Flex>
                  ))}
                </Box>
              )}
            </Box>
            <RelationshipDrawer
              selectedRow={selectedRow}
              elements={elements}
              views={views}
              connectors={connectors}
              onSelectRow={(key) => {
                const found = rows.find((r) => r.key === key)
                if (found) selectRow(found)
              }}
            />
          </Flex>

          <Box w={{ base: '0', xl: '340px' }} display={{ base: 'none', xl: 'block' }} borderLeft="1px solid" borderColor="whiteAlpha.100" overflow="hidden" position="relative">
            {selectedRow?.objectType === 'view' && (
              <ViewPanel
                isOpen={true}
                onClose={() => {}}
                view={selectedRow.view ?? null}
                canEdit
                onSave={() => refresh()}
                availableTags={availableTags}
                hasBackdrop={false}
                isInline={true}
              />
            )}
            {selectedRow?.objectType === 'element' && (
              <ElementPanel
                isOpen={true}
                onClose={() => {}}
                element={selectedRow.element ?? null}
                onSave={() => refresh()}
                onDelete={() => { setParam('object', ''); void refresh() }}
                onPermanentDelete={() => { setParam('object', ''); void refresh() }}
                availableTags={availableTags}
                orgId=""
                hasBackdrop={false}
                isInline={true}
                autoSave
              />
            )}
            {selectedRow?.objectType === 'connector' && (
              <ConnectorPanel
                isOpen={true}
                onClose={() => {}}
                connector={selectedRow.connector ?? null}
                orgId=""
                onSave={() => refresh()}
                onDelete={() => { setParam('object', ''); void refresh() }}
                availableTags={availableTags}
                hasBackdrop={false}
                isInline={true}
                autoSave
              />
            )}
            {!selectedRow && (
              <Flex h="100%" align="center" justify="center" color="gray.600" fontSize="sm">
                No object selected.
              </Flex>
            )}
          </Box>
        </Flex>

        <ElementPanel
          isOpen={editing?.objectType === 'element'}
          onClose={() => setEditing(null)}
          element={editing?.element ?? null}
          onSave={() => { setEditing(null); void refresh() }}
          onDelete={() => { setEditing(null); void refresh() }}
          availableTags={availableTags}
          orgId=""
          hasBackdrop={false}
        />
        <ViewPanel
          isOpen={editing?.objectType === 'view'}
          onClose={() => setEditing(null)}
          view={editing?.view ?? null}
          canEdit
          onSave={() => { setEditing(null); void refresh() }}
          availableTags={availableTags}
          hasBackdrop={false}
        />
        <ConnectorPanel
          isOpen={editing?.objectType === 'connector'}
          onClose={() => setEditing(null)}
          connector={editing?.connector ?? null}
          orgId=""
          onSave={() => { setEditing(null); void refresh() }}
          onDelete={() => { setEditing(null); void refresh() }}
          availableTags={availableTags}
          hasBackdrop={false}
        />
      </Box>
    </ViewEditorContext.Provider>
  )
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box p={3} borderBottom="1px solid" borderColor="whiteAlpha.100">
      <Text fontSize="10px" color="gray.500" fontWeight="bold" textTransform="uppercase" mb={2}>{title}</Text>
      {children}
    </Box>
  )
}


