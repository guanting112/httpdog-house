// A small syntax highlighter for the few languages this UI shows, the same one httpdog's website
// uses. It splits a line into tokens; the components render each token as a <span>, so no HTML is
// ever built from strings. That matters here: the text being coloured comes out of access logs.

export type Lang = 'yaml' | 'shell' | 'env' | 'json' | 'log' | 'text'

export interface Token {
  /** CSS class suffix (`tk-...`), or '' for plain text */
  t: string
  s: string
}

type Rule = [RegExp, string]

function scan(line: string, rules: Rule[]): Token[] {
  const out: Token[] = []
  let rest = line
  let plain = ''
  const flush = () => {
    if (plain) out.push({ t: '', s: plain })
    plain = ''
  }
  outer: while (rest) {
    for (const [re, kind] of rules) {
      const m = re.exec(rest)
      if (!m || m.index !== 0 || !m[0]) continue
      flush()
      out.push({ t: kind, s: m[0] })
      rest = rest.slice(m[0].length)
      continue outer
    }
    plain += rest[0]
    rest = rest.slice(1)
  }
  flush()
  return out
}

const YAML: Rule[] = [
  [/^#.*/, 'c'],
  [/^\s+#.*/, 'c'],
  [/^"(?:[^"\\]|\\.)*"/, 's'],
  [/^'(?:[^'\\]|\\.)*'/, 's'],
  [/^[A-Za-z_][\w.-]*(?=:(\s|$))/, 'k'],
  [/^\d+(?:\.\d+)?[smh]?(?![\w./-])/, 'n'],
  [/^(?:true|false|null)(?![\w-])/, 'v'],
  [/^[{}[\],:]/, 'p'],
  [/^-(?=\s)/, 'p'],
  // a bare word runs to the next separator, so /.env or remote_addr stay in one piece
  [/^[^\s{}[\],:#"']+/, ''],
  [/^\s+/, ''],
]

const SHELL: Rule[] = [
  [/^#.*/, 'c'],
  [/^\s+#.*/, 'c'],
  [/^"(?:[^"\\]|\\.)*"/, 's'],
  [/^'[^']*'/, 's'],
  [/^\$\{?[A-Za-z_]\w*\}?/, 'var'],
  [/^--?[A-Za-z][\w-]*/, 'f'],
  [/^(?:sudo|export)(?=\s)/, 'v'],
  [/^[|<>&;\\]+/, 'p'],
  [/^[^\s"'$|<>&;\\#]+/, ''],
  [/^\s+/, ''],
]

/** An environment file: NAME=value */
const ENV: Rule[] = [
  [/^#.*/, 'c'],
  [/^[A-Za-z_]\w*(?==)/, 'k'],
  [/^=/, 'p'],
  [/^.+/, 's'],
]

const JSONL: Rule[] = [
  [/^"(?:[^"\\]|\\.)*"(?=\s*:)/, 'k'],
  [/^"(?:[^"\\]|\\.)*"/, 's'],
  [/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'n'],
  [/^(?:true|false|null)\b/, 'v'],
  [/^[{}[\],:]/, 'p'],
  [/^\s+/, ''],
]

/** An alert as httpdog prints it: only the parts worth pointing at are coloured */
const LOG: Rule[] = [
  [/^ALERT/, 'alert'],
  [/^\[httpdog\]/, 'dim'],
  [/^\|/, 'p'],
  [/^[^\s|]+/, ''],
  [/^\s+/, ''],
]

const RULES: Record<Lang, Rule[]> = { yaml: YAML, shell: SHELL, env: ENV, json: JSONL, log: LOG, text: [] }

export function highlightLine(line: string, lang: Lang): Token[] {
  if (lang === 'text' || !line) return [{ t: '', s: line }]
  const tokens = scan(line, RULES[lang])
  if (lang === 'shell') markCommand(tokens)
  return tokens
}

/** The first word of a shell command (after `sudo`, or after a pipe) is the program name */
function markCommand(tokens: Token[]) {
  let expect = true
  for (const tk of tokens) {
    if (tk.t === 'c') return
    if (tk.t === 'p') {
      if (tk.s.includes('|') || tk.s.includes(';') || tk.s.includes('&')) expect = true
      continue
    }
    if (!tk.s.trim()) continue
    if (tk.t === 'v') continue
    if (expect && tk.t === '' && !tk.s.includes('=')) tk.t = 'cmd'
    expect = false
  }
}

export function highlight(code: string, lang: Lang): Token[][] {
  return code.split('\n').map((line) => highlightLine(line, lang))
}
