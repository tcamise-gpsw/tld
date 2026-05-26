import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Center, Spinner } from '@chakra-ui/react'
import { api } from '../api/client'

export function HomeRedirect() {
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    api.workspace.views
      .tree()
      .then((tree) => {
        if (!mounted) return
        const roots = (tree || []).filter((view) => view.parent_view_id === null)
        if (roots.length > 0) setTarget(`/views/${roots[0].id}`)
        else setTarget('/views')
      })
      .catch(() => mounted && setTarget('/views'))
      .finally(() => mounted && setLoading(false))

    return () => {
      mounted = false
    }
  }, [])

  if (loading) {
    return (
      <Center h="100%">
        <Spinner size="xl" />
      </Center>
    )
  }

  return <Navigate to={target || '/views'} replace />
}
