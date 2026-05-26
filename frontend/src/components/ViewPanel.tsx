import { memo, useEffect, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
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
import type { ViewTreeNode, LibraryElement } from '../types'
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
  isInline?: boolean
}

/**
 * Name: View Details Panel
 * Role: Opens on the right and allows view field updates.
 * Location: Right side of the screen on desktop. Overlays screen on mobile.
 * Aliases: View Properties, View Settings.
 */
function ViewPanel({ isOpen, onClose, view, canEdit: canEditProp, onSave, onUnsupportedMutation, hasBackdrop = true, availableTags = [], isInline = false }: Props) {
  const ctx = useContext(ViewEditorContext)
  const canEdit = canEditProp ?? ctx?.canEdit ?? true
  const isReadOnly = !canEdit
  const isMobile = useBreakpointValue({ base: true, md: false }) ?? false
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [levelLabel, setLevelLabel] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  // Populate similarity states
  const [populateQuery, setPopulateQuery] = useState('')
  const [populateLimit, setPopulateLimit] = useState(5)
  const [populateResults, setPopulateResults] = useState<Array<LibraryElement & { similarity_score: number; match_kind?: string; match_reason?: string }>>([])
  const [selectedPopulateIds, setSelectedPopulateIds] = useState<number[]>([])
  const [loadingPopulate, setLoadingPopulate] = useState(false)
  const [searchedPopulate, setSearchedPopulate] = useState(false)

  useEffect(() => {
    if (view) {
      setName(view.name)
      setDescription(view.description || '')
      setLevelLabel(view.level_label || '')
      setTags(view.tags || [])

      // Reset populate states when view opens or changes
      setPopulateResults([])
      setSelectedPopulateIds([])
      setSearchedPopulate(false)

      if (isOpen) {
        api.workspace.views.populate.getQuery(view.id)
          .then((q) => {
            setPopulateQuery(q.enriched_query || q.query)
          })
          .catch(() => {
            setPopulateQuery(view.name)
          })
      }
    }
  }, [view, isOpen])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const handleRunPopulate = async () => {
    if (!view || !populateQuery.trim()) return
    setLoadingPopulate(true)
    setSearchedPopulate(true)
    try {
      const results = await api.workspace.views.populate.search(view.id, populateQuery, populateLimit)
      setPopulateResults(results)
      setSelectedPopulateIds(results.map((r) => r.id))
    } catch {
      setPopulateResults([])
      setSelectedPopulateIds([])
    } finally {
      setLoadingPopulate(false)
    }
  }

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
      // Add populated placements:
      if (selectedPopulateIds.length > 0) {
        for (let i = 0; i < selectedPopulateIds.length; i++) {
          const id = selectedPopulateIds[i]
          const posX = 100 + (i % 5) * 150
          const posY = 100 + Math.floor(i / 5) * 120
          try {
            await api.workspace.views.placements.add(view.id, id, posX, posY)
          } catch {
            // ignore individual placement errors (e.g. if already exists in view)
          }
        }
      }

      onSave({ ...view, name: updated.name, description, level_label: updated.label, tags: updated.tags })
      onClose()
    } catch {
      // intentionally empty
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlidingPanel data-testid="view-panel" isOpen={isOpen} onClose={onClose} panelKey="view" side={isMobile ? 'left' : 'right'} width="320px" hasBackdrop={hasBackdrop} isInline={isInline}>
      <PanelHeader title="View Details" onClose={onClose} hasCloseButton={!isInline} isInline={isInline} />

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

          {canEdit && (
            <>
              <Divider borderColor="whiteAlpha.100" my={2} />
              <VStack align="stretch" spacing={3}>
                <Text fontWeight="bold" fontSize="sm" color="gray.200">
                  Populate Elements
                </Text>
                <Text fontSize="xs" color="gray.400">
                  Find high-level scanned resources from your codebase and place them inside the view.
                  Requires "tld analyze" with a configured embedding model provider.
                </Text>

                <FormControl>
                  <FormLabel fontSize="xs" color="gray.400">Search Query</FormLabel>
                  <Input
                    size="sm"
                    value={populateQuery}
                    onChange={(e) => setPopulateQuery(e.target.value)}
                    placeholder="Describe the architecture component..."
                  />
                </FormControl>

                <HStack spacing={4} align="flex-end">
                  <FormControl>
                    <FormLabel fontSize="xs" color="gray.400">Limit (N)</FormLabel>
                    <Input
                      type="number"
                      size="sm"
                      value={populateLimit}
                      onChange={(e) => setPopulateLimit(Math.max(1, parseInt(e.target.value) || 5))}
                      min={1}
                      max={50}
                    />
                  </FormControl>
                  <Button
                    size="sm"
                    colorScheme="blue"
                    onClick={handleRunPopulate}
                    isLoading={loadingPopulate}
                    px={5}
                  >
                    Find
                  </Button>
                </HStack>

                {searchedPopulate && !loadingPopulate && populateResults.length > 0 && (
                  <VStack
                    align="stretch"
                    spacing={2.5}
                    mt={1}
                    maxH="220px"
                    overflowY="auto"
                    p={3}
                    bg="whiteAlpha.50"
                    borderRadius="md"
                    border="1px solid"
                    borderColor="whiteAlpha.100"
                  >
                    {populateResults.map((result) => (
                      <HStack key={result.id} justify="space-between" align="center">
                        <Checkbox
                          size="sm"
                          isChecked={selectedPopulateIds.includes(result.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPopulateIds([...selectedPopulateIds, result.id])
                            } else {
                              setSelectedPopulateIds(selectedPopulateIds.filter((id) => id !== result.id))
                            }
                          }}
                        >
                          <VStack align="start" spacing={0} maxW="160px">
                            <Text fontSize="xs" fontWeight="medium" color="white" isTruncated maxW="160px">
                              {result.name}
                            </Text>
                            <Text fontSize="10px" color="gray.500" isTruncated maxW="160px">
                              {[result.kind, result.file_path].filter(Boolean).join(' · ')}
                            </Text>
                          </VStack>
                        </Checkbox>
                        <HStack spacing={1.5}>
                          {result.technology && (
                            <Text fontSize="9px" color="gray.400" bg="whiteAlpha.100" px={1.5} py={0.5} borderRadius="sm">
                              {result.technology}
                            </Text>
                          )}
                          <Text fontSize="10px" fontWeight="bold" color="blue.300">
                            {Math.round(result.similarity_score * 100)}
                          </Text>
                        </HStack>
                      </HStack>
                    ))}
                  </VStack>
                )}

                {searchedPopulate && !loadingPopulate && populateResults.length === 0 && (
                  <Text fontSize="xs" color="gray.500" py={2} textAlign="center">
                    No similar elements found.
                  </Text>
                )}
              </VStack>
            </>
          )}

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
          {!isInline && (
            <Button data-testid="view-panel-cancel" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
          )}
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
