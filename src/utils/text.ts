/** Trim leading/trailing whitespace; fall back if empty. */
export function normalizeDisplayName(value: string, fallback = 'Unnamed'): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}
