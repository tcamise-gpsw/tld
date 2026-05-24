import { Box, Flex } from '@chakra-ui/react'
import type { NeighbourNode } from './types'

interface ConnectionIndicatorProps {
  position: NeighbourNode['position'] | 'vertical' | 'horizontal'
  compactLevel?: number
}

export function ConnectionIndicator({ position, compactLevel = 0 }: ConnectionIndicatorProps) {
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
  const firstLineSize =
    position === 'right' || position === 'bottom' || position === 'vertical' || position === 'horizontal'
      ? innerLine
      : outerLine
  const secondLineSize =
    position === 'left' || position === 'top' || position === 'vertical' || position === 'horizontal'
      ? innerLine
      : outerLine

  return (
    <Flex
      data-testid="inventory-connector-indicator"
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
