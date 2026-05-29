import type { LibraryElement } from '../types'

export type ElementCreateSearchResult =
  | { kind: 'new'; label: string }
  | { kind: 'existing'; obj: LibraryElement }

export function filterElementCreateSearchResults(
  query: string,
  allElements: LibraryElement[],
  remoteElements: LibraryElement[],
): LibraryElement[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const byID = new Map<number, LibraryElement>()
  remoteElements.forEach((element) => byID.set(element.id, element))
  allElements.forEach((element) => byID.set(element.id, element))
  const candidates = Array.from(byID.values())

  try {
    const re = new RegExp(query, 'i')
    return candidates.filter((element) => re.test(element.name)).slice(0, 8)
  } catch {
    const q = query.toLowerCase()
    return candidates.filter((element) => element.name.toLowerCase().includes(q)).slice(0, 8)
  }
}

export function buildElementCreateSearchResults({
  query,
  allElements,
  remoteElements,
  allowCreate = true,
}: {
  query: string
  allElements: LibraryElement[]
  remoteElements: LibraryElement[]
  allowCreate?: boolean
}): ElementCreateSearchResult[] {
  const filtered = filterElementCreateSearchResults(query, allElements, remoteElements)
  return [
    ...(allowCreate ? [{ kind: 'new', label: query.trim() || 'Unnamed' } as ElementCreateSearchResult] : []),
    ...filtered.map((obj): ElementCreateSearchResult => ({ kind: 'existing', obj })),
  ]
}
