import React from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import SelectionBulkBar from './SelectionBulkBar'

vi.mock('@chakra-ui/react', async () => {
  const ReactModule = await import('react')
  const BoxLike = ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement('div', props, children)
  const ButtonLike = ({
    children,
    icon,
    onClick,
    ...props
  }: {
    children?: React.ReactNode
    icon?: React.ReactNode
    onClick?: () => void
  }) => ReactModule.createElement('button', { ...props, onClick }, icon, children)

  return {
    Box: BoxLike,
    Button: ButtonLike,
    HStack: BoxLike,
    IconButton: ButtonLike,
    Popover: BoxLike,
    PopoverBody: BoxLike,
    PopoverContent: BoxLike,
    PopoverTrigger: BoxLike,
    Portal: BoxLike,
    Text: BoxLike,
    Tooltip: BoxLike,
    VStack: BoxLike,
  }
})

vi.mock('../../../components/TagUpsert', () => ({
  default: () => null,
}))

function renderBulkBar(overrides: Partial<React.ComponentProps<typeof SelectionBulkBar>> = {}) {
  return create(
    <SelectionBulkBar
      count={2}
      availableTags={[]}
      selectedTagCounts={{}}
      tagColors={{}}
      onAlign={vi.fn()}
      onDistribute={vi.fn()}
      onFitSelection={vi.fn()}
      onAddTag={vi.fn()}
      onRemoveTag={vi.fn()}
      onRemoveFromView={vi.fn()}
      onCopyMermaid={vi.fn()}
      {...overrides}
    />,
  )
}

describe('SelectionBulkBar bulk merge', () => {
  it('hides the merge button when fewer than two elements are selected', () => {
    const renderer = renderBulkBar({
      count: 1,
      mergeOptions: [
        { id: 1, name: 'API' },
        { id: 2, name: 'Worker' },
      ],
      onMergeInto: vi.fn(),
    })

    expect(renderer.root.findAllByProps({ 'data-testid': 'selection-bulk-merge' })).toHaveLength(0)
  })

  it('renders survivor choices and calls onMergeInto with the selected id', () => {
    const onMergeInto = vi.fn()
    const renderer = renderBulkBar({
      mergeOptions: [
        { id: 1, name: 'API', kind: 'service' },
        { id: 2, name: 'Worker', kind: 'job' },
      ],
      onMergeInto,
    })

    expect(renderer.root.findByProps({ 'data-testid': 'selection-bulk-merge' })).toBeTruthy()
    expect(renderer.root.findByProps({ 'data-testid': 'selection-bulk-merge-survivor-1' })).toBeTruthy()

    act(() => {
      renderer.root.findByProps({ 'data-testid': 'selection-bulk-merge-survivor-2' }).props.onClick()
    })

    expect(onMergeInto).toHaveBeenCalledWith(2)
  })
})

describe('SelectionBulkBar copy as mermaid', () => {
  it('renders copy as mermaid button and calls onCopyMermaid when clicked', () => {
    const onCopyMermaid = vi.fn()
    const renderer = renderBulkBar({ onCopyMermaid })

    const button = renderer.root.findByProps({ 'data-testid': 'selection-bulk-copy-mermaid' })
    expect(button).toBeTruthy()

    act(() => {
      button.props.onClick()
    })

    expect(onCopyMermaid).toHaveBeenCalled()
  })
})
