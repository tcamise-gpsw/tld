import React, { useEffect, useState, useRef } from 'react'
import { Box, Flex, Text, Spinner, Menu, MenuButton, MenuList, Portal, MenuItem } from '@chakra-ui/react'
import { keyframes } from '@emotion/react'
import { api } from '../../api/client'
import { hexToRgba } from '../../constants/colors'
import { useTheme } from '../../context/ThemeContext'
import type { Connector, ViewTreeNode } from '../../types'

const shimmer = keyframes`
  0%   { background-position: -260px 0 }
  100% { background-position: 260px 0 }
`

interface ViewRelationshipCardProps {
  viewId?: number
  name: string
  levelLabel: string | null
  nodesCount?: number
  edgesCount?: number
  isCluster?: boolean
  collapsedCount?: number
  isSelected?: boolean
  onClick?: () => void
  collapsedViews?: ViewTreeNode[]
  onSelectRow?: (key: string) => void
}

export function ViewRelationshipCard({
  viewId,
  name,
  levelLabel,
  nodesCount = 0,
  edgesCount = 0,
  isCluster = false,
  collapsedCount = 0,
  isSelected = false,
  onClick,
  collapsedViews = [],
  onSelectRow,
}: ViewRelationshipCardProps) {
  const { accent } = useTheme()
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (isCluster || !viewId) return

    let active = true
    let url: string | null = null

    const loadThumbnail = async () => {
      setIsLoading(true)
      try {
        url = await api.workspace.views.thumbnail(viewId)
        if (active && url) {
          setThumbnailUrl(url)
        }
      } catch (err) {
        console.error('Failed to load thumbnail:', err)
      } finally {
        if (active) setIsLoading(false)
      }
    }

    loadThumbnail()

    return () => {
      active = false
      if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url)
      }
    }
  }, [viewId, isCluster])

  const borderColor = isSelected ? accent : 'rgba(255,255,255,0.14)'

  const boxShadow = isSelected
    ? `0 0 24px ${hexToRgba(accent, 0.4)}`
    : isCluster
      ? '0 14px 34px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.05)'
      : '0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)'

  const cardContent = (
    <Box
      w="260px"
      h="150px"
      position="relative"
      userSelect="none"
      transition="opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1)"
      _before={isCluster ? {
        content: '""',
        position: 'absolute',
        inset: '8px -9px -8px 9px',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.08)',
        bg: 'rgba(var(--bg-element-rgb), 0.55)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.28)',
      } : undefined}
      _after={isCluster ? {
        content: '""',
        position: 'absolute',
        inset: '16px -18px -16px 18px',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.06)',
        bg: 'rgba(var(--bg-element-rgb), 0.35)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
      } : undefined}
    >
      <Box
        position="absolute"
        inset={0}
        bg="var(--bg-card-solid)"
        borderRadius="12px"
        border="1.5px solid"
        borderColor={borderColor}
        boxShadow={boxShadow}
        transform={isSelected ? 'scale(1.025) translateY(-2px)' : 'scale(1)'}
        cursor="pointer"
        transition="all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
        overflow="hidden"
        _hover={{
          borderColor: isSelected
            ? borderColor
            : 'rgba(255,255,255,0.3)',
          boxShadow: isSelected
            ? boxShadow
            : '0 14px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
          transform: isSelected
            ? undefined
            : 'scale(1.015) translateY(-1px)',
        }}
      >
        {/* Thumbnail Area */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom="64px"
          overflow="hidden"
          borderRadius="8px 8px 0 0"
          flexShrink={0}
          bg={isCluster ? 'rgba(var(--bg-element-rgb), 0.88)' : '#0f172a'}
        >
          {isCluster ? (
            <Flex
              position="absolute"
              inset={0}
              p={3}
              gap={1.5}
              align="flex-start"
              justify="flex-start"
              wrap="wrap"
              bg="radial-gradient(circle at 80% 18%, rgba(var(--accent-rgb), 0.16), transparent 42px), linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))"
            >
              {Array.from({ length: Math.min(18, Math.max(6, collapsedCount ?? 6)) }).map((_, i) => (
                <Box
                  key={i}
                  w={`${18 + (i % 4) * 6}px`}
                  h="14px"
                  borderRadius="5px"
                  bg={i % 5 === 0 ? hexToRgba(accent, 0.2) : 'rgba(255,255,255,0.06)'}
                  border="1px solid"
                  borderColor={i % 5 === 0 ? hexToRgba(accent, 0.34) : 'rgba(255,255,255,0.07)'}
                />
              ))}
            </Flex>
          ) : thumbnailUrl ? (
            <Box
              as="img"
              src={thumbnailUrl}
              w="100%"
              h="100%"
              objectFit="contain"
              display="block"
              p={2}
              bg="#0f172a"
            />
          ) : (
            <Flex
              w="100%"
              h="100%"
              align="center"
              justify="center"
              background="linear-gradient(90deg, var(--bg-element) 25%, color-mix(in srgb, var(--bg-element), white 5%) 50%, var(--bg-element) 75%)"
              backgroundSize="520px 100%"
              sx={{ animation: !isLoading ? `${shimmer} 1.4s ease infinite` : 'none' }}
            >
              {isLoading && <Spinner size="sm" color="whiteAlpha.400" />}
            </Flex>
          )}
        </Box>

        {/* Info Area */}
        <Flex
          direction="column"
          position="absolute"
          bottom={0}
          left={0}
          right={0}
          h="64px"
          px={3}
          pt={2}
          pb={2}
          bg="color-mix(in srgb, rgba(var(--bg-element-rgb), 0.7), black 20%)"
          backdropFilter="blur(1px) saturate(180%)"
          borderTop="1px solid rgba(255, 255, 255, 0.08)"
          boxShadow="0 -4px 12px rgba(0,0,0,0.15)"
        >
          <Flex align="flex-start" gap={1.5} flex={1} minH={0}>
            <Text
              flex={1}
              minW={0}
              fontSize="sm"
              fontWeight="semibold"
              color="gray.100"
              noOfLines={1}
              lineHeight={1.35}
              textShadow="0 1px 2px rgba(0,0,0,0.5)"
            >
              {name}
            </Text>
          </Flex>

          <Flex align="center" justify="space-between" flexShrink={0} gap={1}>
            {levelLabel ? (
              <Text
                fontSize="9px"
                color="var(--accent)"
                textTransform="uppercase"
                letterSpacing="0.1em"
                fontWeight="bold"
                flexShrink={0}
                textShadow="0 1px 2px rgba(0,0,0,0.5)"
              >
                {levelLabel}
              </Text>
            ) : (
              <Box flexShrink={0} />
            )}

            <Text
              fontSize="10px"
              color="gray.400"
              letterSpacing="0.01em"
              flexShrink={0}
              textShadow="0 1px 2px rgba(0,0,0,0.5)"
            >
              {isCluster
                ? `${collapsedCount} views`
                : `${nodesCount}n · ${edgesCount}e`}
            </Text>
          </Flex>
        </Flex>
      </Box>
    </Box>
  )

  if (isCluster && onSelectRow && collapsedViews.length > 0) {
    return (
      <Menu isLazy placement="top">
        <MenuButton as="div" cursor="pointer">
          {cardContent}
        </MenuButton>
        <Portal>
          <MenuList
            bg="var(--bg-panel)"
            borderColor="var(--border-main)"
            py={1}
            zIndex={1000}
            fontSize="sm"
            boxShadow="2xl"
          >
            {collapsedViews.map((v) => (
              <MenuItem
                key={v.id}
                onClick={() => onSelectRow(`view:${v.id}`)}
                bg="transparent"
                color="gray.300"
                _hover={{ bg: 'whiteAlpha.100', color: 'white' }}
                _focus={{ bg: 'whiteAlpha.100' }}
              >
                {v.name} ({v.level_label || `Level ${v.level}`})
              </MenuItem>
            ))}
          </MenuList>
        </Portal>
      </Menu>
    )
  }

  return (
    <Box onClick={onClick}>
      {cardContent}
    </Box>
  )
}

interface ViewRelationshipData {
  selectedView: ViewTreeNode
  parentView: ViewTreeNode | undefined
  childrenViews: ViewTreeNode[]
}

interface ViewInspectorProps {
  data: ViewRelationshipData
  onSelectRow: (key: string) => void
  connectors?: Connector[]
  placementByViewElement?: Record<string, { x: number; y: number }>
  views?: ViewTreeNode[]
}

export function ViewInspector({
  data,
  onSelectRow,
  connectors = [],
  placementByViewElement = {},
  views = [],
}: ViewInspectorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const selectedView = data.selectedView
  const parentView = selectedView.parent_view_id !== null
    ? (views.find((v) => v.id === selectedView.parent_view_id) || data.parentView)
    : undefined

  const rawChildren = views.length > 0
    ? views.filter((v) => v.parent_view_id === selectedView.id)
    : data.childrenViews

  const getViewCounts = (viewId: number) => {
    const nodes = Object.keys(placementByViewElement).filter((key) =>
      key.startsWith(`${viewId}:`)
    ).length
    const edges = connectors.filter((c) => c.view_id === viewId).length
    return { nodes, edges }
  }

  const selectedCounts = getViewCounts(selectedView.id)

  const parentComponent = parentView ? (
    <Flex direction="column" align="center">
      <ViewRelationshipCard
        viewId={parentView.id}
        name={parentView.name}
        levelLabel={parentView.level_label || `Level ${parentView.level}`}
        nodesCount={getViewCounts(parentView.id).nodes}
        edgesCount={getViewCounts(parentView.id).edges}
        onClick={() => onSelectRow(`view:${parentView.id}`)}
      />
      <Box w="1px" h="40px" bg="rgba(255,255,255,0.2)" />
    </Flex>
  ) : (
    <Text color="gray.600" fontSize="2xs" fontWeight="bold" textTransform="uppercase" mb={4}>
      Root View
    </Text>
  )

  const childrenGap = 16
  const childrenCardW = 260
  const childrenCount = rawChildren.length
  const totalChildrenW = childrenCount * childrenCardW + (childrenCount - 1) * childrenGap
  const shouldCollapseChildren = childrenCount > 0 && totalChildrenW > containerWidth - 48

  let childrenComponent = null

  if (childrenCount > 0) {
    if (shouldCollapseChildren) {
      const collapsedCounts = rawChildren.reduce(
        (acc, v) => {
          const counts = getViewCounts(v.id)
          acc.nodes += counts.nodes
          acc.edges += counts.edges
          return acc
        },
        { nodes: 0, edges: 0 }
      )

      childrenComponent = (
        <Flex direction="column" align="center">
          <Box w="1px" h="40px" bg="rgba(255,255,255,0.2)" style={{ borderLeft: '1px dashed rgba(255,255,255,0.28)' }} />
          <ViewRelationshipCard
            name="Child Views"
            levelLabel="Collapsed stack"
            isCluster
            collapsedCount={childrenCount}
            nodesCount={collapsedCounts.nodes}
            edgesCount={collapsedCounts.edges}
            collapsedViews={rawChildren}
            onSelectRow={onSelectRow}
          />
        </Flex>
      )
    } else {
      childrenComponent = (
        <Flex direction="column" align="center" width="full">
          <Box w="1px" h="30px" bg="rgba(255,255,255,0.2)" />
          <Flex justify="center" align="stretch" width="full" position="relative">
            {rawChildren.map((child, idx) => {
              const isFirst = idx === 0
              const isLast = idx === rawChildren.length - 1
              const isOnly = rawChildren.length === 1
              const counts = getViewCounts(child.id)

              return (
                <Flex key={child.id} direction="column" align="center" position="relative" px={2}>
                  {!isOnly && (
                    <Box
                      position="absolute"
                      top={0}
                      left={isFirst ? "50%" : 0}
                      right={isLast ? "50%" : 0}
                      h="1px"
                      bg="rgba(255,255,255,0.2)"
                    />
                  )}

                  <Box w="1px" h="30px" bg="rgba(255,255,255,0.2)" />

                  <ViewRelationshipCard
                    viewId={child.id}
                    name={child.name}
                    levelLabel={child.level_label || `Level ${child.level}`}
                    nodesCount={counts.nodes}
                    edgesCount={counts.edges}
                    onClick={() => onSelectRow(`view:${child.id}`)}
                  />
                </Flex>
              )
            })}
          </Flex>
        </Flex>
      )
    }
  } else {
    childrenComponent = (
      <Text color="gray.600" fontSize="2xs" fontWeight="bold" textTransform="uppercase" mt={6}>
        No child views
      </Text>
    )
  }

  return (
    <Flex ref={containerRef} direction="column" align="center" width="full" maxW="100%" px={4} data-pan-block="true">
      {parentComponent}

      <Box position="relative" zIndex={10} isolation="isolate">
        <ViewRelationshipCard
          isSelected
          viewId={selectedView.id}
          name={selectedView.name}
          levelLabel={selectedView.level_label || `Level ${selectedView.level}`}
          nodesCount={selectedCounts.nodes}
          edgesCount={selectedCounts.edges}
        />
      </Box>

      {childrenComponent}
    </Flex>
  )
}
