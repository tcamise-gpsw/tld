import {
  Box,
  Button,
  FormLabel,
  HStack,
  Text,
  VStack,
} from '@chakra-ui/react'
import { CheckCircleIcon, DownloadIcon, InfoOutlineIcon, RepeatIcon, WarningIcon } from '@chakra-ui/icons'
import { useState } from 'react'
import { isWailsApp } from '../config/runtime'
import { tldVersion } from '../config/runtime'
import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  type DesktopUpdateStatus,
} from '../lib/desktop'

type UpdateAction = 'checking' | 'installing' | null

function statusDisplay(status: DesktopUpdateStatus | null, error: string) {
  if (error) {
    return { text: error, color: 'orange.200', icon: WarningIcon } as const
  }
  if (!status) return null
  if (status.message) {
    return { text: status.message, color: 'gray.400', icon: InfoOutlineIcon } as const
  }
  if (!status.supported) {
    return { text: 'Updates not available on this platform.', color: 'gray.500', icon: InfoOutlineIcon } as const
  }
  if (status.updateAvailable) {
    return { text: `v${status.latest} available`, color: 'blue.200', icon: DownloadIcon } as const
  }
  if (status.checked) {
    return { text: 'Up to date', color: 'green.300', icon: CheckCircleIcon } as const
  }
  return null
}

export default function UpdateSettings({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null)
  const [error, setError] = useState('')
  const [action, setAction] = useState<UpdateAction>(null)
  const busy = action !== null
  const display = statusDisplay(status, error)
  const canInstall = !!status?.canInstall
  const displayVersion = tldVersion.startsWith('v') ? tldVersion : `v${tldVersion}`

  async function handleCheck() {
    setAction('checking')
    setError('')
    try {
      setStatus(await checkForDesktopUpdate())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update check failed.')
    } finally {
      setAction(null)
    }
  }

  function handleAction() {
    if (canInstall) {
      void handleInstall()
      return
    }
    void handleCheck()
  }

  async function handleInstall() {
    setAction('installing')
    setError('')
    try {
      setStatus(await installDesktopUpdate())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.')
    } finally {
      setAction(null)
    }
  }

  if (!isWailsApp) {
    return (
      <VStack align="start" spacing={compact ? 4 : 6} maxW={compact ? '320px' : '520px'} w="full">
        <Box w="full">
          <FormLabel mb={3} fontSize={compact ? 'xs' : 'sm'} textTransform="uppercase" letterSpacing="0.12em" color="gray.400">
            Version
          </FormLabel>
          <Text fontSize="xs" color="gray.500">Only available in the desktop app.</Text>
        </Box>
      </VStack>
    )
  }

  return (
    <VStack align="start" spacing={compact ? 4 : 6} maxW={compact ? '320px' : '520px'} w="full">
      <Box w="full">
        <FormLabel mb={3} fontSize={compact ? 'xs' : 'sm'} textTransform="uppercase" letterSpacing="0.12em" color="gray.400">
          Desktop Updates
        </FormLabel>

        <VStack align="stretch" spacing={3}>
          <HStack justify="space-between" align="center">
            <HStack spacing={2} align="center">
              <Text fontSize="sm" color="gray.300" fontWeight="500">
                {displayVersion}
              </Text>
              {display && (
                <HStack
                  spacing={1}
                  px={2}
                  py={0.5}
                  borderRadius="full"
                  bg={
                    display.color === 'green.300'
                      ? 'green.900'
                      : display.color === 'blue.200'
                        ? 'blue.900'
                        : display.color === 'orange.200'
                          ? 'orange.900'
                          : 'whiteAlpha.100'
                  }
                  opacity={0.9}
                >
                  <display.icon boxSize={2.5} color={display.color} />
                  <Text fontSize="xs" color={display.color} fontWeight="500">
                    {display.text}
                  </Text>
                </HStack>
              )}
            </HStack>

            <Button
              size="xs"
              variant={canInstall ? 'solid' : 'ghost'}
              colorScheme={canInstall ? 'blue' : undefined}
              color={canInstall ? undefined : 'gray.400'}
              leftIcon={canInstall ? <DownloadIcon boxSize={3} /> : <RepeatIcon boxSize={3} />}
              isLoading={busy}
              loadingText={action === 'installing' ? 'Updating…' : 'Checking…'}
              isDisabled={status?.supported === false}
              onClick={handleAction}
              borderRadius="full"
              fontWeight="500"
              _hover={{
                color: canInstall ? undefined : 'gray.200',
                bg: canInstall ? undefined : 'whiteAlpha.100',
              }}
            >
              {canInstall ? 'Update' : status?.checked ? 'Recheck' : 'Check for updates'}
            </Button>
          </HStack>
        </VStack>
      </Box>
    </VStack>
  )
}
