import { memo, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Divider,
  FormControl,
  FormLabel,
  HStack,
  Input,
  Tag,
  TagCloseButton,
  TagLabel,
  Text,
  Textarea,
  useBreakpointValue,
  VStack,
  Wrap,
  WrapItem,
} from '@chakra-ui/react'
import { api } from '../api/client'
import type { ViewTreeNode } from '../types'
import SlidingPanel from './SlidingPanel'
import PanelHeader from './PanelHeader'
import LayoutSection from './LayoutSection'
import ScrollIndicatorWrapper from './ScrollIndicatorWrapper'
import TagUpsert from './TagUpsert'

import { useContext } from 'react'
import { ViewEditorContext } from '../pages/ViewEditor/context'

interface Props {
  isOpen: boolean
  onClose: () => void
  view: ViewTreeNode | null
  canEdit?: boolean
  onSave: (updated: ViewTreeNode) => void
  onUnsupportedMutation?: () => void
  hasBackdrop?: boolean
  availableTags?: string[]
}

/**
 * Name: View Details Panel
 * Role: Opens on the right and allows view field updates.
 * Location: Right side of the screen on desktop. Overlays screen on mobile.
 * Aliases: View Properties, View Settings.
 */
function ViewPanel({ isOpen, onClose, view, canEdit: canEditProp, onSave, onUnsupportedMutation, hasBackdrop = true, availableTags = [] }: Props) {
  const ctx = useContext(ViewEditorContext)
  const canEdit = canEditProp ?? ctx?.canEdit ?? true
  const isReadOnly = !canEdit
  const isMobile = useBreakpointValue({ base: true, md: false }) ?? false
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [levelLabel, setLevelLabel] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (view) {
      setName(view.name)
      setDescription(view.description || '')
      setLevelLabel(view.level_label || '')
      setTags(view.tags || [])
    }
  }, [view])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const handleSave = async () => {
    if (isReadOnly || !view) return
    setSaving(true)
    try {
      const updated = await api.workspace.views.update(view.id, {
        name: name.trim(),
        description,
        label: levelLabel,
        tags,
      })
      onSave({ ...view, name: updated.name, description, level_label: updated.label, tags: updated.tags })
      onClose()
    } catch {
      // intentionally empty
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlidingPanel data-testid="view-panel" isOpen={isOpen} onClose={onClose} panelKey="view" side={isMobile ? 'left' : 'right'} width="320px" hasBackdrop={hasBackdrop}>
      <PanelHeader title="View Details" onClose={onClose} />

      {/* Body */}
      <ScrollIndicatorWrapper px={4} py={4}>
        <VStack spacing={4} align="stretch">
          <FormControl isRequired>
            <FormLabel>Name</FormLabel>
            <Input
              data-testid="view-panel-name-input"
              size="sm"
              value={name}
              isDisabled={isReadOnly}
              onChange={(e) => setName(e.target.value)}
            />
          </FormControl>
          <FormControl>
            <FormLabel>Level Label</FormLabel>
            <Input
              data-testid="view-panel-label-input"
              size="sm"
              value={levelLabel}
              isDisabled={isReadOnly}
              onChange={(e) => setLevelLabel(e.target.value)}
              placeholder="e.g. System Context, Containers…"
            />
          </FormControl>
          <FormControl>
            <FormLabel>Description</FormLabel>
            <Textarea
              data-testid="view-panel-description-input"
              size="sm"
              value={description}
              isDisabled={isReadOnly}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              rows={4}
            />
          </FormControl>
          <FormControl isDisabled={isReadOnly}>
            <FormLabel>Tags</FormLabel>
            <TagUpsert
              currentTags={tags}
              availableTags={availableTags}
              onAddTag={(tag) => {
                if (!tags.includes(tag)) setTags((prev) => [...prev, tag])
              }}
              isReadOnly={isReadOnly}
            />
            <Wrap mt={3}>
              {tags.map((tag) => (
                <WrapItem key={tag}>
                  <Tag size="sm" variant="subtle" bg="whiteAlpha.100" border="1px solid" borderColor="whiteAlpha.200">
                    <TagLabel color="white">{tag}</TagLabel>
                    {!isReadOnly && (
                      <TagCloseButton onClick={() => setTags((prev) => prev.filter((item) => item !== tag))} />
                    )}
                  </Tag>
                </WrapItem>
              ))}
            </Wrap>
          </FormControl>
          <LayoutSection view={view} canEdit={canEdit} onUnsupportedMutation={onUnsupportedMutation} />

          {view && (
            <Box pt={2} borderTop="1px solid" borderColor="whiteAlpha.50">
              <Text fontSize="xs" color="gray.600">
                Created {new Date(view.created_at).toLocaleString()}
              </Text>
              <Text fontSize="xs" color="gray.600">
                Updated {new Date(view.updated_at).toLocaleString()}
              </Text>
            </Box>
          )}
        </VStack>
      </ScrollIndicatorWrapper>

      <Divider borderColor="whiteAlpha.100" />

      {/* Footer */}
      <HStack px={4} py={3} justify="flex-end" flexShrink={0}>
        <HStack>
          <Button data-testid="view-panel-cancel" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {canEdit && (
            <Button
              data-testid="view-panel-save"
              size="sm"
              px={5}
              colorScheme="blue"
              onClick={handleSave}
              isLoading={saving}
              isDisabled={isReadOnly || !name.trim()}
            >
              Save
            </Button>
          )}
        </HStack>
      </HStack>
    </SlidingPanel>
  )
}

export default memo(ViewPanel)
