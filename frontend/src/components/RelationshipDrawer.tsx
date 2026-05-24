import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Box,
  Flex,
  HStack,
  VStack,
  Grid,
  Text,
  Badge,
  IconButton,
} from '@chakra-ui/react'
import { ChevronDownIcon, ChevronUpIcon } from '@chakra-ui/icons'
import type { Connector, LibraryElement, ViewTreeNode } from '../types'
import { TYPE_COLORS } from '../types'
import { ElementContainer } from './NodeContainer'
import { ElementBody } from './NodeBody'
import { hexToRgba } from '../constants/colors'
import { useTheme } from '../context/ThemeContext'
import type { InventoryRow } from '../pages/inventoryData'

// ── Data types ─────────────────────────────────────────────────────────────
export interface NeighbourNode {
  element: LibraryElement
  connectors: Connector[]
  position: 'left' | 'right' | 'top' | 'bottom'
}

const TYPE_HEX: Record<string, string> = {
  person: '#4fd1c5',
  system: '#63b3ed',
  container: '#b794f4',
  component: '#f6ad55',
  database: '#76e4f7',
  queue: '#faf089',
  api: '#68d391',
  service: '#fbb6ce',
  external: '#718096',
}

interface RelationshipDrawerProps {
  selectedRow: InventoryRow | null
  elements: LibraryElement[]
  views: ViewTreeNode[]
  connectors: Connector[]
  onSelectRow: (key: string) => void
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getNeighbourGraph(selectedId: number, elements: LibraryElement[], allConnectors: Connector[]): NeighbourNode[] {
  const elementMap = new Map<number, LibraryElement>(elements.map((element) => [element.id, element]))
  const related = allConnectors.filter(
    (connector) => connector.source_element_id === selectedId || connector.target_element_id === selectedId,
  )
  const grouped = new Map<number, Connector[]>()
  related.forEach((connector) => {
    const otherId = connector.source_element_id === selectedId ? connector.target_element_id : connector.source_element_id
    if (!grouped.has(otherId)) grouped.set(otherId, [])
    grouped.get(otherId)!.push(connector)
  })
  const result: NeighbourNode[] = []
  grouped.forEach((connectors, otherId) => {
    const element = elementMap.get(otherId)
    if (!element) return
    let hasIncoming = false
    let hasOutgoing = false
    let hasBoth = false
    let hasUndirected = false
    connectors.forEach((connector) => {
      const dir = connector.direction || 'forward'
      if (dir === 'both' || dir === 'bidirectional') hasBoth = true
      else if (dir === 'none') hasUndirected = true
      else if (dir === 'forward') {
        if (connector.source_element_id === selectedId) hasOutgoing = true
        else hasIncoming = true
      } else if (dir === 'backward') {
        if (connector.source_element_id === selectedId) hasIncoming = true
        else hasOutgoing = true
      }
    })
    let position: NeighbourNode['position']
    if (hasBoth) position = 'top'
    else if (hasUndirected) position = 'bottom'
    else if (hasIncoming && hasOutgoing) position = 'top'
    else if (hasIncoming) position = 'left'
    else position = 'right'
    result.push({ element, connectors, position })
  })
  return result
}

function chunkNodes(nodes: NeighbourNode[], size = 20): NeighbourNode[][] {
  if (nodes.length <= size) return [nodes]
  const chunks: NeighbourNode[][] = []
  for (let index = 0; index < nodes.length; index += size) {
    chunks.push(nodes.slice(index, index + size))
  }
  return chunks
}

// ── Direction indicator ─────────────────────────────────────────────────────
function ConnectionIndicator({
  position,
  compactLevel = 0,
}: {
  position: NeighbourNode['position'] | 'vertical' | 'horizontal'
  compactLevel?: number
}) {
  const orientation = position === 'left' || position === 'right' || position === 'horizontal' ? 'horizontal' : 'vertical'
  const config =
    position === 'bottom'
      ? { icon: '·', label: 'undirected', color: '#94a3b8', tint: 'rgba(148,163,184,0.16)' }
      : position === 'top'
        ? { icon: '↕', label: 'bidirectional', color: '#5eead4', tint: 'rgba(45,212,191,0.16)' }
        : position === 'left'
          ? { icon: '→', label: 'directional', color: '#c4b5fd', tint: 'rgba(167,139,250,0.18)' }
          : position === 'right'
            ? { icon: '→', label: 'directional', color: '#7dd3fc', tint: 'rgba(56,189,248,0.18)' }
            : { icon: '→', label: 'connection', color: '#a0aec0', tint: 'rgba(160,174,192,0.18)' }

  const isCompact = compactLevel >= 2
  const lineColor = `${config.color}66`
  const outerLine = isCompact ? '10px' : '18px'
  const innerLine = isCompact ? '24px' : '44px'
  const firstLineSize = (position === 'right' || position === 'bottom' || position === 'vertical' || position === 'horizontal') ? innerLine : outerLine
  const secondLineSize = (position === 'left' || position === 'top' || position === 'vertical' || position === 'horizontal') ? innerLine : outerLine

  return (
    <Flex
      data-testid="dependencies-connection-indicator"
      data-position={position}
      align="center"
      justify="center"
      direction={orientation === 'horizontal' ? 'row' : 'column'}
      gap={isCompact ? 1 : 1.5}
      flexShrink={0}
      aria-label={config.label}
    >
      <Box
        w={orientation === 'horizontal' ? firstLineSize : '1px'}
        h={orientation === 'vertical' ? firstLineSize : '1px'}
        bg={lineColor}
        borderRadius="full"
      />
      <Flex
        align="center"
        justify="center"
        w={isCompact ? '20px' : '24px'}
        h={isCompact ? '20px' : '24px'}
        borderRadius="full"
        border="1px solid"
        borderColor={lineColor}
        color={config.color}
        bg={config.tint}
        boxShadow={`0 0 0 1px ${config.tint}`}
        fontSize={isCompact ? '11px' : '12px'}
        fontWeight="bold"
      >
        {config.icon}
      </Flex>
      <Box
        w={orientation === 'horizontal' ? secondLineSize : '1px'}
        h={orientation === 'vertical' ? secondLineSize : '1px'}
        bg={lineColor}
        borderRadius="full"
      />
    </Flex>
  )
}

// ── Reused Neighbour Card ───────────────────────────────────────────────────
function ReusableCard({
  name,
  type = '',
  technology = '',
  colorScheme: _colorScheme = 'blue',
  borderColor = 'whiteAlpha.200',
  accentHex = '',
  onClick,
  compactLevel = 0,
  testId = 'dependencies-neighbour-card',
  isSelected = false,
  shadow = undefined,
}: {
  name: string
  type?: string
  technology?: string
  colorScheme?: string
  borderColor?: string
  accentHex?: string
  onClick?: () => void
  compactLevel?: number
  testId?: string
  isSelected?: boolean
  shadow?: string
}) {
  const cardPadding = compactLevel >= 3 ? 1 : compactLevel >= 2 ? 1.5 : compactLevel >= 1 ? 2 : 3
  const showTech = compactLevel < 2 && !!technology
  const showType = compactLevel < 3 && !!type
  const minW = compactLevel >= 2 ? '100px' : '130px'
  const maxW = compactLevel >= 2 ? '160px' : '200px'

  const truncatedName = name.length > 30 ? name.slice(0, 29) + '…' : name
  const nameLen = truncatedName.length
  const nameSize =
    compactLevel >= 3 ? (nameLen > 15 ? '2xs' : 'xs') :
      compactLevel >= 2 ? (nameLen > 20 ? '2xs' : 'xs') :
        compactLevel >= 1 ? (nameLen > 22 ? 'xs' : 'sm') :
          (nameLen > 24 ? 'xs' : 'sm')

  return (
    <motion.div
      data-testid={testId}
      data-pan-block="true"
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.18 }}
    >
      <ElementContainer
        onClick={onClick}
        minW={minW}
        maxW={maxW}
        p={0}
        isSelected={isSelected}
        cursor={onClick ? 'pointer' : 'default'}
        borderColor={isSelected ? borderColor : 'whiteAlpha.200'}
        borderWidth={isSelected ? '2px' : '1px'}
        boxShadow={shadow}
        _hover={onClick ? { borderColor: isSelected ? borderColor : 'var(--accent)', boxShadow: '0 0 0 1px rgba(var(--accent-rgb), 0.25)' } : undefined}
        position="relative"
      >
        {/* Left type-color accent */}
        {accentHex && (
          <Box
            w="3px"
            position="absolute"
            left={0}
            top={0}
            bottom={0}
            borderRadius="l"
            style={{ background: accentHex, opacity: isSelected ? 1 : 0.6 }}
          />
        )}
        <ElementBody
          name={truncatedName}
          type={showType ? type : ''}
          technology={showTech ? technology : undefined}
          nameSize={nameSize}
          align="flex-start"
          p={cardPadding}
          pl={accentHex ? `calc(${cardPadding}px + 4px)` : cardPadding}
        />
      </ElementContainer>
    </motion.div>
  )
}

export default function RelationshipDrawer({
  selectedRow,
  elements,
  views,
  connectors,
  onSelectRow,
}: RelationshipDrawerProps) {
  const { accent } = useTheme()

  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('diag:relationship-drawer-expanded') !== 'false'
    }
    return true
  })

  const [drawerHeight, setDrawerHeight] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('diag:relationship-drawer-height')
      return saved ? parseInt(saved, 10) : 340
    }
    return 340
  })

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev
      localStorage.setItem('diag:relationship-drawer-expanded', String(next))
      return next
    })
  }, [])

  // Resize handling
  const draggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartYRef = useRef(0)
  const dragStartHeightRef = useRef(0)

  const startDrag = useCallback((clientY: number) => {
    draggingRef.current = true
    setIsDragging(true)
    dragStartYRef.current = clientY
    dragStartHeightRef.current = drawerHeight
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [drawerHeight])

  const onResizerMouseDown = useCallback((e: React.MouseEvent) => {
    startDrag(e.clientY)
  }, [startDrag])

  const onResizerTouchStart = useCallback((e: React.TouchEvent) => {
    startDrag(e.touches[0].clientY)
  }, [startDrag])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const deltaY = e.clientY - dragStartYRef.current
      const nextHeight = Math.max(160, Math.min(window.innerHeight * 0.75, dragStartHeightRef.current - deltaY))
      setDrawerHeight(nextHeight)
      localStorage.setItem('diag:relationship-drawer-height', String(nextHeight))
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current || e.touches.length !== 1) return
      const deltaY = e.touches[0].clientY - dragStartYRef.current
      const nextHeight = Math.max(160, Math.min(window.innerHeight * 0.75, dragStartHeightRef.current - deltaY))
      setDrawerHeight(nextHeight)
      localStorage.setItem('diag:relationship-drawer-height', String(nextHeight))
    };

    const stopDrag = () => {
      if (draggingRef.current) {
        draggingRef.current = false
        setIsDragging(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    };

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopDrag)
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', stopDrag)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopDrag)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', stopDrag)
    }
  }, [])

  // Graph layout measurement & Canvas Panning
  const graphRef = useRef<HTMLDivElement>(null)
  const panContainerRef = useRef<HTMLDivElement>(null)
  const canvasPanningRef = useRef(false)
  const canvasPanRef = useRef({ x: 0, y: 0 })
  const canvasPanStartRef = useRef({ touchX: 0, touchY: 0, panX: 0, panY: 0 })
  const [graphHeight, setGraphHeight] = useState(0)

  const applyPan = useCallback((x: number, y: number) => {
    canvasPanRef.current = { x, y }
    if (panContainerRef.current) {
      panContainerRef.current.style.transform = `translate(${x}px, ${y}px)`
    }
  }, [])

  useEffect(() => {
    applyPan(0, 0)
  }, [selectedRow?.key, applyPan])

  const shouldBlockCanvasPan = useCallback((target: EventTarget | null) => {
    return target instanceof HTMLElement && Boolean(target.closest('[data-pan-block="true"]'))
  }, [])

  const startCanvasPan = useCallback((clientX: number, clientY: number, target: EventTarget | null) => {
    if (shouldBlockCanvasPan(target)) return
    canvasPanningRef.current = true
    if (graphRef.current) graphRef.current.style.cursor = 'grabbing'
    canvasPanStartRef.current = {
      touchX: clientX,
      touchY: clientY,
      panX: canvasPanRef.current.x,
      panY: canvasPanRef.current.y,
    }
  }, [shouldBlockCanvasPan])

  const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    startCanvasPan(e.clientX, e.clientY, e.target)
  }, [startCanvasPan])

  const onCanvasTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    startCanvasPan(e.touches[0].clientX, e.touches[0].clientY, e.target)
  }, [startCanvasPan])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!canvasPanningRef.current) return
      applyPan(
        canvasPanStartRef.current.panX + e.clientX - canvasPanStartRef.current.touchX,
        canvasPanStartRef.current.panY + e.clientY - canvasPanStartRef.current.touchY,
      )
    }
    const stopCanvasPan = () => {
      if (!canvasPanningRef.current) return
      canvasPanningRef.current = false
      if (graphRef.current) graphRef.current.style.cursor = 'grab'
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', stopCanvasPan)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', stopCanvasPan)
    }
  }, [applyPan])

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (!canvasPanningRef.current || e.touches.length !== 1) return
      applyPan(
        canvasPanStartRef.current.panX + e.touches[0].clientX - canvasPanStartRef.current.touchX,
        canvasPanStartRef.current.panY + e.touches[0].clientY - canvasPanStartRef.current.touchY,
      )
    }
    const onTouchEnd = () => { canvasPanningRef.current = false }
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd)
    return () => {
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [applyPan])

  useEffect(() => {
    if (!selectedRow?.key) { setGraphHeight(0); return }
    const el = graphRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setGraphHeight(entries[0]?.contentRect.height ?? 0)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [selectedRow?.key, drawerHeight, isExpanded])

  // Data processing based on selected object
  const neighborGraph = useMemo(() => {
    if (selectedRow?.objectType !== 'element') return []
    return getNeighbourGraph(selectedRow.id, elements, connectors)
  }, [selectedRow, elements, connectors])

  const viewData = useMemo(() => {
    if (selectedRow?.objectType !== 'view' || !selectedRow.view) return null
    const selectedView = selectedRow.view as ViewTreeNode
    const parentView = selectedView.parent_view_id !== null
      ? views.find((v) => v.id === selectedView.parent_view_id)
      : null
    return {
      selectedView,
      parentView,
      childrenViews: selectedView.children || [],
    }
  }, [selectedRow, views])

  const connectorData = useMemo(() => {
    if (selectedRow?.objectType !== 'connector' || !selectedRow.connector) return null
    const conn = selectedRow.connector as Connector
    const sourceEl = elements.find((el) => el.id === conn.source_element_id)
    const targetEl = elements.find((el) => el.id === conn.target_element_id)
    return {
      connector: conn,
      sourceEl,
      targetEl,
    }
  }, [selectedRow, elements])

  // Render variables
  const isSelected = !!selectedRow
  const drawerBg = 'var(--bg-panel)'
  const borderCol = 'whiteAlpha.100'

  const cardShadow = useMemo(() => {
    return `0 0 0 3px ${hexToRgba(accent, 0.38)}, 0 18px 48px ${hexToRgba(accent, 0.12)}, 0 10px 36px rgba(0,0,0,0.55), 0 3px 10px rgba(0,0,0,0.4)`
  }, [accent])

  // Split neighbors for element graph
  const leftNodes = neighborGraph.filter((n) => n.position === 'left')
  const rightNodes = neighborGraph.filter((n) => n.position === 'right')
  const topNodes = neighborGraph.filter((n) => n.position === 'top')
  const bottomNodes = neighborGraph.filter((n) => n.position === 'bottom')
  const leftColumns = chunkNodes(leftNodes)
  const rightColumns = chunkNodes(rightNodes)
  const topRows = chunkNodes(topNodes)
  const bottomRows = chunkNodes(bottomNodes)
  const leftColumnSize = Math.max(...leftColumns.map((column) => column.length), 0)
  const rightColumnSize = Math.max(...rightColumns.map((column) => column.length), 0)

  const toCompactLevel = (pxPerSlot: number) =>
    pxPerSlot > 160 ? 0 : pxPerSlot > 110 ? 1 : pxPerSlot > 70 ? 2 : 3

  const leftCompactLevel = toCompactLevel(
    graphHeight > 0 && leftColumnSize > 0 ? graphHeight / leftColumnSize : 999,
  )
  const rightCompactLevel = toCompactLevel(
    graphHeight > 0 && rightColumnSize > 0 ? graphHeight / rightColumnSize : 999,
  )
  const maxCompactLevel = Math.max(leftCompactLevel, rightCompactLevel, 0)
  const colSpacing = maxCompactLevel >= 3 ? 2 : maxCompactLevel >= 2 ? 3 : maxCompactLevel >= 1 ? 5 : 8
  const nodeSpacing = maxCompactLevel >= 2 ? 1 : maxCompactLevel >= 1 ? 2 : 3

  return (
    <Box
      w="full"
      bg={drawerBg}
      borderTop="1px solid"
      borderColor={borderCol}
      display="flex"
      flexDir="column"
      overflow="hidden"
      position="relative"
      transition={isDragging ? 'none' : 'height 0.2s cubic-bezier(0.16, 1, 0.3, 1)'}
      style={{ height: isExpanded ? `${drawerHeight}px` : '40px' }}
      zIndex={20}
    >
      {/* Top Resizer line */}
      {isExpanded && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          h="4px"
          cursor="row-resize"
          zIndex={30}
          onMouseDown={onResizerMouseDown}
          onTouchStart={onResizerTouchStart}
          bg={isDragging ? 'blue.400' : 'transparent'}
          _hover={{ bg: 'blue.400' }}
          transition="background 0.15s"
        />
      )}

      {/* Header bar */}
      <Flex
        h="40px"
        px={4}
        align="center"
        justify="space-between"
        borderBottom={isExpanded ? '1px solid' : 'none'}
        borderColor={borderCol}
        flexShrink={0}
        cursor="pointer"
        onClick={toggleExpand}
        userSelect="none"
        bg="blackAlpha.200"
        _hover={{ bg: 'whiteAlpha.50' }}
      >
        <HStack spacing={2}>
          <Text fontSize="xs" fontWeight="bold" color="gray.400" textTransform="uppercase" letterSpacing="0.08em">
            Relationships & Connections
          </Text>
          {isSelected && (
            <>
              <Box w="4px" h="4px" borderRadius="full" bg="whiteAlpha.400" />
              <Badge size="sm" variant="subtle" colorScheme={selectedRow.objectType === 'element' ? 'green' : selectedRow.objectType === 'view' ? 'purple' : 'orange'}>
                {selectedRow.objectType}
              </Badge>
              <Text fontSize="xs" color="whiteAlpha.800" fontWeight="medium" noOfLines={1} maxW="300px">
                {selectedRow.name}
              </Text>
            </>
          )}
        </HStack>

        <IconButton
          size="xs"
          variant="ghost"
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          icon={isExpanded ? <ChevronDownIcon /> : <ChevronUpIcon />}
          onClick={(e) => {
            e.stopPropagation()
            toggleExpand()
          }}
        />
      </Flex>

      {/* Canvas Area */}
      {isExpanded && (
        <Box
          flex={1}
          minH="120px"
          display="flex"
          alignItems="center"
          justifyContent="center"
          bg="var(--bg-canvas)"
          backgroundImage="radial-gradient(circle, #2D3748 0.5px, transparent 0.5px)"
          backgroundSize="24px 24px"
          position="relative"
          overflow="hidden"
          ref={graphRef}
          onMouseDown={onCanvasMouseDown}
          onTouchStart={onCanvasTouchStart}
          style={{ cursor: 'grab' }}
          sx={{ touchAction: 'none' }}
        >
          {!isSelected ? (
            <VStack spacing={2} opacity={0.5}>
              <Text color="gray.400" fontSize="sm" fontWeight="medium">
                Select an item in the list
              </Text>
              <Text color="gray.600" fontSize="xs">
                Visual relationship graph will appear here
              </Text>
            </VStack>
          ) : (
            <div ref={panContainerRef} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22 }}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  position: 'relative',
                  zIndex: 1,
                  padding: '40px',
                }}
              >
                {/* ── ELEMENT RELATIONS ────────────────────────────────────── */}
                {selectedRow.objectType === 'element' && (
                  <Flex direction="column" align="center">
                    {/* Top group */}
                    {topNodes.length > 0 && (
                      <Flex direction="column" align="center">
                        <VStack spacing={nodeSpacing} align="center">
                          {topRows.map((row, rowIndex) => (
                            <HStack key={`top-row-${rowIndex}`} spacing={nodeSpacing} align="flex-end">
                              {row.map((n) => (
                                <ReusableCard
                                  key={n.element.id}
                                  name={n.element.name}
                                  type={n.element.kind || ''}
                                  technology={n.element.technology || ''}
                                  colorScheme={TYPE_COLORS[n.element.kind || ''] || 'gray'}
                                  accentHex={TYPE_HEX[n.element.kind || '']}
                                  compactLevel={maxCompactLevel}
                                  onClick={() => onSelectRow(`element:${n.element.id}`)}
                                />
                              ))}
                            </HStack>
                          ))}
                        </VStack>
                        <ConnectionIndicator position="top" compactLevel={maxCompactLevel} />
                      </Flex>
                    )}

                    {/* Middle row */}
                    <Grid templateColumns="1fr auto 1fr" gap={colSpacing} alignItems="center" w="full">
                      {/* Left group */}
                      <Flex justify="flex-end">
                        {leftNodes.length > 0 && (
                          <Flex gap={nodeSpacing} align="center">
                            {leftColumns.map((column, columnIndex) => (
                              <VStack key={`left-column-${columnIndex}`} spacing={nodeSpacing} align="flex-end">
                                {column.map((n) => (
                                  <ReusableCard
                                    key={n.element.id}
                                    name={n.element.name}
                                    type={n.element.kind || ''}
                                    technology={n.element.technology || ''}
                                    colorScheme={TYPE_COLORS[n.element.kind || ''] || 'gray'}
                                    accentHex={TYPE_HEX[n.element.kind || '']}
                                    compactLevel={leftCompactLevel}
                                    onClick={() => onSelectRow(`element:${n.element.id}`)}
                                  />
                                ))}
                              </VStack>
                            ))}
                            <ConnectionIndicator position="left" compactLevel={leftCompactLevel} />
                          </Flex>
                        )}
                      </Flex>

                      {/* Center selected element */}
                      <Box position="relative" zIndex={10} isolation="isolate" data-pan-block="true">
                        <ReusableCard
                          isSelected
                          name={selectedRow.element?.name || ''}
                          type={selectedRow.element?.kind || ''}
                          technology={selectedRow.element?.technology || ''}
                          colorScheme={TYPE_COLORS[selectedRow.element?.kind || ''] || 'gray'}
                          borderColor={accent}
                          accentHex={TYPE_HEX[selectedRow.element?.kind || '']}
                          shadow={cardShadow}
                          compactLevel={0}
                        />
                      </Box>

                      {/* Right group */}
                      <Flex justify="flex-start">
                        {rightNodes.length > 0 && (
                          <Flex gap={nodeSpacing} align="center">
                            <ConnectionIndicator position="right" compactLevel={rightCompactLevel} />
                            {rightColumns.map((column, columnIndex) => (
                              <VStack key={`right-column-${columnIndex}`} spacing={nodeSpacing} align="flex-start">
                                {column.map((n) => (
                                  <ReusableCard
                                    key={n.element.id}
                                    name={n.element.name}
                                    type={n.element.kind || ''}
                                    technology={n.element.technology || ''}
                                    colorScheme={TYPE_COLORS[n.element.kind || ''] || 'gray'}
                                    accentHex={TYPE_HEX[n.element.kind || '']}
                                    compactLevel={rightCompactLevel}
                                    onClick={() => onSelectRow(`element:${n.element.id}`)}
                                  />
                                ))}
                              </VStack>
                            ))}
                          </Flex>
                        )}
                      </Flex>
                    </Grid>

                    {/* Bottom group */}
                    {bottomNodes.length > 0 && (
                      <Flex direction="column" align="center">
                        <ConnectionIndicator position="bottom" compactLevel={maxCompactLevel} />
                        <VStack spacing={nodeSpacing} align="center">
                          {bottomRows.map((row, rowIndex) => (
                            <HStack key={`bottom-row-${rowIndex}`} spacing={nodeSpacing} align="flex-start">
                              {row.map((n) => (
                                <ReusableCard
                                  key={n.element.id}
                                  name={n.element.name}
                                  type={n.element.kind || ''}
                                  technology={n.element.technology || ''}
                                  colorScheme={TYPE_COLORS[n.element.kind || ''] || 'gray'}
                                  accentHex={TYPE_HEX[n.element.kind || '']}
                                  compactLevel={maxCompactLevel}
                                  onClick={() => onSelectRow(`element:${n.element.id}`)}
                                />
                              ))}
                            </HStack>
                          ))}
                        </VStack>
                      </Flex>
                    )}

                    {neighborGraph.length === 0 && (
                      <Text color="gray.600" fontSize="sm" fontStyle="italic" mt={2} data-pan-block="true">
                        No direct connections found.
                      </Text>
                    )}
                  </Flex>
                )}

                {/* ── VIEW HIERARCHY (PARENT & CHILDREN) ───────────────────────── */}
                {selectedRow.objectType === 'view' && viewData && (
                  <Flex direction="column" align="center">
                    {/* Top: Parent View */}
                    {viewData.parentView ? (
                      <Flex direction="column" align="center">
                        <ReusableCard
                          name={viewData.parentView.name}
                          type={viewData.parentView.level_label || 'View'}
                          colorScheme="purple"
                          borderColor="purple.300"
                          compactLevel={1}
                          onClick={() => onSelectRow(`view:${viewData.parentView!.id}`)}
                        />
                        <ConnectionIndicator position="vertical" compactLevel={1} />
                      </Flex>
                    ) : (
                      <Text color="gray.600" fontSize="2xs" fontWeight="bold" textTransform="uppercase" mb={2}>
                        Root View
                      </Text>
                    )}

                    {/* Center: Selected View */}
                    <Box position="relative" zIndex={10} isolation="isolate" data-pan-block="true">
                      <ReusableCard
                        isSelected
                        name={viewData.selectedView.name}
                        type={viewData.selectedView.level_label || 'View'}
                        colorScheme="purple"
                        borderColor="purple.400"
                        shadow={cardShadow}
                        compactLevel={0}
                      />
                    </Box>

                    {/* Bottom: Child Views */}
                    {viewData.childrenViews.length > 0 ? (
                      <Flex direction="column" align="center">
                        <ConnectionIndicator position="vertical" compactLevel={1} />
                        <HStack spacing={4} wrap="wrap" justify="center" maxW="80vw" data-pan-block="true">
                          {viewData.childrenViews.map((child) => (
                            <ReusableCard
                              key={child.id}
                              name={child.name}
                              type={child.level_label || 'View'}
                              colorScheme="purple"
                              borderColor="purple.200"
                              compactLevel={1}
                              onClick={() => onSelectRow(`view:${child.id}`)}
                            />
                          ))}
                        </HStack>
                      </Flex>
                    ) : (
                      <Text color="gray.600" fontSize="2xs" fontWeight="bold" textTransform="uppercase" mt={4}>
                        No child views
                      </Text>
                    )}
                  </Flex>
                )}

                {/* ── CONNECTOR VIEW (SOURCE, CONNECTOR & TARGET) ─────────────── */}
                {selectedRow.objectType === 'connector' && connectorData && (
                  <Flex align="center" justify="center">
                    {/* Left: Source Element */}
                    {connectorData.sourceEl ? (
                      <ReusableCard
                        name={connectorData.sourceEl.name}
                        type={connectorData.sourceEl.kind || 'element'}
                        technology={connectorData.sourceEl.technology || ''}
                        colorScheme={TYPE_COLORS[connectorData.sourceEl.kind || ''] || 'gray'}
                        accentHex={TYPE_HEX[connectorData.sourceEl.kind || '']}
                        compactLevel={1}
                        onClick={() => onSelectRow(`element:${connectorData.sourceEl!.id}`)}
                      />
                    ) : (
                      <Text color="gray.600" fontSize="xs" fontStyle="italic">
                        Unknown Source
                      </Text>
                    )}

                    <ConnectionIndicator position="horizontal" compactLevel={1} />

                    {/* Center: Selected Connector */}
                    <Box position="relative" zIndex={10} isolation="isolate" mx={2} data-pan-block="true">
                      <ReusableCard
                        isSelected
                        name={selectedRow.name}
                        type={connectorData.connector.relationship || 'Connector'}
                        colorScheme="orange"
                        borderColor="orange.400"
                        shadow={cardShadow}
                        compactLevel={0}
                      />
                    </Box>

                    <ConnectionIndicator position="horizontal" compactLevel={1} />

                    {/* Right: Target Element */}
                    {connectorData.targetEl ? (
                      <ReusableCard
                        name={connectorData.targetEl.name}
                        type={connectorData.targetEl.kind || 'element'}
                        technology={connectorData.targetEl.technology || ''}
                        colorScheme={TYPE_COLORS[connectorData.targetEl.kind || ''] || 'gray'}
                        accentHex={TYPE_HEX[connectorData.targetEl.kind || '']}
                        compactLevel={1}
                        onClick={() => onSelectRow(`element:${connectorData.targetEl!.id}`)}
                      />
                    ) : (
                      <Text color="gray.600" fontSize="xs" fontStyle="italic">
                        Unknown Target
                      </Text>
                    )}
                  </Flex>
                )}
              </motion.div>
            </div>
          )}
        </Box>
      )}
    </Box>
  )
}
