import { memo, useEffect, useMemo, useRef } from 'react'
import {
  Box,
  HStack,
  IconButton,
  Spinner,
  Text,
  Tooltip,
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
import { CloseIcon, ReloadIcon, SaveIcon } from './Icons'
import type { ViewMarkdownDocument } from '../types'

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
  const latestContentRef = useRef(content)
  const lastSyncTokenRef = useRef(syncToken)
  latestContentRef.current = content

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
      toolbarPlugin({
        toolbarClassName: 'tld-markdown-toolbar',
        toolbarContents: () => (
          <>
            {canEdit && (
              <>
                <UndoRedo />
                <BoldItalicUnderlineToggles />
                <BlockTypeSelect />
                <ListsToggle />
                <CreateLink />
              </>
            )}
            <Box className="tld-markdown-toolbar-spacer" />
            <HStack className="tld-markdown-toolbar-actions" spacing={1.5}>
              <Tooltip label="Reload" hasArrow openDelay={200}>
                <Box as="span">
                  <IconButton
                    aria-label="Reload"
                    size="xs"
                    variant="ghost"
                    className="tld-markdown-toolbar-action"
                    icon={<ReloadIcon />}
                    onClick={() => { void onReload?.() }}
                    isDisabled={isLoading || !markdown}
                  />
                </Box>
              </Tooltip>
              <Tooltip label="Save" hasArrow openDelay={200}>
                <Box as="span">
                  <IconButton
                    aria-label="Save"
                    size="xs"
                    className="tld-markdown-toolbar-action tld-markdown-toolbar-action-save"
                    icon={<SaveIcon />}
                    onClick={() => { void onSave(editorRef.current?.getMarkdown() ?? latestContentRef.current) }}
                    isLoading={isSaving}
                    isDisabled={!canEdit || isLoading || !markdown || !isDirty}
                  />
                </Box>
              </Tooltip>
              <Tooltip label="Close" hasArrow openDelay={200}>
                <Box as="span">
                  <IconButton
                    aria-label="Close"
                    size="xs"
                    variant="ghost"
                    className="tld-markdown-toolbar-action"
                    icon={<CloseIcon />}
                    onClick={onClose}
                  />
                </Box>
              </Tooltip>
            </HStack>
          </>
        ),
      }),
    ]

    return base
  }, [canEdit, isDirty, isLoading, isSaving, markdown, onClose, onReload, onSave])

  if (!isOpen) return null

  return (
    <Box
      data-testid="view-markdown-panel"
      h="full"
      minH={0}
      minW={0}
      display="flex"
      flexDir="column"
      bg="var(--bg-panel)"
      bgImage="var(--grad-panel)"
    >
      <Box
        flex="1 1 auto"
        minH={0}
        overflow="hidden"
        bg="#0b1220"
        color="gray.100"
        sx={{
          '.tld-markdown-editor': {
            '--basePageBg': '#0b1220',
            '--baseBase': '#0f172a',
            '--baseBgSubtle': '#111c31',
            '--baseBg': '#152238',
            '--baseBgHover': '#1a2b46',
            '--baseBgActive': '#203456',
            '--baseLine': 'rgba(148, 163, 184, 0.18)',
            '--baseBorder': 'rgba(148, 163, 184, 0.22)',
            '--baseBorderHover': 'rgba(148, 163, 184, 0.28)',
            '--baseSolid': '#22385a',
            '--baseSolidHover': '#2a4772',
            '--baseText': '#dbe6f5',
            '--baseTextContrast': '#f8fbff',
            '--accentBase': '#10233d',
            '--accentBgSubtle': '#123053',
            '--accentBg': '#153c68',
            '--accentBgHover': '#1a4a82',
            '--accentBgActive': '#205798',
            '--accentLine': 'rgba(96, 165, 250, 0.4)',
            '--accentBorder': 'rgba(96, 165, 250, 0.45)',
            '--accentBorderHover': 'rgba(96, 165, 250, 0.6)',
            '--accentSolid': '#3b82f6',
            '--accentSolidHover': '#60a5fa',
            '--accentText': '#93c5fd',
            '--accentTextContrast': '#eff6ff',
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            minHeight: 0,
            background: '#0b1220',
            color: '#dbe6f5',
          },
          '.tld-markdown-toolbar': {
            borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
            background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.98) 0%, rgba(11, 18, 32, 0.96) 100%)',
            color: '#dbe6f5',
            paddingInline: '0.5rem',
            minHeight: '48px',
            flexShrink: 0,
          },
          '.tld-markdown-toolbar-spacer': {
            flex: '1 1 auto',
            minWidth: '0.5rem',
          },
          '.tld-markdown-toolbar-actions': {
            marginLeft: 'auto',
            paddingLeft: '0.5rem',
            borderLeft: '1px solid rgba(148, 163, 184, 0.12)',
            flexShrink: 0,
          },
          '.tld-markdown-toolbar-action': {
            height: '30px',
            minWidth: '30px',
            width: '30px',
            paddingInline: '0',
            borderRadius: '0.55rem',
            fontWeight: 600,
            background: 'transparent',
            color: '#dbe6f5',
          },
          '.tld-markdown-toolbar-action svg': {
            width: '15px',
            height: '15px',
          },
          '.tld-markdown-toolbar-action:hover': {
            background: 'rgba(96, 165, 250, 0.12)',
          },
          '.tld-markdown-toolbar-action-save': {
            background: 'rgba(59, 130, 246, 0.22)',
            color: '#eff6ff',
          },
          '.tld-markdown-toolbar-action-save:hover': {
            background: 'rgba(96, 165, 250, 0.3)',
          },
          '.tld-markdown-toolbar-action[data-disabled], .tld-markdown-toolbar-action:disabled': {
            opacity: 0.4,
            background: 'transparent',
          },
          '.tld-markdown-toolbar button': {
            color: '#dbe6f5',
          },
          '.tld-markdown-toolbar button:hover': {
            background: 'rgba(96, 165, 250, 0.14)',
          },
          '.tld-markdown-toolbar [data-state="on"]': {
            background: 'rgba(59, 130, 246, 0.24)',
            color: '#eff6ff',
          },
          '.tld-markdown-toolbar [disabled]': {
            opacity: 0.35,
          },
          '.tld-markdown-editor .mdxeditor-root-contenteditable': {
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 auto',
            minHeight: 0,
            background: '#0b1220',
          },
          '.tld-markdown-editor .mdxeditor-root-contenteditable > div': {
            display: 'flex',
            flexDirection: 'column',
            flex: '1 1 auto',
            minHeight: 0,
          },
          '.tld-markdown-editor__content[contenteditable="true"]': {
            flex: '1 1 auto',
            minHeight: 0,
            width: '100%',
            padding: '1.25rem 1.5rem 2rem',
            fontSize: '0.95rem',
            lineHeight: 1.75,
            color: '#dbe6f5',
            background: '#0b1220',
            outline: 'none',
            boxShadow: 'none',
          },
          '.tld-markdown-editor__content[contenteditable="true"] p': {
            color: '#dbe6f5',
          },
          '.tld-markdown-editor__content[contenteditable="true"] h1, .tld-markdown-editor__content[contenteditable="true"] h2, .tld-markdown-editor__content[contenteditable="true"] h3, .tld-markdown-editor__content[contenteditable="true"] h4, .tld-markdown-editor__content[contenteditable="true"] h5, .tld-markdown-editor__content[contenteditable="true"] h6': {
            color: '#f8fbff',
          },
          '.tld-markdown-editor__content[contenteditable="true"] a': {
            color: '#93c5fd',
          },
          '.tld-markdown-editor__content[contenteditable="true"] blockquote': {
            borderLeftColor: 'rgba(96, 165, 250, 0.45)',
            color: '#cbd5e1',
          },
          '.tld-markdown-editor__content[contenteditable="true"] code': {
            background: 'rgba(30, 41, 59, 0.9)',
            color: '#bfdbfe',
          },
          '.tld-markdown-editor__content[contenteditable="true"] pre': {
            background: '#020817',
            color: '#dbe6f5',
          },
          '.tld-markdown-editor__content:not([contenteditable])': {
            color: 'rgba(219, 230, 245, 0.42)',
            background: 'transparent',
            padding: '1.25rem 1.5rem 0',
          },
        }}
      >
        {isLoading ? (
          <VStack justify="center" align="center" spacing={3} h="full" color="whiteAlpha.700">
            <Spinner size="md" color="blue.300" />
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
          <VStack justify="center" align="center" spacing={3} h="full" color="whiteAlpha.700" px={6} textAlign="center">
            <Text fontSize="sm" fontWeight="semibold">No markdown document linked</Text>
            <Text fontSize="xs">
              Create a managed file from the toolbar, or link an existing markdown file from the view details panel.
            </Text>
          </VStack>
        )}
      </Box>
    </Box>
  )
}

export default memo(ViewMarkdownPanel)