import { memo } from 'react'
import { Box, BoxProps, forwardRef } from '@chakra-ui/react'

export interface ElementContainerProps extends BoxProps {
  isSelected?: boolean
  isSource?: boolean
  isTarget?: boolean
  isConnectorHighlighted?: boolean
  hasStack?: boolean
  kind?: string | null
}

export const ElementContainer = memo(forwardRef<ElementContainerProps, 'div'>(({
  isSelected,
  isSource,
  isTarget,
  isConnectorHighlighted,
  hasStack,
  kind: _kind,
  children,
  ...props
}, ref) => {
  const accent = 'var(--accent)'
  const accentRgb = 'var(--accent-rgb)'
  const brandedBorder = 'rgba(160, 174, 192, 0.5)'

  const borderColor = isSource
    ? accent
    : isTarget
      ? 'teal.300'
      : isSelected || isConnectorHighlighted
        ? accent
        : brandedBorder

  const restingShadow = '0 6px 10px rgba(0,0,0,0.35)'
  const hoverDepthShadow = '0 8px 14px rgba(0,0,0,0.42)'
  const stackShadow = 'drop-shadow(0 8px 10px rgba(0,0,0,0.7))'
  const stackHoverShadow = 'drop-shadow(0 10px 12px rgba(0,0,0,0.9))'
  const stateRing = isSource
    ? `0 0 0 2px rgba(${accentRgb}, 0.5)`
    : isSelected
      ? `0 0 0 2px rgba(${accentRgb}, 0.35)`
      : isConnectorHighlighted
        ? `0 0 0 1px rgba(${accentRgb}, 0.25)`
        : null

  const boxShadow = hasStack
    ? stateRing ?? 'none'
    : stateRing ? `${stateRing}, ${restingShadow}` : restingShadow
  const hoverShadow = hasStack
    ? stateRing ?? 'none'
    : stateRing ? `${stateRing}, ${hoverDepthShadow}` : hoverDepthShadow

  const finalBorderColor = borderColor

  return (
    <Box
      position="relative"
      zIndex={1}
      role="group"
      filter={hasStack ? stackShadow : undefined}
      transition="filter var(--chakra-transitions-duration-fast) var(--chakra-transitions-easing-pop)"
      _hover={hasStack ? { filter: stackHoverShadow } : undefined}
    >
      {hasStack && (
        <>
          {/* Stack effect matching ZUI renderer.ts (offset 4px and 8px) */}
          <Box
            position="absolute"
            inset={0}
            transform="translate(8px, 8px)"
            bg="var(--bg-element)"
            borderColor={finalBorderColor}
            borderWidth="1px"
            rounded="lg"
            opacity={0.4}
            zIndex={-2}
          />
          <Box
            position="absolute"
            inset={0}
            transform="translate(4px, 4px)"
            bg="var(--bg-element)"
            borderColor={finalBorderColor}
            borderWidth="1px"
            rounded="lg"
            opacity={0.7}
            zIndex={-1}
          />
        </>
      )}
      <Box
        ref={ref}
        bg="var(--bg-element)"
        borderColor={finalBorderColor}
        borderWidth="1px"
        rounded="lg"
        boxShadow={boxShadow}
        transition="all var(--chakra-transitions-duration-fast) var(--chakra-transitions-easing-pop)"
        position="relative"
        _groupHover={hasStack ? {
          borderColor: isSource ? accent : isTarget ? 'teal.200' : accent,
          boxShadow: hoverShadow,
        } : undefined}
        _hover={{
          borderColor: isSource ? accent : isTarget ? 'teal.200' : accent,
          boxShadow: hoverShadow,
        }}
        {...props}
      >
        {children}
      </Box>
    </Box>
  )
}))
