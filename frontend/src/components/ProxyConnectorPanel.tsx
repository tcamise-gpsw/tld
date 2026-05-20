import { Box, Button, HStack, Text, VStack, Divider, Flex, IconButton } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import type { ProxyConnectorDetails, ProxyConnectorLeaf, ProxyEndpoint, WorkspaceGraphSnapshot } from '../crossBranch/types'
import SlidingPanel from './SlidingPanel'
import PanelHeader from './PanelHeader'
import { NavigationIcon, TrashIcon, EditIcon } from './Icons'
import { useViewEditorContext } from '../pages/ViewEditor/context'
import type { Connector } from '../types'
import { truncate } from '../utils/string'

interface Props {
  isOpen: boolean
  onClose: () => void
  details: ProxyConnectorDetails | null
  snapshot: WorkspaceGraphSnapshot | null
  hasBackdrop?: boolean
  onEdit?: (connector: Connector) => void
  onDelete?: (connectorId: number, ownerViewId: number) => void
}

type ConnectorNavTarget = {
  viewId: number
  viewName: string
}

function connectorDirectionArrow(direction: string) {
  switch (direction) {
    case 'backward':
      return '<-'
    case 'both':
      return '<->'
    case 'none':
      return '--'
    case 'forward':
    default:
      return '->'
  }
}

function summarizedDirection(details: ProxyConnectorDetails) {
  const directions = new Set(details.connectors.map((leaf) => leaf.connector.direction))
  if (directions.has('both')) return 'both'
  if (directions.has('forward') && directions.has('backward')) return 'both'
  if (directions.has('forward')) return 'forward'
  if (directions.has('backward')) return 'backward'
  return 'none'
}

function buildNavigationTarget(viewId: number, fallbackName: string | null | undefined, snapshot: WorkspaceGraphSnapshot): ConnectorNavTarget {
  return {
    viewId,
    viewName: snapshot.viewById[viewId]?.name ?? fallbackName ?? `View ${viewId}`,
  }
}

function resolveOffViewEndpointTarget(
  endpoint: ProxyEndpoint,
  snapshot: WorkspaceGraphSnapshot,
  currentViewId: number | null,
): ConnectorNavTarget | null {
  if (!endpoint.externalToView || currentViewId == null) return null

  for (const ownerElementId of endpoint.contextPathElementIds ?? []) {
    const childViewId = snapshot.childViewIdByOwnerElementId[ownerElementId]
    if (childViewId != null && childViewId !== currentViewId) {
      return buildNavigationTarget(childViewId, snapshot.viewById[childViewId]?.name ?? null, snapshot)
    }
  }

  const anchorChildViewId = snapshot.childViewIdByOwnerElementId[endpoint.anchorElementId]
  if (anchorChildViewId != null && anchorChildViewId !== currentViewId) {
    return buildNavigationTarget(anchorChildViewId, snapshot.viewById[anchorChildViewId]?.name ?? null, snapshot)
  }

  if (endpoint.anchorViewId != null && endpoint.anchorViewId !== currentViewId) {
    return buildNavigationTarget(endpoint.anchorViewId, endpoint.anchorViewName, snapshot)
  }

  if (endpoint.placementViewId != null && endpoint.placementViewId !== currentViewId) {
    return buildNavigationTarget(endpoint.placementViewId, endpoint.placementViewName, snapshot)
  }

  return null
}

function resolveLeafNavigationTarget(
  leaf: ProxyConnectorLeaf,
  snapshot: WorkspaceGraphSnapshot | null,
  currentViewId: number | null,
): ConnectorNavTarget | null {
  if (!snapshot) return null
  return resolveOffViewEndpointTarget(leaf.source, snapshot, currentViewId)
    ?? resolveOffViewEndpointTarget(leaf.target, snapshot, currentViewId)
}

export default function ProxyConnectorPanel({
  isOpen,
  onClose,
  details,
  snapshot,
  hasBackdrop = true,
  onEdit,
  onDelete,
}: Props) {
  const navigate = useNavigate()
  const { canEdit, viewId } = useViewEditorContext()

  return (
    <SlidingPanel
      isOpen={isOpen}
      onClose={onClose}
      panelKey="proxy-connector-panel"
      width={{ base: 'calc(100vw - 24px)', md: '300px' }}
      hasBackdrop={hasBackdrop}
      zIndex={950}
    >
      <PanelHeader title="Connectors" onClose={onClose} />

      <Box flex={1} overflowY="auto" px={4} py={4}>
        {details ? (
          <VStack align="stretch" spacing={6}>
            {/* Header info */}
            <Box>
              <HStack spacing={2} mb={1}>
                <Text color="white" fontSize="s" letterSpacing="-0.01em">
                  {details.sourceAnchorName}
                </Text>
                <Text color="whiteAlpha.500" fontSize="sm" fontFamily="mono">
                  {connectorDirectionArrow(summarizedDirection(details))}
                </Text>
                <Text color="white" fontSize="s" letterSpacing="-0.01em">
                  {details.targetAnchorName}
                </Text>
              </HStack>
              <Text color="blue.300" fontSize="xs" fontWeight="600">
                {details.label}
              </Text>
            </Box>

            <Divider borderColor="whiteAlpha.100" />

            <VStack align="stretch" spacing={4}>
              <Text color="gray.500" fontSize="10px" fontWeight="800" letterSpacing="0.1em" textTransform="uppercase">
                Underlying Connectors
              </Text>

              <VStack align="stretch" spacing={3}>
                {details.connectors.map((leaf, idx) => {
                  const navigationTarget = resolveLeafNavigationTarget(leaf, snapshot, viewId)
                  return (
                    <Box
                      key={`${leaf.connector.id}-${idx}`}
                      px={3}
                      py={3}
                      rounded="xl"
                      bg="whiteAlpha.50"
                      border="1px solid"
                      borderColor="whiteAlpha.100"
                      _hover={{ bg: 'whiteAlpha.100', borderColor: 'whiteAlpha.200' }}
                      transition="all 0.2s"
                    >
                      <VStack align="stretch" spacing={3}>
                        <Box>
                          <HStack justify="space-between" align="start">
                            <VStack align="start" spacing={1} flex={1}>
                              <HStack spacing={2}>
                                <Text color="white" fontSize="sm" fontWeight="semibold" isTruncated>
                                  {truncate(leaf.source.actualElementName)}
                                </Text>
                                <Text color="whiteAlpha.500" fontSize="sm" fontFamily="mono">
                                  {connectorDirectionArrow(leaf.connector.direction)}
                                </Text>
                                <Text color="white" fontSize="sm" fontWeight="semibold" isTruncated>
                                  {truncate(leaf.target.actualElementName)}
                                </Text>
                              </HStack>

                              {(leaf.connector.label || leaf.connector.relationship) && (
                                <Text color="gray.400" fontSize="xs" fontStyle={!leaf.connector.label ? 'italic' : 'normal'}>
                                  {leaf.connector.label || leaf.connector.relationship}
                                </Text>
                              )}
                            </VStack>

                            {canEdit && (
                              <HStack spacing={1} mt={-1}>
                                <IconButton
                                  aria-label="Edit connector"
                                  icon={<EditIcon size={14} />}
                                  size="xs"
                                  variant="ghost"
                                  color="blue.300"
                                  _hover={{ bg: 'blue.900', color: 'blue.100' }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onEdit?.(leaf.connector)
                                  }}
                                />
                                <IconButton
                                  aria-label="Delete connector"
                                  icon={<TrashIcon size={14} />}
                                  size="xs"
                                  variant="ghost"
                                  color="red.400"
                                  _hover={{ bg: 'red.900', color: 'red.100' }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onDelete?.(leaf.connector.id, leaf.ownerViewId)
                                  }}
                                />
                              </HStack>
                            )}
                          </HStack>
                        </Box>

                        {leaf.connector.description && (
                          <Text color="gray.500" fontSize="xs" lineHeight="tall" pb={1}>
                            {leaf.connector.description}
                          </Text>
                        )}

                        {navigationTarget && (
                          <Button
                            size="xs"
                            variant="clay"
                            colorScheme="blue"
                            color="blue.100"
                            leftIcon={<NavigationIcon size={12} />}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              navigate(`/views/${navigationTarget.viewId}`)
                              onClose()
                            }}
                            w="full"
                            justifyContent="flex-start"
                            h="28px"
                            fontSize="11px"
                          >
                            Open {navigationTarget.viewName}
                          </Button>
                        )}
                      </VStack>
                    </Box>
                  )
                })}
              </VStack>
            </VStack>
          </VStack>
        ) : (
          <Flex h="full" align="center" justify="center" direction="column" gap={3}>
            <Text color="gray.500" fontSize="sm">Select a connector to inspect it.</Text>
          </Flex>
        )}
      </Box>
    </SlidingPanel>
  )
}

