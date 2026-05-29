import {
  Alert,
  AlertDescription,
  AlertIcon,
  Badge,
  Box,
  Button,
  Divider,
  FormLabel,
  HStack,
  Text,
  VStack,
} from '@chakra-ui/react'
import { DownloadIcon, ExternalLinkIcon, RepeatIcon } from '@chakra-ui/icons'
import { useState } from 'react'
import { isWailsApp, tldVersion } from '../config/runtime'
import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  openExternalUrl,
  type DesktopUpdateStatus,
} from '../lib/desktop'

type UpdateAction = 'checking' | 'installing' | null

function updateStatusLabel(status: DesktopUpdateStatus | null): string {
  if (!status) return 'Not checked'
  if (!status.supported) return 'Unsupported'
  if (status.updateAvailable) return 'Update available'
  if (status.checked) return 'Up to date'
  return 'Not checked'
}

function updateStatusColor(status: DesktopUpdateStatus | null): string {
  if (!status) return 'gray'
  if (!status.supported) return 'orange'
  if (status.updateAvailable) return 'blue'
  if (status.checked) return 'green'
  return 'gray'
}

function updateMessage(status: DesktopUpdateStatus | null, error: string): string {
  if (error) return error
  if (!status) return ''
  if (status.message) return status.message
  if (!status.supported) return 'Desktop updates are not available on this platform.'
  if (status.updateAvailable) return `Version ${status.latest} is available.`
  if (status.checked) return `Version ${status.current} is up to date.`
  return ''
}

export default function UpdateSettings() {
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null)
  const [error, setError] = useState('')
  const [action, setAction] = useState<UpdateAction>(null)
  const busy = action !== null
  const currentVersion = status?.current || tldVersion
  const message = updateMessage(status, error)
  const alertStatus: 'warning' | 'info' | 'success' = error || status?.supported === false ? 'warning' : status?.updateAvailable ? 'info' : 'success'

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
      <VStack align="start" spacing={6} maxW="520px" w="full">
        <Box w="full">
          <FormLabel mb={3} fontSize="sm" textTransform="uppercase" letterSpacing="0.12em" color="gray.400">
            Desktop Updates
          </FormLabel>
          <Text fontSize="sm" color="gray.300">Only available in the desktop app.</Text>
        </Box>
      </VStack>
    )
  }

  return (
    <VStack align="start" spacing={6} maxW="520px" w="full">
      <Box w="full">
        <FormLabel mb={3} fontSize="sm" textTransform="uppercase" letterSpacing="0.12em" color="gray.400">
          Desktop Updates
        </FormLabel>

        <VStack align="stretch" spacing={4}>
          <HStack justify="space-between" align="center" spacing={4}>
            <Box minW={0}>
              <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="0.08em">
                Current
              </Text>
              <Text fontSize="sm" color="gray.100" fontFamily="mono">{currentVersion}</Text>
            </Box>
            <Badge colorScheme={updateStatusColor(status)} variant="subtle" flexShrink={0}>
              {updateStatusLabel(status)}
            </Badge>
          </HStack>

          {status?.latest && (
            <HStack justify="space-between" align="center" spacing={4}>
              <Box minW={0}>
                <Text fontSize="xs" color="gray.500" textTransform="uppercase" letterSpacing="0.08em">
                  Latest
                </Text>
                <Text fontSize="sm" color="gray.100" fontFamily="mono">{status.latest}</Text>
              </Box>
              {status.assetName && (
                <Text fontSize="xs" color="gray.500" noOfLines={1} title={status.assetName}>
                  {status.assetName}
                </Text>
              )}
            </HStack>
          )}

          {message && (
            <Alert status={alertStatus} variant="subtle" rounded="md" py={2} px={3}>
              <AlertIcon boxSize={4} />
              <AlertDescription fontSize="sm">{message}</AlertDescription>
            </Alert>
          )}

          <Divider borderColor="whiteAlpha.100" />

          <HStack spacing={3} flexWrap="wrap">
            <Button
              size="sm"
              variant="clay"
              leftIcon={<RepeatIcon />}
              isLoading={action === 'checking'}
              isDisabled={busy}
              onClick={handleCheck}
            >
              Check
            </Button>
            <Button
              size="sm"
              colorScheme="blue"
              leftIcon={<DownloadIcon />}
              isLoading={action === 'installing'}
              isDisabled={!status?.canInstall || busy}
              onClick={handleInstall}
            >
              Install Update
            </Button>
            {status?.releaseUrl && (
              <Button
                size="sm"
                variant="ghost"
                color="gray.300"
                rightIcon={<ExternalLinkIcon />}
                onClick={() => openExternalUrl(status.releaseUrl)}
              >
                Release
              </Button>
            )}
          </HStack>
        </VStack>
      </Box>
    </VStack>
  )
}
