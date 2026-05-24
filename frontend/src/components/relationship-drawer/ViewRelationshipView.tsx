import { Box, Flex, HStack, Text } from '@chakra-ui/react'
import type { ViewTreeNode } from '../../types'
import { ConnectionIndicator } from './ConnectionIndicator'
import { RelationshipCard } from './RelationshipCard'

interface ViewRelationshipData {
  selectedView: ViewTreeNode
  parentView: ViewTreeNode | undefined
  childrenViews: ViewTreeNode[]
}

interface ViewRelationshipViewProps {
  data: ViewRelationshipData
  cardShadow: string
  onSelectRow: (key: string) => void
}

export function ViewRelationshipView({ data, cardShadow, onSelectRow }: ViewRelationshipViewProps) {
  return (
    <Flex direction="column" align="center">
      {data.parentView ? (
        <Flex direction="column" align="center">
          <RelationshipCard
            name={data.parentView.name}
            type={data.parentView.level_label || 'View'}
            borderColor="purple.300"
            compactLevel={1}
            onClick={() => onSelectRow(`view:${data.parentView!.id}`)}
          />
          <ConnectionIndicator position="vertical" compactLevel={1} />
        </Flex>
      ) : (
        <Text color="gray.600" fontSize="2xs" fontWeight="bold" textTransform="uppercase" mb={2}>
          Root View
        </Text>
      )}

      <Box position="relative" zIndex={10} isolation="isolate" data-pan-block="true">
        <RelationshipCard
          isSelected
          name={data.selectedView.name}
          type={data.selectedView.level_label || 'View'}
          borderColor="purple.400"
          shadow={cardShadow}
          compactLevel={0}
        />
      </Box>

      {data.childrenViews.length > 0 ? (
        <Flex direction="column" align="center">
          <ConnectionIndicator position="vertical" compactLevel={1} />
          <HStack spacing={4} wrap="wrap" justify="center" maxW="80vw" data-pan-block="true">
            {data.childrenViews.map((child) => (
              <RelationshipCard
                key={child.id}
                name={child.name}
                type={child.level_label || 'View'}
                borderColor="purple.200"
                compactLevel={1}
                onClick={() => onSelectRow(`view:${child.id}`)}
              />
            ))}
          </HStack>
        </Flex>
      ) : (
        <Text color="gray.600" fontSize="2xs" fontWeight="bold" textTransform="uppercase" mt={4}>
          No child views
        </Text>
      )}
    </Flex>
  )
}
