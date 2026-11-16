// Instance names, and the patterns that say which instances a signing key may sign for.

/** httpdog's own limit on `instance` (docs/rules.md) */
export const INSTANCE_MAX = 64

// C0 controls, DEL and the C1 controls
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** The rule httpdog applies to `instance`: 1 to 64 characters, none of them a control character */
export function isInstanceName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && [...value].length <= INSTANCE_MAX && !CONTROL.test(value)
}

/** A pattern is an instance name in which `*` stands for any run of characters, including none */
export function isInstancePattern(value: unknown): value is string {
  return isInstanceName(value)
}

/** Case-sensitive, as instance names are. Only `*` is special */
export function matchesInstance(pattern: string, instance: string): boolean {
  if (!pattern.includes('*')) return pattern === instance
  const parts = pattern.split('*')
  const first = parts[0]!
  const last = parts[parts.length - 1]!
  if (!instance.startsWith(first)) return false
  let at = first.length
  // the pieces between two stars must appear in order, each after the one before it
  for (const part of parts.slice(1, -1)) {
    const found = instance.indexOf(part, at)
    if (found < 0) return false
    at = found + part.length
  }
  return instance.length - last.length >= at && instance.endsWith(last)
}

/** Splits what a person typed (one per line, or separated by commas) into a clean list without repeats */
export function parsePatterns(text: string): string[] {
  const seen = new Set<string>()
  for (const piece of text.split(/[\n,]/)) {
    const pattern = piece.trim()
    if (pattern) seen.add(pattern)
  }
  return [...seen]
}
