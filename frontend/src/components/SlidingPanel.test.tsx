import React from 'react'
import { create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import SlidingPanel from './SlidingPanel'

vi.mock('framer-motion', async () => {
  const ReactModule = await import('react')
  const MotionDiv = ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement('div', props, children)

  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children),
    motion: {
      div: MotionDiv,
    },
  }
})

vi.mock('@chakra-ui/react', async () => {
  const ReactModule = await import('react')
  const BoxLike = ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement('div', props, children)
  const FocusLockLike = ({ children, isDisabled }: { children?: React.ReactNode; isDisabled?: boolean }) => (
    ReactModule.createElement('div', { 'data-testid': 'focus-lock', 'data-disabled': String(!!isDisabled) }, children)
  )

  return {
    Box: BoxLike,
    FocusLock: FocusLockLike,
    useBreakpointValue: () => false,
  }
})

vi.mock('../pages/ViewEditor/context', () => ({
  useViewEditorContext: () => ({
    isMarkdownOpen: false,
    markdownPaneWidth: 0,
  }),
}))

describe('SlidingPanel focus lock', () => {
  it('does not trap focus for modeless panels without a backdrop', () => {
    const renderer = create(
      <SlidingPanel isOpen onClose={vi.fn()} panelKey="element" hasBackdrop={false}>
        <button>Panel action</button>
      </SlidingPanel>,
    )

    expect(renderer.root.findByProps({ 'data-testid': 'focus-lock' }).props['data-disabled']).toBe('true')
  })

  it('keeps focus trapped for modal panels with a backdrop', () => {
    const renderer = create(
      <SlidingPanel isOpen onClose={vi.fn()} panelKey="element" hasBackdrop>
        <button>Panel action</button>
      </SlidingPanel>,
    )

    expect(renderer.root.findByProps({ 'data-testid': 'focus-lock' }).props['data-disabled']).toBe('false')
  })
})
