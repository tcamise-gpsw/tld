import { memo, useEffect, useMemo, useRef } from 'react'
import {
  Badge,
  Box,
  Button,
  Divider,
  HStack,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  headingsPlugin,
  linkDialogPlugin,
  listsPlugin,
  ListsToggle,
  markdownShortcutPlugin,
  MDXEditor,
  type MDXEditorMethods,
  quotePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import type { ViewMarkdownDocument } from '../types'
import PanelHeader from './PanelHeader'
import ScrollIndicatorWrapper from './ScrollIndicatorWrapper'
import SlidingPanel from './SlidingPanel'

interface Props {
  isOpen: boolean
  onClose: () => void
  viewName?: string | null
  markdown: ViewMarkdownDocument | null
  content: string
  syncToken: number
  canEdit?: boolean
  isLoading?: boolean
  isSaving?: boolean
  isDirty?: boolean
  onChange: (markdown: string) => void
  onSave: (markdown: string) => Promise<void> | void
  onReload?: () => Promise<void> | void
}

function ViewMarkdownPanel({
  isOpen,
  onClose,
  viewName,
  markdown,
  content,
  syncToken,
  canEdit = true,
  isLoading = false,
  isSaving = false,
  isDirty = false,
  onChange,
  onSave,
  onReload,
}: Props) {
  const editorRef = useRef<MDXEditorMethods>(null)
  const lastSyncTokenRef = useRef(syncToken)

  useEffect(() => {
    if (!isOpen) return
    if (lastSyncTokenRef.current === syncToken) return
    lastSyncTokenRef.current = syncToken
    editorRef.current?.setMarkdown(content)
  }, [content, isOpen, syncToken])

  const plugins = useMemo(() => {
    const base = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      linkDialogPlugin(),
    ]

    if (!canEdit) return base

    return [
      ...base,
      toolbarPlugin({
        toolbarClassName: 'tld-markdown-toolbar',
        toolbarContents: () => (
          <>
            <UndoRedo />
            <BoldItalicUnderlineToggles />
            <BlockTypeSelect />
            <ListsToggle />
            <CreateLink />
          </>
        ),
      }),
    ]
  }, [canEdit])

  return (
    <SlidingPanel
      data-testid="view-markdown-panel"
      isOpen={isOpen}
      onClose={onClose}
      panelKey="view-markdown"
      side="right"
      width={{ base: 'calc(100vw - 24px)', lg: '540px' }}
      height="calc(100vh - 8rem)"
      maxHeight="calc(100vh - 8rem)"
      hasBackdrop={false}
      zIndex={950}
    >
      <PanelHeader title="Markdown Notes" onClose={onClose} />
      <ScrollIndicatorWrapper px={4} py={4}>
        <VStack align="stretch" spacing={4} minH="full">
          <VStack align="stretch" spacing={1.5}>
            <HStack justify="space-between" align="start" spacing={3}>
              <Box minW={0}>
                <Text fontSize="sm" fontWeight="semibold" color="whiteAlpha.900" isTruncated>
                  {viewName?.trim() ? `${viewName} notes` : 'View notes'}
                </Text>
                <Text fontSize="xs" color="whiteAlpha.600">
                  {markdown?.is_managed ? 'Managed file stored with the local data directory.' : 'Linked markdown file.'}
                </Text>
              </Box>
              {markdown && (
                <Badge
                  colorScheme={markdown.is_managed ? 'green' : 'blue'}
                  variant="subtle"
                  textTransform="none"
                  borderRadius="full"
                  px={2}
                  py={0.5}
                >
                  {markdown.is_managed ? 'Managed' : 'Linked'}
                </Badge>
              )}
            </HStack>
            {markdown && (
              <Text fontSize="xs" color="whiteAlpha.700" wordBreak="break-all">
                {markdown.path}
              </Text>
            )}
            {markdown?.updated_at && (
              <Text fontSize="10px" color="whiteAlpha.500">
                Updated {new Date(markdown.updated_at).toLocaleString()}
              </Text>
            )}
          </VStack>

          <Divider borderColor="whiteAlpha.100" />

          <Box
            flex="1 1 auto"
            minH="420px"
            border="1px solid"
            borderColor="whiteAlpha.200"
            borderRadius="lg"
            overflow="hidden"
            bg="white"
            color="gray.900"
            sx={{
              '.tld-markdown-toolbar': {
                borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
                background: 'rgba(248, 250, 252, 0.95)',
              },
              '.tld-markdown-editor__content': {
                minHeight: '360px',
                padding: '1rem 1.25rem 1.5rem',
                fontSize: '0.95rem',
                lineHeight: 1.65,
              },
            }}
          >
            {isLoading ? (
              <VStack justify="center" align="center" spacing={3} h="full" color="gray.500">
                <Spinner size="md" />
                <Text fontSize="sm">Loading markdown…</Text>
              </VStack>
            ) : markdown ? (
              <MDXEditor
                ref={editorRef}
                markdown={content}
                readOnly={!canEdit}
                spellCheck
                className="tld-markdown-editor"
                contentEditableClassName="tld-markdown-editor__content"
                placeholder="Start writing notes for this view…"
                plugins={plugins}
                onChange={(nextMarkdown) => onChange(nextMarkdown)}
              />
            ) : (
              <VStack justify="center" align="center" spacing={3} h="full" color="gray.500" px={6} textAlign="center">
                <Text fontSize="sm" fontWeight="semibold">No markdown document linked</Text>
                <Text fontSize="xs">
                  Create a managed file from the toolbar, or link an existing markdown file from the view details panel.
                </Text>
              </VStack>
            )}
          </Box>
        </VStack>
      </ScrollIndicatorWrapper>

      <Divider borderColor="whiteAlpha.100" />

      <HStack px={4} py={3} justify="space-between" flexShrink={0}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { void onReload?.() }}
          isDisabled={isLoading || !markdown}
        >
          Reload
        </Button>
        <Button
          size="sm"
          colorScheme="blue"
          onClick={() => { void onSave(content) }}
          isLoading={isSaving}
          isDisabled={!canEdit || isLoading || !markdown || !isDirty}
        >
          Save Notes
        </Button>
      </HStack>
    </SlidingPanel>
  )
}

export default memo(ViewMarkdownPanel)