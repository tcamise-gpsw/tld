import { useCallback, useEffect, useState } from "react"
import type { CSSProperties } from "react"
import { Box, HStack, IconButton } from "@chakra-ui/react"
import {
  Quit,
  WindowIsMaximised,
  WindowMinimise,
  WindowToggleMaximise,
} from "../../wailsjs/runtime/runtime"

function MinimizeIcon() {
  return (
    <Box
      as="span"
      display="block"
      w="10px"
      h="1.5px"
      bg="currentColor"
      borderRadius="full"
    />
  )
}

function MaximizeIcon({ maximized }: { maximized: boolean }) {
  if (maximized) {
    return (
      <Box position="relative" w="13px" h="13px">
        <Box position="absolute" top="1px" right="1px" w="9px" h="9px" border="1.5px solid currentColor" />
        <Box position="absolute" bottom="1px" left="1px" w="9px" h="9px" border="1.5px solid currentColor" bg="var(--bg-header)" />
      </Box>
    )
  }

  return (
    <Box
      as="span"
      display="block"
      w="11px"
      h="11px"
      border="1.5px solid currentColor"
    />
  )
}

function CloseIcon() {
  return (
    <Box position="relative" w="13px" h="13px">
      <Box position="absolute" top="6px" left="0" w="13px" h="1.5px" bg="currentColor" transform="rotate(45deg)" borderRadius="full" />
      <Box position="absolute" top="6px" left="0" w="13px" h="1.5px" bg="currentColor" transform="rotate(-45deg)" borderRadius="full" />
    </Box>
  )
}

export default function WindowsWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  const refreshMaximized = useCallback(() => {
    WindowIsMaximised()
      .then(setIsMaximized)
      .catch(() => setIsMaximized(false))
  }, [])

  useEffect(() => {
    refreshMaximized()
    window.addEventListener("resize", refreshMaximized)
    return () => window.removeEventListener("resize", refreshMaximized)
  }, [refreshMaximized])

  const toggleMaximize = () => {
    WindowToggleMaximise()
    window.setTimeout(refreshMaximized, 120)
  }

  return (
    <HStack
      spacing={0}
      position="absolute"
      top="env(safe-area-inset-top, 0px)"
      right={0}
      h="var(--topbar-h)"
      w="var(--wails-window-controls-w, 138px)"
      zIndex={10}
      align="stretch"
      style={{ "--wails-draggable": "no-drag" } as CSSProperties}
    >
      <IconButton
        aria-label="Minimize window"
        icon={<MinimizeIcon />}
        variant="ghost"
        borderRadius={0}
        minW="46px"
        h="full"
        color="whiteAlpha.800"
        _hover={{ bg: "whiteAlpha.200", color: "white" }}
        _active={{ bg: "whiteAlpha.300" }}
        onClick={WindowMinimise}
      />
      <IconButton
        aria-label={isMaximized ? "Restore window" : "Maximize window"}
        icon={<MaximizeIcon maximized={isMaximized} />}
        variant="ghost"
        borderRadius={0}
        minW="46px"
        h="full"
        color="whiteAlpha.800"
        _hover={{ bg: "whiteAlpha.200", color: "white" }}
        _active={{ bg: "whiteAlpha.300" }}
        onClick={toggleMaximize}
      />
      <IconButton
        aria-label="Close window"
        icon={<CloseIcon />}
        variant="ghost"
        borderRadius={0}
        minW="46px"
        h="full"
        color="whiteAlpha.800"
        _hover={{ bg: "#c42b1c", color: "white" }}
        _active={{ bg: "#a82419" }}
        onClick={Quit}
      />
    </HStack>
  )
}
