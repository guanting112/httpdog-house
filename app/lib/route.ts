// Small helpers for reading the address bar.

/** Where to go after signing in: a path on this site, never another site */
export function nextPath(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/'
}

/** One query value as text: `?a=1&a=2` gives the first */
export function queryString(value: unknown): string {
  const one = Array.isArray(value) ? value[0] : value
  return typeof one === 'string' ? one : ''
}

/** One query value as a whole number of zero or more, or null */
export function queryNumber(value: unknown): number | null {
  const text = queryString(value)
  return /^\d{1,15}$/.test(text) ? Number(text) : null
}
