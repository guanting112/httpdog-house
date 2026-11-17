// Times and untrusted text, made fit to show. Times are Unix seconds everywhere in this project
// and are shown in the reader's own time zone, in a form that sorts and cannot be misread.

const two = (n: number) => String(n).padStart(2, '0')

/** 14:03:22 */
export function clock(seconds: number): string {
  const d = new Date(seconds * 1000)
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}

/** 2026-11-17 */
export function day(seconds: number): string {
  const d = new Date(seconds * 1000)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** 2026-11-17 14:03:22 */
export function stamp(seconds: number): string {
  return `${day(seconds)} ${clock(seconds)}`
}

/** The reader's offset from UTC, as "UTC+8" or "UTC-3:30" */
export function zone(): string {
  const minutes = -new Date().getTimezoneOffset()
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `UTC${sign}${Math.floor(abs / 60)}${abs % 60 ? `:${two(abs % 60)}` : ''}`
}

/** The value a <input type="datetime-local"> takes, for a time in Unix seconds */
export function toLocalInput(seconds: number | null): string {
  return seconds === null ? '' : `${day(seconds)}T${clock(seconds).slice(0, 5)}`
}

/** Unix seconds for what a <input type="datetime-local"> holds, or null when it is empty */
export function fromLocalInput(value: string): number | null {
  const ms = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
}

const NAMED: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' }

/**
 * Text that came out of an access log, with nothing invisible left in it. httpdog keeps
 * `message`, `group` and `event` exactly as they were in the log, so they can hold newlines,
 * escape sequences, or the Unicode marks that reverse the direction of text. On a page those
 * could make an alert read as something it is not, so each is shown as an escape instead.
 */
export function printable(text: string): string {
  // C0, DEL, C1, then every mark Unicode lists as Bidi_Control: ALM, LRM, RLM, the embeddings and
  // overrides, the isolates. Written as escapes: typed as they are, they would be invisible here too
  return text.replace(/[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/g, (char) => {
    const code = char.charCodeAt(0)
    return NAMED[char] ?? (code < 0x100 ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`)
  })
}

/** 1234567 as "1,234,567" */
export function grouped(n: number): string {
  return n.toLocaleString('en-US')
}
