import { Box, Flex, Text } from '@chakra-ui/react'
import type { Connector, LibraryElement } from '../../types'
import { ConnectionIndicator } from './ConnectionIndicator'
import { RelationshipCard } from './RelationshipCard'
import { TYPE_HEX } from './constants'

interface ConnectorRelationshipData {
  connector: Connector
  sourceEl: LibraryElement | undefined
  targetEl: LibraryElement | undefined
}

interface ConnectorRelationshipViewProps {
  data: ConnectorRelationshipData
  selectedName: string
  cardShadow: string
  onSelectRow: (key: string) => void
}

export function ConnectorRelationshipView({ data, selectedName, cardShadow, onSelectRow }: ConnectorRelationshipViewProps) {
  return (
    <Flex align="center" justify="center">
      {data.sourceEl ? (
        <RelationshipCard
          name={data.sourceEl.name}
          type={data.sourceEl.kind || 'element'}
          technology={data.sourceEl.technology || ''}
          accentHex={TYPE_HEX[data.sourceEl.kind || '']}
          compactLevel={1}
          onClick={() => onSelectRow(`element:${data.sourceEl!.id}`)}
        />
      ) : (
        <Text color="gray.600" fontSize="xs" fontStyle="italic">
          Unknown Source
        </Text>
      )}

      <ConnectionIndicator position="horizontal" compactLevel={1} />

      <Box position="relative" zIndex={10} isolation="isolate" mx={2} data-pan-block="true">
        <RelationshipCard
          isSelected
          name={selectedName}
          type={data.connector.relationship || 'Connector'}
          borderColor="orange.400"
          shadow={cardShadow}
          compactLevel={0}
        />
      </Box>

      <ConnectionIndicator position="horizontal" compactLevel={1} />

      {data.targetEl ? (
        <RelationshipCard
          name={data.targetEl.name}
          type={data.targetEl.kind || 'element'}
          technology={data.targetEl.technology || ''}
          accentHex={TYPE_HEX[data.targetEl.kind || '']}
          compactLevel={1}
          onClick={() => onSelectRow(`element:${data.targetEl!.id}`)}
        />
      ) : (
        <Text color="gray.600" fontSize="xs" fontStyle="italic">
          Unknown Target
        </Text>
      )}
    </Flex>
  )
}
