import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  InputRightElement,
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
} from '@chakra-ui/react'
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, DeleteIcon, SearchIcon, SmallCloseIcon, TriangleDownIcon, TriangleUpIcon } from '@chakra-ui/icons'
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
  const [sortKey, setSortKey] = useState<'name' | 'updatedAt' | 'usage' | 'type'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [tagSearch, setTagSearch] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  // ⌘K / Ctrl+K focuses search
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  const rows = useMemo(() => buildInventoryRows(elements, views, connectors, countsByView), [elements, views, connectors, countsByView])
  const filters = useMemo<InventoryFilters>(() => ({
    type: selectedType,
    query,
    tags: tagsFilter,
    kind: kindFilter,
    qualities: qualitiesFilter,
  }), [kindFilter, qualitiesFilter, query, selectedType, tagsFilter])
  const filteredRows = useMemo(() => {
    const base = filterInventoryRows(rows, filters)
    return [...base].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'updatedAt') cmp = a.updatedAt.localeCompare(b.updatedAt)
      else if (sortKey === 'usage') cmp = a.usageLabel.localeCompare(b.usageLabel)
      else if (sortKey === 'type') cmp = a.typeLabel.localeCompare(b.typeLabel)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filters, rows, sortKey, sortDir])
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

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
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
        <Flex px={4} py={2.5} gap={3} align="center" borderBottom="1px solid" borderColor="whiteAlpha.100" flexShrink={0} wrap={{ base: 'wrap', lg: 'nowrap' }}>
          <InputGroup size="sm" maxW={{ base: 'full', lg: '480px' }} flex={{ base: '1 0 100%', lg: '1' }}>
            <InputLeftElement pointerEvents="none" color="gray.500"><SearchIcon boxSize={3.5} /></InputLeftElement>
            <Input
              ref={searchInputRef}
              data-testid="inventory-search"
              value={query}
              onChange={(event) => setParam('q', event.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setParam('q', ''); (e.target as HTMLInputElement).blur() } }}
              placeholder="Search names, tags, kinds…"
              variant="elevated"
              pl={8}
              pr={query ? '2.5rem' : '5.5rem'}
              _placeholder={{ color: 'gray.600' }}
            />
            {query ? (
              <InputRightElement>
                <IconButton
                  aria-label="Clear search"
                  icon={<SmallCloseIcon />}
                  size="xs"
                  variant="ghost"
                  color="gray.500"
                  _hover={{ color: 'gray.200' }}
                  onClick={() => { setParam('q', ''); searchInputRef.current?.focus() }}
                />
              </InputRightElement>
            ) : (
              <InputRightElement w="auto" pr={2} pointerEvents="none">
                <Text fontSize="10px" color="gray.600" fontFamily="mono" px={1} border="1px solid" borderColor="whiteAlpha.200" borderRadius="md">⌘K</Text>
              </InputRightElement>
            )}
          </InputGroup>
          <Flex align="center" gap={2} flexShrink={0}>
            <Text fontSize="xs" color="gray.500">
              {loading ? <Spinner size="xs" /> : <><Text as="span" color="gray.300" fontWeight="medium">{filteredRows.length}</Text> / {rows.length}</>}
            </Text>
            <Text fontSize="xs" color="gray.600">objects</Text>
          </Flex>
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
          <Box w={{ base: '0', lg: '220px' }} display={{ base: 'none', lg: 'flex' }} flexDir="column" borderRight="1px solid" borderColor="whiteAlpha.100" overflowY="auto" flexShrink={0}>
            {/* Type selector */}
            <Box px={3} pt={3} pb={2} borderBottom="1px solid" borderColor="whiteAlpha.100">
              <Text fontSize="10px" color="gray.600" fontWeight="bold" textTransform="uppercase" mb={2}>Object type</Text>
              <VStack align="stretch" spacing={0.5}>
                {TYPE_OPTIONS.map((option) => {
                  const isActive = selectedType === option.value
                  const count = option.value === 'all'
                    ? rows.length
                    : rows.filter((r) => r.objectType === option.value.replace(/s$/, '') as never).length
                  return (
                    <Flex
                      key={option.value}
                      data-testid={`inventory-tab-${option.value}`}
                      align="center"
                      px={2.5}
                      py={1.5}
                      borderRadius="md"
                      cursor="pointer"
                      bg={isActive ? 'rgba(var(--accent-rgb), 0.12)' : 'transparent'}
                      _hover={{ bg: isActive ? 'rgba(var(--accent-rgb), 0.16)' : 'whiteAlpha.50' }}
                      onClick={() => setParam('type', option.value === 'all' ? '' : option.value)}
                      userSelect="none"
                    >
                      <Text
                        fontSize="sm"
                        fontWeight={isActive ? 'semibold' : 'normal'}
                        color={isActive ? 'var(--accent)' : 'gray.400'}
                        flex={1}
                      >
                        {option.label}
                      </Text>
                      <Text
                        fontSize="10px"
                        fontWeight="bold"
                        color={isActive ? 'var(--accent)' : 'gray.600'}
                        bg={isActive ? 'rgba(var(--accent-rgb), 0.15)' : 'whiteAlpha.100'}
                        px={1.5}
                        py={0.5}
                        borderRadius="full"
                        minW="22px"
                        textAlign="center"
                      >
                        {count}
                      </Text>
                    </Flex>
                  )
                })}
              </VStack>
            </Box>

            <FilterSection title="Tags" collapsed={collapsedSections.has('tags')} onToggle={() => toggleSection('tags')}>
              {availableTags.length > 5 && (
                <InputGroup size="xs" mb={2}>
                  <InputLeftElement pointerEvents="none" color="gray.600"><SearchIcon boxSize={3} /></InputLeftElement>
                  <Input
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="Filter tags…"
                    variant="filled"
                    pl={7}
                    bg="whiteAlpha.50"
                    _focus={{ bg: 'whiteAlpha.100' }}
                    borderRadius="md"
                  />
                  {tagSearch && (
                    <InputRightElement>
                      <IconButton aria-label="Clear tag search" icon={<SmallCloseIcon />} size="xs" variant="ghost" color="gray.600" onClick={() => setTagSearch('')} />
                    </InputRightElement>
                  )}
                </InputGroup>
              )}
              <VStack align="stretch" spacing={0.5}>
                {availableTags
                  .filter((t) => !tagSearch || t.toLowerCase().includes(tagSearch.toLowerCase()))
                  .map((tag) => {
                    const isActive = tagsFilter.includes(tag)
                    const count = tagCounts[tag] ?? 0
                    return (
                      <Flex
                        key={tag}
                        align="center"
                        px={2}
                        py={1}
                        borderRadius="md"
                        cursor="pointer"
                        bg={isActive ? 'rgba(66, 153, 225, 0.12)' : 'transparent'}
                        _hover={{ bg: isActive ? 'rgba(66, 153, 225, 0.18)' : 'whiteAlpha.50' }}
                        onClick={() => toggleTagFilter(tag)}
                        userSelect="none"
                      >
                        <Box
                          w="6px"
                          h="6px"
                          borderRadius="full"
                          bg={isActive ? 'blue.400' : 'gray.600'}
                          mr={2}
                          flexShrink={0}
                          transition="background 0.1s"
                        />
                        <Text fontSize="xs" color={isActive ? 'blue.300' : 'gray.400'} flex={1} isTruncated>{tag}</Text>
                        <Text fontSize="10px" color={count === 0 ? 'gray.700' : isActive ? 'blue.400' : 'gray.600'} fontWeight="bold" ml={1}>{count}</Text>
                      </Flex>
                    )
                  })}
                {availableTags.length === 0 && (
                  <Text fontSize="xs" color="gray.600" px={2}>No tags yet</Text>
                )}
                {tagSearch && availableTags.filter((t) => t.toLowerCase().includes(tagSearch.toLowerCase())).length === 0 && (
                  <Text fontSize="xs" color="gray.600" px={2}>No matching tags</Text>
                )}
              </VStack>
            </FilterSection>

            <FilterSection title="Kind" collapsed={collapsedSections.has('kind')} onToggle={() => toggleSection('kind')}>
              <VStack align="stretch" spacing={0.5}>
                <Flex
                  align="center"
                  px={2}
                  py={1}
                  borderRadius="md"
                  cursor="pointer"
                  bg={!kindFilter ? 'rgba(var(--accent-rgb), 0.1)' : 'transparent'}
                  _hover={{ bg: !kindFilter ? 'rgba(var(--accent-rgb), 0.14)' : 'whiteAlpha.50' }}
                  onClick={() => setParam('kind', '')}
                  userSelect="none"
                >
                  <Text fontSize="xs" color={!kindFilter ? 'var(--accent)' : 'gray.400'} flex={1}>Any kind</Text>
                  <Text fontSize="10px" color={!kindFilter ? 'var(--accent)' : 'gray.600'} fontWeight="bold">{rows.length}</Text>
                </Flex>
                {distinctTypeLabels.map((label) => {
                  const isActive = kindFilter === label
                  const count = kindCounts[label] ?? 0
                  return (
                    <Flex
                      key={label}
                      align="center"
                      px={2}
                      py={1}
                      borderRadius="md"
                      cursor="pointer"
                      bg={isActive ? 'rgba(159, 122, 234, 0.12)' : 'transparent'}
                      _hover={{ bg: isActive ? 'rgba(159, 122, 234, 0.18)' : 'whiteAlpha.50' }}
                      onClick={() => setParam('kind', label)}
                      userSelect="none"
                    >
                      <Text fontSize="xs" color={isActive ? 'purple.300' : 'gray.400'} flex={1} isTruncated>{label}</Text>
                      <Text fontSize="10px" color={count === 0 ? 'gray.700' : isActive ? 'purple.400' : 'gray.600'} fontWeight="bold" ml={1}>{count}</Text>
                    </Flex>
                  )
                })}
              </VStack>
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

            {/* Sort section */}
            <FilterSection title="Sort" collapsed={collapsedSections.has('sort')} onToggle={() => toggleSection('sort')}>
              <VStack align="stretch" spacing={0.5}>
                {([
                  { key: 'name', label: 'Name' },
                  { key: 'type', label: 'Type' },
                  { key: 'updatedAt', label: 'Last updated' },
                  { key: 'usage', label: 'Usage' },
                ] as const).map(({ key, label }) => {
                  const isActive = sortKey === key
                  return (
                    <Flex
                      key={key}
                      align="center"
                      px={2}
                      py={1}
                      borderRadius="md"
                      cursor="pointer"
                      bg={isActive ? 'whiteAlpha.100' : 'transparent'}
                      _hover={{ bg: 'whiteAlpha.50' }}
                      onClick={() => toggleSort(key)}
                      userSelect="none"
                    >
                      <Text fontSize="xs" color={isActive ? 'gray.200' : 'gray.500'} flex={1}>{label}</Text>
                      {isActive && (
                        <Box color="gray.400">
                          {sortDir === 'asc' ? <TriangleUpIcon boxSize={2.5} /> : <TriangleDownIcon boxSize={2.5} />}
                        </Box>
                      )}
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
                <Flex h="100%" align="center" justify="center" direction="column" gap={3} color="gray.600">
                  <Spinner size="lg" color="var(--accent)" />
                  <Text fontSize="sm">Loading inventory…</Text>
                </Flex>
              ) : (
                <Box minW="720px">
                  {/* Sortable header */}
                  <Flex
                    h="34px"
                    px={4}
                    align="center"
                    borderBottom="1px solid"
                    borderColor="whiteAlpha.100"
                    bg="rgba(0,0,0,0.15)"
                    color="gray.500"
                    fontSize="10px"
                    fontWeight="bold"
                    textTransform="uppercase"
                    position="sticky"
                    top={0}
                    zIndex={1}
                  >
                    <Flex w="32px" flexShrink={0} justify="center" align="center">
                      <Checkbox
                        size="sm"
                        isIndeterminate={selectedKeys.size > 0 && selectedKeys.size < filteredRows.length}
                        isChecked={selectedKeys.size > 0 && selectedKeys.size === filteredRows.length}
                        onChange={handleSelectAll}
                        colorScheme="blue"
                        opacity={selectedKeys.size > 0 ? 1 : 0.4}
                        _hover={{ opacity: 1 }}
                      />
                    </Flex>
                    <SortableHeader label="Name" sortKey="name" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} flex={1} />
                    <Box w="200px"><SortableHeader label="Tags" sortKey={null} activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></Box>
                    <Box w="160px"><SortableHeader label="Usage" sortKey="usage" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></Box>
                    <Box w="90px"><SortableHeader label="Updated" sortKey="updatedAt" activeSortKey={sortKey} sortDir={sortDir} onSort={toggleSort} /></Box>
                  </Flex>
                  {filteredRows.map((row) => {
                    const isSelected = selectedKeys.has(row.key)
                    const isHighlighted = selectedRow?.key === row.key && selectedKeys.size === 0
                    const visibleTags = row.tags.slice(0, 3)
                    const hiddenTagCount = row.tags.length - visibleTags.length
                    return (
                      <Flex
                        data-testid="inventory-row"
                        key={row.key}
                        px={4}
                        py={2.5}
                        align="center"
                        borderBottom="1px solid"
                        borderColor="whiteAlpha.50"
                        bg={isSelected ? 'rgba(66, 153, 225, 0.08)' : isHighlighted ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent'}
                        cursor="pointer"
                        role="group"
                        transition="background 0.1s"
                        _hover={{ bg: isSelected ? 'rgba(66, 153, 225, 0.12)' : isHighlighted ? 'rgba(var(--accent-rgb), 0.12)' : 'whiteAlpha.50' }}
                        onClick={() => selectRow(row)}
                      >
                        <Flex
                          w="32px"
                          flexShrink={0}
                          justify="center"
                          align="center"
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
                        </Flex>
                        <HStack flex={1} minW={0} spacing={2.5}>
                          <Box
                            w="3px"
                            h="30px"
                            borderRadius="full"
                            bg={isHighlighted ? 'var(--accent)' : 'transparent'}
                            _groupHover={{ bg: 'var(--accent)' }}
                            flexShrink={0}
                            transition="background 0.15s"
                          />
                          <Box minW={0}>
                            <HStack spacing={2} mb={0.5}>
                              <Text fontSize="sm" fontWeight="semibold" noOfLines={1} color={isHighlighted ? 'white' : 'gray.100'}>{row.name}</Text>
                            </HStack>
                            <Text fontSize="11px" color="gray.500" noOfLines={1}>{row.subtitle}</Text>
                          </Box>
                        </HStack>
                        <HStack w="200px" spacing={1} flexWrap="nowrap" overflow="hidden">
                          {visibleTags.map((tag) => (
                            <Tag
                              key={tag}
                              size="sm"
                              bg="whiteAlpha.100"
                              color="gray.300"
                              fontSize="10px"
                              px={1.5}
                              py={0.5}
                              borderRadius="full"
                              border="1px solid"
                              borderColor="whiteAlpha.100"
                              cursor="pointer"
                              _hover={{ bg: 'rgba(66,153,225,0.15)', borderColor: 'rgba(66,153,225,0.3)', color: 'blue.300' }}
                              onClick={(e) => { e.stopPropagation(); toggleTagFilter(tag) }}
                              transition="all 0.1s"
                            >
                              {tag}
                            </Tag>
                          ))}
                          {hiddenTagCount > 0 && (
                            <Tag size="sm" bg="whiteAlpha.50" color="gray.500" fontSize="10px" px={1.5} borderRadius="full">+{hiddenTagCount}</Tag>
                          )}
                          {row.tags.length === 0 && <Text fontSize="xs" color="gray.700">—</Text>}
                        </HStack>
                        <Text w="160px" fontSize="xs" color="gray.400" noOfLines={1}>{row.usageLabel || '—'}</Text>
                        <Text w="90px" fontSize="xs" color="gray.500">{formatUpdated(row.updatedAt)}</Text>
                      </Flex>
                    )
                  })}
                  {filteredRows.length === 0 && (
                    <Flex h="220px" align="center" justify="center" color="gray.600" direction="column" gap={3}>
                      <Text fontSize="sm" color="gray.500">{query || hasActiveFilters ? 'No matching objects' : 'Nothing here yet'}</Text>
                      <Text fontSize="xs" color="gray.700">{query ? `No results for "${query}"` : hasActiveFilters ? 'Try adjusting your filters' : 'Add elements and views to get started'}</Text>
                      {hasActiveFilters && (
                        <Button size="xs" variant="outline" colorScheme="gray" onClick={resetFilters}>Clear filters</Button>
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

function SortableHeader({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  flex,
}: {
  label: string
  sortKey: 'name' | 'updatedAt' | 'usage' | 'type' | null
  activeSortKey: string
  sortDir: 'asc' | 'desc'
  onSort: (key: 'name' | 'updatedAt' | 'usage' | 'type') => void
  flex?: number
}) {
  const isActive = sortKey !== null && activeSortKey === sortKey
  return (
    <Flex
      align="center"
      gap={1}
      flex={flex}
      cursor={sortKey ? 'pointer' : 'default'}
      color={isActive ? 'gray.200' : 'gray.500'}
      _hover={sortKey ? { color: 'gray.300' } : undefined}
      userSelect="none"
      onClick={sortKey ? () => onSort(sortKey) : undefined}
      role={sortKey ? 'button' : undefined}
    >
      <Text fontSize="10px" fontWeight="bold" textTransform="uppercase">{label}</Text>
      {isActive && (
        <Box flexShrink={0}>
          {sortDir === 'asc' ? <TriangleUpIcon boxSize={2} /> : <TriangleDownIcon boxSize={2} />}
        </Box>
      )}
      {sortKey && !isActive && (
        <Box flexShrink={0} opacity={0.3}>
          <ChevronUpIcon boxSize={2.5} />
        </Box>
      )}
    </Flex>
  )
}
