import React from 'react'
import { HStack, VStack, Text } from '@chakra-ui/react'
import { EditIcon } from '@chakra-ui/icons'
import { KbdHint } from './PanelUI'

export interface ViewHeaderButtonProps {
  name?: string
  isOpen?: boolean
  onToggle: () => void
}

/**
 * Name: View Name Bar
 * Role: Floating bar at the top center of the canvas that shows the diagram name and opens the diagram details panel.
 * Location: Top center of the canvas, floating.
 * Aliases: Diagram Name Button, View Title Bar.
 */
export default function ViewHeaderButton({ name, isOpen, onToggle }: ViewHeaderButtonProps) {
  return (
    <VStack
      position="absolute"
      left="50%"
      top={4}
      transform="translateX(-50%)"
      zIndex={20}
      spacing={1.5}
      align="center"
      pointerEvents="none"
    >
      <HStack
        as="button"
        onClick={onToggle}
        pointerEvents="auto"
        spacing={2.5}
        bg={isOpen ? 'rgba(var(--accent-rgb), 0.12)' : 'var(--bg-panel)'}
        border="1px solid"
        borderColor={isOpen ? 'rgba(var(--accent-rgb), 0.3)' : 'whiteAlpha.100'}
        rounded="xl"
        boxShadow="0 8px 32px rgba(0,0,0,0.5)"
        backdropFilter="blur(20px)"
        px={3}
        py={1.5}
        cursor="pointer"
        role="group"
        transition="all 0.2s"
        _hover={{ borderColor: isOpen ? 'rgba(var(--accent-rgb), 0.45)' : 'whiteAlpha.200', boxShadow: '0 12px 40px rgba(0,0,0,0.6)' }}
      >
        <EditIcon
          boxSize="11px"
          color="var(--accent)"
          opacity={isOpen ? 1 : 0.55}
          transition="all 0.2s"
          _groupHover={{ opacity: 1 }}
          flexShrink={0}
        />
        <Text
          fontSize="sm"
          color={isOpen ? 'var(--accent)' : 'whiteAlpha.900'}
          fontWeight="700"
          letterSpacing="0.01em"
          noOfLines={1}
          textShadow="0 1px 0 rgba(0,0,0,0.22)"
          transition="color 0.2s"
        >
          {name || 'Untitled View'}
        </Text>
      </HStack>
      <HStack spacing={1.5} opacity={0.6} userSelect="none" pointerEvents="none">
        <KbdHint ml={0}>V</KbdHint>
        <Text fontSize="10px" fontWeight="bold" color="whiteAlpha.600">Details</Text>
        <HStack spacing={1.5}><KbdHint ml={0}>W</KbdHint><Text fontSize="10px" fontWeight="bold" color="whiteAlpha.600">Zoom Out</Text></HStack>
        <HStack spacing={1.5}><KbdHint ml={0}>S</KbdHint><Text fontSize="10px" fontWeight="bold" color="whiteAlpha.600">Zoom In</Text></HStack>
      </HStack>
    </VStack>
  )
}
