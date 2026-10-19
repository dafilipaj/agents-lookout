/**
 * Text that comes from other tools' errors may carry secrets (an API key in an error message,
 * a URL with `user:pass@`, an Authorization header). Anything Lookout passes on to the UI goes
 * through here: JSON escapes decoded, the whole text redacted, then one line, bounded.
 */
const REDACTIONS: [RegExp, string | ((m: string) => string)][] = [
  [/\bsk-[A-Za-z0-9_-]{4,}/g, 'sk-…'],
  // GitHub tokens, however short (WORK-7.7): classic `ghp_`, OAuth, app, refresh, fine-grained.
  [/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '$1…'],
  // An Authorization header, with its scheme: `Authorization: token <x>` leaves neither word.
  [/\b(authorization\s*:\s*)(?:(?:bearer|token|basic)\s+)?[^\s,;]+/gi, '$1…'],
  [/\bBearer\s+[^\s"',;]+/gi, 'Bearer …'],
  [/\bBasic\s+[A-Za-z0-9+/=]{8,}/g, 'Basic …'],
  // The scheme and the name prefix below are bounded: unbounded, they rescan every dash-joined word
  // to the end, and a long tool error blocks the server for seconds.
  [/([a-z][a-z0-9+.-]{0,31}:\/\/)[^\s/@:]+:[^\s/@]*@/gi, '$1…@'],
  // A secret's name, also at the end of a longer one (`access_token=`, `client_secret=`,
  // `X-Amz-Signature=`, `"refreshToken":`), then its value, up to the next query parameter or quote (WORK-7.7).
  [
    /\b[A-Za-z0-9_-]{0,64}?(api[_-]?key|apikey|token|secret|password|passwd|authorization|signature|credential)s?(["']?\s*[=:]\s*["']?)[^\s,;&"']+/gi,
    (m) => m.replace(/([=:]\s*["']?)[^\s,;&"']+$/, '$1…'),
  ],
  [/[A-Fa-f0-9]{24,}/g, '…'],
  [/[A-Za-z0-9+_-]{32,}={0,2}/g, '…'],
];

/** Shown instead when a text can't be normalised safely. */
export const WITHHELD = 'details withheld';

export function redact(text: string): string {
  let out = text;
  for (const [re, by] of REDACTIONS) out = out.replace(re, by as string);
  return out;
}

/** `-`, `\n`, `\"`… written out as escapes become the characters they stand for. */
function decodeEscapes(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\([nrt"\\/])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c as 'n' | 'r' | 't'] ?? c);
}

/** One line of at most `max` characters, redacted; null for anything that isn't text. */
export function sanitizeLine(text: unknown, max = 160): string | null {
  if (typeof text !== 'string') return null;
  let line: string;
  try {
    // Redact the whole text first, so a secret can't hide across a line break or a cut.
    const clean = redact(decodeEscapes(text.normalize('NFKC')));
    line = (clean.split(/\r?\n/).find((l) => l.trim() !== '') ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ') // eslint-disable-line no-control-regex -- strip controls
      .trim()
      .replace(/^error:\s*/i, '');
  } catch {
    return WITHHELD;
  }
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
