import { motion } from 'framer-motion'
import { ElementBody } from '../NodeBody'
import { ElementContainer } from '../NodeContainer'

interface RelationshipCardProps {
  name: string
  type?: string
  technology?: string
  borderColor?: string
  onClick?: () => void
  compactLevel?: number
  testId?: string
  isSelected?: boolean
  shadow?: string
}

export function RelationshipCard({
  name,
  type = '',
  technology = '',
  borderColor = 'whiteAlpha.200',
  onClick,
  compactLevel = 0,
  testId = 'inventory-connector-card',
  isSelected = false,
  shadow,
}: RelationshipCardProps) {
  const cardPadding = compactLevel >= 3 ? 1 : compactLevel >= 2 ? 1.5 : compactLevel >= 1 ? 2 : 3
  const showTech = compactLevel < 2 && !!technology
  const showType = compactLevel < 3 && !!type
  const minW = compactLevel >= 2 ? '100px' : '130px'
  const maxW = compactLevel >= 2 ? '160px' : '200px'

  const truncatedName = name.length > 30 ? name.slice(0, 29) + '…' : name
  const nameLen = truncatedName.length
  const nameSize =
    compactLevel >= 3
      ? nameLen > 15
        ? '2xs'
        : 'xs'
      : compactLevel >= 2
        ? nameLen > 20
          ? '2xs'
          : 'xs'
        : compactLevel >= 1
          ? nameLen > 22
            ? 'xs'
            : 'sm'
          : nameLen > 24
            ? 'xs'
            : 'sm'

  return (
    <motion.div
      data-testid={testId}
      data-pan-block="true"
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.18 }}
    >
      <ElementContainer
        onClick={onClick}
        minW={minW}
        maxW={maxW}
        p={0}
        isSelected={isSelected}
        cursor={onClick ? 'pointer' : 'default'}
        borderColor={isSelected ? borderColor : 'whiteAlpha.200'}
        borderWidth={isSelected ? '2px' : '1px'}
        boxShadow={shadow}
        _hover={
          onClick
            ? {
                borderColor: isSelected ? borderColor : 'var(--accent)',
                boxShadow: '0 0 0 1px rgba(var(--accent-rgb), 0.25)',
              }
            : undefined
        }
        position="relative"
      >
        <ElementBody
          name={truncatedName}
          type={showType ? type : ''}
          technology={showTech ? technology : undefined}
          nameSize={nameSize}
          align="flex-start"
          p={cardPadding}
          pl={cardPadding}
        />
      </ElementContainer>
    </motion.div>
  )
}
