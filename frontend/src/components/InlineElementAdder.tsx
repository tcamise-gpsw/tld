import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Input, Text } from '@chakra-ui/react'
import type { LibraryElement } from '../types'
import { useElementSearch } from '../hooks/useElementSearch'
import ElementCreateSearchResults from './ElementCreateSearchResults'
import { buildElementCreateSearchResults } from './elementCreateSearch'

interface Props {
  x: number
  y: number
  allElements: LibraryElement[]
  existingElementIds: Set<number>
  onConfirmNew: (name: string) => Promise<void>
  onConfirmExisting: (obj: LibraryElement) => Promise<void>
  onCancel: () => void
  expandResults?: boolean
  allowCreate?: boolean
  placeholder?: string
  title?: string
  getSecondaryLabel?: (obj: LibraryElement) => string | null
}

export default function InlineElementAdder({
  x,
  y,
  allElements,
  existingElementIds,
  onConfirmNew,
  onConfirmExisting,
  onCancel,
  expandResults = false,
  allowCreate = true,
  placeholder = 'Search or create new element...',
  title,
  getSecondaryLabel,
}: Props) {
  const { query, setQuery, remoteElements } = useElementSearch()
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const focusInput = useCallback(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  useLayoutEffect(() => {
    focusInput()
  }, [focusInput])

  useEffect(() => {
    focusInput()
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(focusInput) : null
    const timers = [0, 50, 100, 200, 350].map((delay) => setTimeout(focusInput, delay))
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      timers.forEach(clearTimeout)
    }
  }, [focusInput])

  const results = buildElementCreateSearchResults({ query, allElements, remoteElements, allowCreate })

  useEffect(() => { setActiveIndex(0) }, [query])

  const confirm = async (idx: number) => {
    const item = results[idx]
    if (!item || busy) return
    setBusy(true)
    try {
      if (item.kind === 'new') {
        await onConfirmNew(item.label)
      } else {
        await onConfirmExisting(item.obj)
      }
    } finally {
      setBusy(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { onCancel(); return }
    if (e.key === 'Enter') { e.preventDefault(); confirm(activeIndex); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    }
  }

  return (
    <Box
      position="absolute"
      left={`${x}px`}
      top={`${y}px`}
      zIndex={2000}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      display="flex"
      flexDirection="column"
      alignItems="center"
      pointerEvents="none"
    >
      <Box position="relative" pointerEvents="auto" transform="translate(-50%, -50%)">
        <Input
          data-testid="inline-element-adder-input"
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          size="sm"
          w="220px"
          bg="var(--bg-panel)"
          border="2px solid"
          borderColor="var(--accent)"
          _focus={{ borderColor: 'var(--accent)', boxShadow: 'none' }}
          rounded="md"
          color="white"
          isDisabled={busy}
          autoComplete="off"
          autoFocus
        />
        {title && (
          <Box position="absolute" left="8px" top="-18px" zIndex={2002}>
            <Text fontSize="10px" color="gray.400" fontWeight="700" letterSpacing="0.06em" textTransform="uppercase">
              {title}
            </Text>
          </Box>
        )}

        {/* Results Box */}
        {results.length > 0 && (
          <Box
            position="absolute"
            left={expandResults ? 'calc(100% + 8px)' : '0'}
            top={expandResults ? '50%' : 'calc(100% + 4px)'}
            transform={expandResults ? 'translateY(-50%)' : undefined}
            zIndex={2001}
            bg="var(--bg-panel)"
            border="1px solid"
            borderColor="whiteAlpha.100"
            rounded="xl"
            shadow="0 8px 32px rgba(0,0,0,0.5)"
            minW="220px"
            maxW={expandResults ? '340px' : '280px'}
            w="max-content"
            maxH="300px"
            overflowY="auto"
            flexShrink={0}
          >
            <ElementCreateSearchResults
              results={results}
              activeIndex={activeIndex}
              busy={busy}
              query={query}
              existingElementIds={existingElementIds}
              testIdPrefix="inline-element-adder"
              getSecondaryLabel={getSecondaryLabel}
              onActiveIndexChange={setActiveIndex}
              onConfirm={confirm}
            />
          </Box>
        )}
      </Box>
    </Box>
  )
}
