import React from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import CrossBranchControls from './CrossBranchControls'

vi.mock('@chakra-ui/react', async () => {
  const ReactModule = await import('react')
  const BoxLike = ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement('div', props, children)
  const ButtonLike = ({ children, onClick, ...props }: { children?: React.ReactNode; onClick?: () => void }) => ReactModule.createElement('button', { ...props, onClick }, children)

  return {
    Box: BoxLike,
    Button: ButtonLike,
    HStack: BoxLike,
    Popover: BoxLike,
    PopoverBody: BoxLike,
    PopoverContent: BoxLike,
    PopoverTrigger: BoxLike,
    Portal: BoxLike,
    Slider: ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement('div', props, children),
    SliderFilledTrack: BoxLike,
    SliderThumb: BoxLike,
    SliderTrack: BoxLike,
    Switch: ({ isChecked, onChange, ...props }: { isChecked?: boolean; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => ReactModule.createElement('input', {
      ...props,
      checked: isChecked,
      type: 'checkbox',
      onChange,
    }),
    Text: BoxLike,
    VStack: BoxLike,
    useDisclosure: () => {
      const [isOpen, setIsOpen] = ReactModule.useState(false)
      return {
        isOpen,
        onClose: () => setIsOpen(false),
        onToggle: () => setIsOpen((value: boolean) => !value),
      }
    },
  }
})

function renderControls(overrides: Partial<React.ComponentProps<typeof CrossBranchControls>> = {}) {
  let renderer!: ReturnType<typeof create>
  act(() => {
    renderer = create(
      <CrossBranchControls
        settings={{
          enabled: true,
          depth: 3,
          connectorBudget: 10,
          connectorPriority: 'external',
        }}
        onEnabledChange={vi.fn()}
        onBudgetChange={vi.fn()}
        onPriorityChange={vi.fn()}
        label="Filters"
        {...overrides}
      />,
    )
  })
  return renderer
}

describe('CrossBranchControls', () => {
  it('reports popover open state changes', () => {
    const onOpenChange = vi.fn()
    const renderer = renderControls({ onOpenChange })
    const toggle = renderer.root.findByProps({ 'aria-label': 'Open Filters filters' })

    act(() => {
      toggle.props.onClick()
    })

    act(() => {
      toggle.props.onClick()
    })

    expect(onOpenChange.mock.calls.map(([isOpen]) => isOpen)).toEqual([false, true, false])
  })
})