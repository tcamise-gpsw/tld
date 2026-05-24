import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  HStack,
  IconButton,
  Input,
  InputGroup,
  InputLeftElement,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Spinner,
  Tag,
  TagCloseButton,
  TagLabel,
  Text,
  Tooltip,
  VStack,
  Wrap,
  WrapItem,
} from '@chakra-ui/react'
import { ChevronDownIcon, ChevronRightIcon, DeleteIcon, SearchIcon, SmallCloseIcon } from '@chakra-ui/icons'
import { api } from '../api/client'
import ConnectorPanel from '../components/ConnectorPanel'
import ElementPanel from '../components/ElementPanel'
import ViewPanel from '../components/ViewPanel'
import InspectDrawer from '../components/InventoryInspector'
import { useSetHeader } from '../components/HeaderContext'
import { ViewEditorContext } from './ViewEditor/context'
import type { Connector, LibraryElement, ViewTreeNode } from '../types'
import {
  buildInventoryRows,
  dependencyConnectorToConnector,
  filterInventoryRows,
  flattenInventoryViews,
  type InventoryFilters,
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

export default function Inventory() {
  const setHeader = useSetHeader()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [elements, setElements] = useState<LibraryElement[]>([])
  const [views, setViews] = useState<ViewTreeNode[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [countsByView, setCountsByView] = useState<Record<number, { placements: number; connectors: number }>>({})
  const [placementByViewElement, setPlacementByViewElement] = useState<Record<string, { x: number; y: number }>>({})
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [editing, setEditing] = useState<InventoryRow | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)

  const selectedType = parseInventoryType(searchParams.get('type'))
  const query = searchParams.get('q') ?? ''
  const selectedObject = searchParams.get('object')
  const tagsFilter = useMemo(() => searchParams.get('tags')?.split(',').filter(Boolean) ?? [], [searchParams])
  const kindFilter = searchParams.get('kind') ?? ''
  const qualitiesFilter = useMemo(() => searchParams.get('qualities')?.split(',').filter(Boolean) ?? [], [searchParams])

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
      const nextPlacementLookup: Record<string, { x: number; y: number }> = {}
      Object.entries(gridData.content).forEach(([viewId, content]) => {
        content.placements.forEach((placement) => {
          nextPlacementLookup[`${viewId}:${placement.element_id}`] = {
            x: placement.position_x,
            y: placement.position_y,
          }
        })
      })
      const nextConnectors = dependencies.connectors.map(dependencyConnectorToConnector)
      const tagSet = new Set<string>(Object.keys(tagColors))
      allElements.forEach((element) => element.tags.forEach((tag) => tagSet.add(tag)))
      flatViews.forEach((view) => (view.tags ?? []).forEach((tag) => tagSet.add(tag)))
      nextConnectors.forEach((connector) => (connector.tags ?? []).forEach((tag) => tagSet.add(tag)))
      setElements(allElements)
      setViews(flatViews)
      setConnectors(nextConnectors)
      setCountsByView(nextCounts)
      setPlacementByViewElement(nextPlacementLookup)
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
    tags: tagsFilter,
    kind: kindFilter,
    qualities: qualitiesFilter,
  }), [kindFilter, qualitiesFilter, query, selectedType, tagsFilter])
  const filteredRows = useMemo(() => filterInventoryRows(rows, filters), [filters, rows])
  const selectedRow = useMemo(() => {
    if (!selectedObject) return filteredRows[0] ?? null
    return rows.find((row) => row.key === selectedObject) ?? filteredRows[0] ?? null
  }, [filteredRows, rows, selectedObject])

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    rows.forEach((row) => row.tags.forEach((tag) => { counts[tag] = (counts[tag] ?? 0) + 1 }))
    return counts
  }, [rows])

  const qualityCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    QUALITY_OPTIONS.forEach((q) => { counts[q] = 0 })
    rows.forEach((row) => row.qualityFlags.forEach((q) => { counts[q] = (counts[q] ?? 0) + 1 }))
    return counts
  }, [rows])

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    rows.forEach((row) => { counts[row.typeLabel] = (counts[row.typeLabel] ?? 0) + 1 })
    return counts
  }, [rows])

  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'object') next.delete('object')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const toggleTagFilter = useCallback((tag: string) => {
    const next = new URLSearchParams(searchParams)
    const current = next.get('tags')?.split(',').filter(Boolean) ?? []
    const idx = current.indexOf(tag)
    if (idx >= 0) current.splice(idx, 1)
    else current.push(tag)
    if (current.length > 0) next.set('tags', current.join(','))
    else next.delete('tags')
    next.delete('object')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const toggleQualityFilter = useCallback((quality: string) => {
    const next = new URLSearchParams(searchParams)
    const current = next.get('qualities')?.split(',').filter(Boolean) ?? []
    const idx = current.indexOf(quality)
    if (idx >= 0) current.splice(idx, 1)
    else current.push(quality)
    if (current.length > 0) next.set('qualities', current.join(','))
    else next.delete('qualities')
    next.delete('object')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const selectRow = (row: InventoryRow) => {
    if (selectedKeys.size > 0) {
      toggleSelectKey(row.key)
      return
    }
    const next = new URLSearchParams(searchParams)
    next.set('object', row.key)
    setSearchParams(next, { replace: true })
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches) {
      setEditing(row)
    }
  }

  const toggleSelectKey = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSelectAll = () => {
    if (selectedKeys.size === filteredRows.length) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(filteredRows.map((r) => r.key)))
    }
  }

  const resetFilters = () => {
    setSearchParams(new URLSearchParams(selectedType === 'all' ? {} : { type: selectedType }), { replace: true })
  }

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const distinctTypeLabels = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.typeLabel).filter(Boolean))).sort((a, b) => a.localeCompare(b))
  }, [rows])

  const hasActiveFilters = tagsFilter.length > 0 || qualitiesFilter.length > 0 || kindFilter

  const selectedRows = useMemo(() => rows.filter((r) => selectedKeys.has(r.key)), [rows, selectedKeys])

  const handleBulkAddTag = async (tag: string) => {
    setBulkLoading(true)
    try {
      await Promise.all(
        selectedRows.map(async (row) => {
          if (row.objectType === 'element' && row.element) {
            const next = Array.from(new Set([...row.element.tags, tag]))
            await api.workspace.elements.update(row.element.id, { tags: next })
          } else if (row.objectType === 'view' && row.view) {
            const next = Array.from(new Set([...(row.view.tags ?? []), tag]))
            await api.workspace.views.update(row.view.id, { name: row.view.name, tags: next })
          } else if (row.objectType === 'connector' && row.connector) {
            const next = Array.from(new Set([...(row.connector.tags ?? []), tag]))
            await api.workspace.connectors.update(row.connector.view_id, row.connector.id, { tags: next })
          }
        }),
      )
      setSelectedKeys(new Set())
      void refresh()
    } finally {
      setBulkLoading(false)
    }
  }

  const handleBulkRemoveTag = async (tag: string) => {
    setBulkLoading(true)
    try {
      await Promise.all(
        selectedRows.map(async (row) => {
          if (row.objectType === 'element' && row.element) {
            const next = row.element.tags.filter((t) => t !== tag)
            await api.workspace.elements.update(row.element.id, { tags: next })
          } else if (row.objectType === 'view' && row.view) {
            const next = (row.view.tags ?? []).filter((t) => t !== tag)
            await api.workspace.views.update(row.view.id, { name: row.view.name, tags: next })
          } else if (row.objectType === 'connector' && row.connector) {
            const next = (row.connector.tags ?? []).filter((t) => t !== tag)
            await api.workspace.connectors.update(row.connector.view_id, row.connector.id, { tags: next })
          }
        }),
      )
      setSelectedKeys(new Set())
      void refresh()
    } finally {
      setBulkLoading(false)
    }
  }

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedKeys.size} selected item(s)? This cannot be undone.`)) return
    setBulkLoading(true)
    try {
      await Promise.all(
        selectedRows.map(async (row) => {
          if (row.objectType === 'element') {
            await api.workspace.elements.delete('', row.id)
          } else if (row.objectType === 'view') {
            await api.workspace.views.delete('', row.id)
          } else if (row.objectType === 'connector') {
            await api.workspace.connectors.delete('', row.id)
          }
        }),
      )
      setSelectedKeys(new Set())
      setParam('object', '')
      void refresh()
    } finally {
      setBulkLoading(false)
    }
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

  const tagsInSelection = useMemo(() => {
    const counts: Record<string, number> = {}
    selectedRows.forEach((row) => row.tags.forEach((tag) => { counts[tag] = (counts[tag] ?? 0) + 1 }))
    return counts
  }, [selectedRows])

  return (
    <ViewEditorContext.Provider value={editorContext}>
      <Box data-testid="inventory-page" h="100%" bg="var(--bg-canvas)" display="flex" flexDir="column" overflow="hidden">
        {/* Header bar */}
        <Flex px={4} py={3} gap={3} align="center" borderBottom="1px solid" borderColor="whiteAlpha.100" flexShrink={0} wrap={{ base: 'wrap', lg: 'nowrap' }}>
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
          <Text fontSize="xs" color="gray.500" flexShrink={0}>{filteredRows.length} of {rows.length} objects</Text>
        </Flex>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <Flex px={4} py={2} gap={2} flexWrap="wrap" borderBottom="1px solid" borderColor="whiteAlpha.100" flexShrink={0} align="center">
            {tagsFilter.map((tag) => (
              <Tag key={tag} size="sm" colorScheme="blue" variant="subtle" borderRadius="full">
                <TagLabel>tag: {tag}</TagLabel>
                <TagCloseButton onClick={() => toggleTagFilter(tag)} />
              </Tag>
            ))}
            {qualitiesFilter.map((q) => (
              <Tag key={q} size="sm" colorScheme="orange" variant="subtle" borderRadius="full">
                <TagLabel>{q}</TagLabel>
                <TagCloseButton onClick={() => toggleQualityFilter(q)} />
              </Tag>
            ))}
            {kindFilter && (
              <Tag size="sm" colorScheme="purple" variant="subtle" borderRadius="full">
                <TagLabel>kind: {kindFilter}</TagLabel>
                <TagCloseButton onClick={() => setParam('kind', '')} />
              </Tag>
            )}
            <Button size="xs" variant="ghost" color="gray.500" onClick={resetFilters} ml="auto">Clear all</Button>
          </Flex>
        )}

        <Flex flex={1} minH={0} overflow="hidden">
          {/* Left filter panel */}
          <Box w={{ base: '0', lg: '240px' }} display={{ base: 'none', lg: 'block' }} borderRight="1px solid" borderColor="whiteAlpha.100" overflowY="auto" flexShrink={0}>
            <Box p={3} borderBottom="1px solid" borderColor="whiteAlpha.100">
              <Wrap spacing={1}>
                {TYPE_OPTIONS.map((option) => (
                  <WrapItem key={option.value}>
                    <Button
                      data-testid={`inventory-tab-${option.value}`}
                      size="xs"
                      variant={selectedType === option.value ? 'solid' : 'ghost'}
                      colorScheme={selectedType === option.value ? 'blue' : undefined}
                      onClick={() => setParam('type', option.value === 'all' ? '' : option.value)}
                    >
                      {option.label}
                    </Button>
                  </WrapItem>
                ))}
              </Wrap>
            </Box>

            <FilterSection title="Tags" collapsed={collapsedSections.has('tags')} onToggle={() => toggleSection('tags')}>
              <Wrap spacing={1}>
                {availableTags.map((tag) => {
                  const isActive = tagsFilter.includes(tag)
                  return (
                    <WrapItem key={tag}>
                      <Button
                        size="xs"
                        variant={isActive ? 'solid' : 'ghost'}
                        colorScheme={isActive ? 'blue' : undefined}
                        color={isActive ? undefined : 'gray.400'}
                        onClick={() => toggleTagFilter(tag)}
                        rightIcon={
                          <Text as="span" fontSize="9px" color={isActive ? 'blue.200' : 'gray.600'} fontWeight="bold">
                            {tagCounts[tag] ?? 0}
                          </Text>
                        }
                      >
                        {tag}
                      </Button>
                    </WrapItem>
                  )
                })}
                {availableTags.length === 0 && (
                  <Text fontSize="xs" color="gray.600">No tags yet</Text>
                )}
              </Wrap>
            </FilterSection>

            <FilterSection title="Type / Kind" collapsed={collapsedSections.has('kind')} onToggle={() => toggleSection('kind')}>
              <Menu>
                <MenuButton as={Button} size="sm" variant="ghost" rightIcon={<ChevronDownIcon />} w="full" textAlign="left" color="gray.300" _hover={{ bg: 'whiteAlpha.100' }}>
                  <Flex align="center" justify="space-between" w="full">
                    <Text>{kindFilter || 'Any type'}</Text>
                  </Flex>
                </MenuButton>
                <MenuList>
                  <MenuItem onClick={() => setParam('kind', '')}>
                    <Flex justify="space-between" w="full">
                      <Text>Any type</Text>
                    </Flex>
                  </MenuItem>
                  {distinctTypeLabels.map((label) => (
                    <MenuItem key={label} onClick={() => setParam('kind', label)}>
                      <Flex justify="space-between" w="full" align="center">
                        <Text>{label}</Text>
                        <Badge ml={2} colorScheme="gray" variant="subtle" fontSize="10px">{kindCounts[label] ?? 0}</Badge>
                      </Flex>
                    </MenuItem>
                  ))}
                </MenuList>
              </Menu>
            </FilterSection>

            <FilterSection title="Quality" collapsed={collapsedSections.has('quality')} onToggle={() => toggleSection('quality')}>
              <VStack align="stretch" spacing={0}>
                {QUALITY_OPTIONS.map((quality) => {
                  const isActive = qualitiesFilter.includes(quality)
                  const count = qualityCounts[quality] ?? 0
                  return (
                    <Flex
                      key={quality}
                      align="center"
                      px={2}
                      py={1.5}
                      borderRadius="md"
                      cursor="pointer"
                      bg={isActive ? 'rgba(237, 137, 54, 0.15)' : 'transparent'}
                      _hover={{ bg: isActive ? 'rgba(237, 137, 54, 0.2)' : 'whiteAlpha.50' }}
                      onClick={() => toggleQualityFilter(quality)}
                    >
                      <Checkbox
                        isChecked={isActive}
                        colorScheme="orange"
                        size="sm"
                        onChange={() => toggleQualityFilter(quality)}
                        onClick={(e) => e.stopPropagation()}
                        mr={2}
                        flexShrink={0}
                      />
                      <Text fontSize="xs" color={isActive ? 'orange.300' : 'gray.400'} flex={1}>{quality}</Text>
                      <Text fontSize="10px" color={count === 0 ? 'gray.700' : isActive ? 'orange.400' : 'gray.600'} fontWeight="bold">{count}</Text>
                    </Flex>
                  )
                })}
              </VStack>
            </FilterSection>
          </Box>

          <Flex flex={1} minW={0} direction="column" overflow="hidden">
            {/* Bulk action bar */}
            {selectedKeys.size > 0 && (
              <Flex
                px={4}
                py={2}
                align="center"
                gap={2}
                bg="rgba(66, 153, 225, 0.08)"
                borderBottom="1px solid"
                borderColor="blue.800"
                flexShrink={0}
              >
                <Checkbox
                  isIndeterminate={selectedKeys.size > 0 && selectedKeys.size < filteredRows.length}
                  isChecked={selectedKeys.size === filteredRows.length}
                  onChange={handleSelectAll}
                  colorScheme="blue"
                  size="sm"
                />
                <Text fontSize="sm" fontWeight="medium" color="blue.300" mr={2}>
                  {selectedKeys.size} selected
                </Text>
                <Menu>
                  <MenuButton
                    as={Button}
                    size="xs"
                    variant="outline"
                    colorScheme="blue"
                    rightIcon={<ChevronDownIcon />}
                    isLoading={bulkLoading}
                  >
                    Add tag
                  </MenuButton>
                  <MenuList maxH="240px" overflowY="auto">
                    {availableTags.map((tag) => (
                      <MenuItem key={tag} onClick={() => void handleBulkAddTag(tag)}>{tag}</MenuItem>
                    ))}
                    {availableTags.length === 0 && (
                      <MenuItem isDisabled>No tags available</MenuItem>
                    )}
                  </MenuList>
                </Menu>
                {Object.keys(tagsInSelection).length > 0 && (
                  <Menu>
                    <MenuButton
                      as={Button}
                      size="xs"
                      variant="outline"
                      colorScheme="orange"
                      rightIcon={<ChevronDownIcon />}
                      isLoading={bulkLoading}
                    >
                      Remove tag
                    </MenuButton>
                    <MenuList maxH="240px" overflowY="auto">
                      {Object.keys(tagsInSelection).map((tag) => (
                        <MenuItem key={tag} onClick={() => void handleBulkRemoveTag(tag)}>
                          <Flex justify="space-between" w="full">
                            <Text>{tag}</Text>
                            <Badge colorScheme="gray" ml={2}>{tagsInSelection[tag]}</Badge>
                          </Flex>
                        </MenuItem>
                      ))}
                    </MenuList>
                  </Menu>
                )}
                <Tooltip label="Delete selected">
                  <IconButton
                    aria-label="Delete selected"
                    icon={<DeleteIcon />}
                    size="xs"
                    colorScheme="red"
                    variant="ghost"
                    isLoading={bulkLoading}
                    onClick={() => void handleBulkDelete()}
                  />
                </Tooltip>
                <IconButton
                  aria-label="Clear selection"
                  icon={<SmallCloseIcon />}
                  size="xs"
                  variant="ghost"
                  ml="auto"
                  onClick={() => setSelectedKeys(new Set())}
                />
              </Flex>
            )}

            <Box flex={1} overflow="auto">
              {loading ? (
                <Flex h="100%" align="center" justify="center"><Spinner size="xl" /></Flex>
              ) : (
                <Box minW="720px">
                  <Flex h="34px" px={4} align="center" borderBottom="1px solid" borderColor="whiteAlpha.100" color="gray.500" fontSize="10px" fontWeight="bold" textTransform="uppercase">
                    <Box w="32px" flexShrink={0}>
                      <Checkbox
                        size="sm"
                        isIndeterminate={selectedKeys.size > 0 && selectedKeys.size < filteredRows.length}
                        isChecked={selectedKeys.size > 0 && selectedKeys.size === filteredRows.length}
                        onChange={handleSelectAll}
                        colorScheme="blue"
                        opacity={selectedKeys.size > 0 ? 1 : 0.4}
                        _hover={{ opacity: 1 }}
                      />
                    </Box>
                    <Box flex={1}>Name</Box>
                    <Box w="210px">Tags</Box>
                    <Box w="170px">Usage</Box>
                    <Box w="90px">Updated</Box>
                  </Flex>
                  {filteredRows.map((row) => {
                    const isSelected = selectedKeys.has(row.key)
                    const isHighlighted = selectedRow?.key === row.key && selectedKeys.size === 0
                    return (
                      <Flex
                        data-testid="inventory-row"
                        key={row.key}
                        px={4}
                        py={3}
                        align="center"
                        borderBottom="1px solid"
                        borderColor="whiteAlpha.50"
                        bg={isSelected ? 'rgba(66, 153, 225, 0.08)' : isHighlighted ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent'}
                        cursor="pointer"
                        role="group"
                        _hover={{ bg: isSelected ? 'rgba(66, 153, 225, 0.12)' : 'whiteAlpha.50' }}
                        onClick={() => selectRow(row)}
                      >
                        <Box
                          w="32px"
                          flexShrink={0}
                          opacity={selectedKeys.size > 0 || isSelected ? 1 : 0}
                          _groupHover={{ opacity: 1 }}
                          transition="opacity 0.1s"
                          onClick={(e) => { e.stopPropagation(); toggleSelectKey(row.key) }}
                        >
                          <Checkbox
                            isChecked={isSelected}
                            colorScheme="blue"
                            size="sm"
                            onChange={() => toggleSelectKey(row.key)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </Box>
                        <HStack flex={1} minW={0} spacing={3}>
                          <Box w="4px" h="34px" borderRadius="full" bg="var(--accent)" flexShrink={0} />
                          <Box minW={0}>
                            <HStack spacing={2}>
                              <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>{row.name}</Text>
                              <Badge size="sm" color="var(--accent)" bg="rgba(var(--accent-rgb), 0.12)" border="1px solid" borderColor="rgba(var(--accent-rgb), 0.2)">{row.objectType}</Badge>
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
                    )
                  })}
                  {filteredRows.length === 0 && (
                    <Flex h="200px" align="center" justify="center" color="gray.600" fontSize="sm" direction="column" gap={2}>
                      <Text>No results</Text>
                      {hasActiveFilters && (
                        <Button size="xs" variant="ghost" onClick={resetFilters}>Clear filters</Button>
                      )}
                    </Flex>
                  )}
                </Box>
              )}
            </Box>
            <InspectDrawer
              selectedRow={selectedRow}
              elements={elements}
              views={views}
              connectors={connectors}
              placementByViewElement={placementByViewElement}
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
                onClose={() => { }}
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
                onClose={() => { }}
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
                onClose={() => { }}
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

function FilterSection({
  title,
  children,
  collapsed,
  onToggle,
}: {
  title: string
  children: React.ReactNode
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <Box borderBottom="1px solid" borderColor="whiteAlpha.100">
      <Flex
        px={3}
        py={2}
        align="center"
        cursor="pointer"
        onClick={onToggle}
        _hover={{ bg: 'whiteAlpha.50' }}
        userSelect="none"
      >
        <Text fontSize="10px" color="gray.500" fontWeight="bold" textTransform="uppercase" flex={1}>{title}</Text>
        <Box color="gray.600" transform={collapsed ? 'rotate(0deg)' : 'rotate(90deg)'} transition="transform 0.15s">
          <ChevronRightIcon boxSize={3} />
        </Box>
      </Flex>
      {!collapsed && <Box px={3} pb={3}>{children}</Box>}
    </Box>
  )
}
