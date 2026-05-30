import React from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryElement } from '../types'
import ElementPanel from './ElementPanel'

const apiMocks = vi.hoisted(() => ({
  createElement: vi.fn(),
  updateElement: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: {
    elements: {
      create: apiMocks.createElement,
      update: apiMocks.updateElement,
    },
  },
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('../pages/ViewEditor/context', () => ({
  useViewEditorContext: () => ({
    viewId: 1,
    canEdit: true,
    isOwner: true,
    isFreePlan: false,
    snapToGrid: true,
    setSnapToGrid: vi.fn(),
    selectedElement: null,
    selectedConnector: null,
  }),
}))

vi.mock('../utils/technologyCatalog', () => ({
  getTechnologyCatalogIndex: vi.fn(async () => ({ bySlug: new Map(), items: [] })),
  getTechnologyCatalogItemBySlug: vi.fn(async () => null),
  resolveWithBase: (_base: string, value: string) => value,
  searchTechnologyCatalog: vi.fn(async () => []),
}))

vi.mock('@chakra-ui/react', async () => {
  const ReactModule = await import('react')
  const BoxLike = ({ children, ...props }: { children?: React.ReactNode }) => ReactModule.createElement('div', props, children)
  const ButtonLike = ({ children, onClick, ...props }: { children?: React.ReactNode; onClick?: () => void }) => ReactModule.createElement('button', { ...props, onClick }, children)

  return {
    Badge: BoxLike,
    Box: BoxLike,
    Button: ButtonLike,
    CloseButton: ButtonLike,
    FormControl: BoxLike,
    FormLabel: BoxLike,
    HStack: BoxLike,
    Input: (props: Record<string, unknown>) => ReactModule.createElement('input', props),
    InputGroup: BoxLike,
    InputRightElement: BoxLike,
    Popover: BoxLike,
    PopoverArrow: BoxLike,
    PopoverBody: BoxLike,
    PopoverContent: BoxLike,
    PopoverTrigger: BoxLike,
    Slider: ({ children, isDisabled, onChangeEnd, ...props }: { children?: React.ReactNode; isDisabled?: boolean; onChangeEnd?: (value: number) => void }) => ReactModule.createElement('input', {
      ...props,
      disabled: isDisabled,
      isDisabled,
      type: 'range',
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeEnd?.(Number(event.target.value)),
    }, children),
    SliderFilledTrack: BoxLike,
    SliderThumb: BoxLike,
    SliderTrack: BoxLike,
    Switch: ({ isChecked, isDisabled, onChange, ...props }: { isChecked?: boolean; isDisabled?: boolean; onChange?: React.ChangeEventHandler<HTMLInputElement> }) => ReactModule.createElement('input', {
      ...props,
      checked: isChecked,
      disabled: isDisabled,
      type: 'checkbox',
      onChange,
    }),
    Tag: BoxLike,
    TagCloseButton: ButtonLike,
    TagLabel: BoxLike,
    Text: BoxLike,
    Textarea: (props: Record<string, unknown>) => ReactModule.createElement('textarea', props),
    VStack: BoxLike,
    Wrap: BoxLike,
    WrapItem: BoxLike,
    useBreakpointValue: () => false,
    useDisclosure: () => ({ isOpen: false, onClose: vi.fn(), onOpen: vi.fn() }),
  }
})

vi.mock('./SlidingPanel', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}))
vi.mock('./ConfirmDialog', () => ({ default: () => null }))
vi.mock('./PanelHeader', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }))
vi.mock('./GitSourceLinker', () => ({ default: () => null }))
vi.mock('./ScrollIndicatorWrapper', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('./TagUpsert', () => ({ default: () => null }))

function element(overrides: Partial<LibraryElement> = {}): LibraryElement {
  return {
    id: 10,
    name: 'API',
    kind: 'service',
    description: null,
    technology: null,
    url: null,
    logo_url: null,
    technology_connectors: [],
    tags: [],
    repo: null,
    branch: null,
    file_path: null,
    language: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    has_view: false,
    view_label: null,
    bypass_noise_gate: false,
    ...overrides,
  }
}

describe('ElementPanel bypass noise gate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMocks.createElement.mockReset()
    apiMocks.updateElement.mockReset()
    apiMocks.updateElement.mockImplementation(async (id: number, payload: Partial<LibraryElement>) => ({
      ...element(),
      ...payload,
      id,
    }))
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener: vi.fn(),
        clearTimeout,
        removeEventListener: vi.fn(),
        setTimeout,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('autosaves the bypass flag and disables the noise gate slider while bypassed', async () => {
    const onSave = vi.fn()
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <ElementPanel
          isOpen
          autoSave
          element={element()}
          onClose={vi.fn()}
          onSave={onSave}
          onVisibilityOverrideDeltaChange={vi.fn()}
        />,
      )
      await Promise.resolve()
    })

    const bypassToggle = renderer!.root.findByProps({ 'data-testid': 'element-panel-bypass-noise-gate' })
    await act(async () => {
      bypassToggle.props.onChange({ target: { checked: true } })
    })
    await act(async () => {
      vi.runAllTimers()
      await Promise.resolve()
    })

    expect(apiMocks.updateElement).toHaveBeenCalledWith(10, expect.objectContaining({ bypass_noise_gate: true }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ bypass_noise_gate: true }))
    expect(renderer!.root.findByProps({ 'aria-label': 'Element noise gate' }).props.isDisabled).toBe(true)
  })
})
