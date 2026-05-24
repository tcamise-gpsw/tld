import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Box, Flex, HStack, VStack, Text, Badge, IconButton } from '@chakra-ui/react'
import { ChevronDownIcon, ChevronUpIcon } from '@chakra-ui/icons'
import { hexToRgba } from '../constants/colors'
import { useTheme } from '../context/ThemeContext'
import { ConnectorInspector } from './InventoryDrawer/ConnectorInspector'
import { ElementInspector } from './InventoryDrawer/ElementInspector'
import type { RelationshipDrawerProps } from './InventoryDrawer/types'
import { getNeighbourGraph } from './InventoryDrawer/utils'
import { ViewInspector } from './InventoryDrawer/ViewInspector'

export type { RelationshipDrawerProps, NeighbourNode } from './InventoryDrawer/types'

export default function RelationshipDrawer({ selectedRow, elements, views, connectors, placementByViewElement, onSelectRow }: RelationshipDrawerProps) {
  const { accent } = useTheme()

  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('diag:InventoryDrawer-expanded') !== 'false'
    }
    return true
  })

  const [drawerHeight, setDrawerHeight] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('diag:InventoryDrawer-height')
      return saved ? parseInt(saved, 10) : 340
    }
    return 340
  })

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev
      localStorage.setItem('diag:InventoryDrawer-expanded', String(next))
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
      localStorage.setItem('diag:InventoryDrawer-height', String(nextHeight))
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!draggingRef.current || e.touches.length !== 1) return
      const deltaY = e.touches[0].clientY - dragStartYRef.current
      const nextHeight = Math.max(160, Math.min(window.innerHeight * 0.75, dragStartHeightRef.current - deltaY))
      setDrawerHeight(nextHeight)
      localStorage.setItem('diag:InventoryDrawer-height', String(nextHeight))
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
    const selectedView = selectedRow.view
    const parentView = selectedView.parent_view_id !== null
      ? views.find((v) => v.id === selectedView.parent_view_id)
      : undefined
    return {
      selectedView,
      parentView,
      childrenViews: selectedView.children || [],
    }
  }, [selectedRow, views])

  const connectorData = useMemo(() => {
    if (selectedRow?.objectType !== 'connector' || !selectedRow.connector) return null
    const conn = selectedRow.connector
    const sourceEl = elements.find((el) => el.id === conn.source_element_id)
    const targetEl = elements.find((el) => el.id === conn.target_element_id)
    const sourcePlacement = placementByViewElement[`${conn.view_id}:${conn.source_element_id}`]
    const targetPlacement = placementByViewElement[`${conn.view_id}:${conn.target_element_id}`]
    return {
      connector: conn,
      sourceEl,
      targetEl,
      sourcePlacement,
      targetPlacement,
    }
  }, [selectedRow, elements, placementByViewElement])

  // Render variables
  const isSelected = !!selectedRow
  const drawerBg = 'var(--bg-panel)'
  const borderCol = 'whiteAlpha.100'

  const cardShadow = useMemo(() => {
    return `0 0 0 3px ${hexToRgba(accent, 0.38)}, 0 18px 48px ${hexToRgba(accent, 0.12)}, 0 10px 36px rgba(0,0,0,0.55), 0 3px 10px rgba(0,0,0,0.4)`
  }, [accent])

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
            Inspect
          </Text>
          {isSelected && (
            <>
              <Box w="4px" h="4px" borderRadius="full" bg="whiteAlpha.400" />
              <Badge size="sm" color="var(--accent)" bg="rgba(var(--accent-rgb), 0.12)" border="1px solid" borderColor="rgba(var(--accent-rgb), 0.2)">
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
      {
        isExpanded && (
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
                  {selectedRow.objectType === 'element' && (
                    <ElementInspector
                      selectedElement={selectedRow.element}
                      neighborGraph={neighborGraph}
                      graphHeight={graphHeight}
                      cardShadow={cardShadow}
                      accent={accent}
                      onSelectRow={onSelectRow}
                    />
                  )}

                  {selectedRow.objectType === 'view' && viewData && (
                    <ViewInspector
                      data={viewData}
                      cardShadow={cardShadow}
                      onSelectRow={onSelectRow}
                      connectors={connectors}
                      placementByViewElement={placementByViewElement}
                      views={views}
                    />
                  )}

                  {selectedRow.objectType === 'connector' && connectorData && (
                    <ConnectorInspector
                      data={connectorData}
                      cardShadow={cardShadow}
                      onSelectRow={onSelectRow}
                    />
                  )}
                </motion.div>
              </div>
            )}
          </Box>
        )
      }
    </Box >
  )
}
