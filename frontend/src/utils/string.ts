/**
 * Truncates a string to a specified length and appends an ellipsis.
 */
export const truncate = (str: string, limit: number = 15): string => {
  if (str.length <= limit) return str
  return str.slice(0, limit) + '...'
}
