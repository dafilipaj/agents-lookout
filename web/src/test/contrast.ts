/**
 * WCAG contrast from index.css's OKLCH colour tokens, painted as a browser paints them: a colour
 * with alpha (its token's own, or a class's `/12`) is composited over what's under it in sRGB.
 */
export type Mode = 'light' | 'dark';
type Oklch = { l: number; c: number; h: number; a: number };
export type Rgb = [number, number, number];

/**
 * One `oklch()` value, as CSS Color 4 reads it: lightness a number or a percentage (100% = 1),
 * chroma a number or a percentage (100% = 0.4), hue a number or degrees, and an optional `/ alpha`
 * (a number or a percentage). Anything else (`none`, `calc()`, a variable, a typo) is refused, so a
 * value this reader can't read never turns into NaN and a check that passes on it.
 */
export function parseOklch(value: string): Oklch {
  const m = /^\s*(\S+)\s+(\S+)\s+(\S+)\s*(?:\/\s*(\S+)\s*)?$/.exec(value);
  const num = (part: string | undefined, percentOf: number | null, unit = '') => {
    const p = /^(-?(?:\d+\.?\d*|\.\d+))(%|[a-z]*)$/.exec(part ?? '');
    const scale = !p ? NaN : p[2] === '%' ? (percentOf ?? NaN) / 100 : p[2] === '' || p[2] === unit ? 1 : NaN;
    const n = p ? Number(p[1]) * scale : NaN;
    if (!Number.isFinite(n)) throw new Error(`can't read oklch(${value.trim()}): ${part ?? 'missing part'}`);
    return n;
  };
  if (!m) throw new Error(`can't read oklch(${value.trim()})`);
  return { l: num(m[1], 1), c: num(m[2], 0.4), h: num(m[3], null, 'deg'), a: m[4] === undefined ? 1 : num(m[4], 1) };
}

/**
 * Each token's value in light mode (`:root`) and dark mode (the media query, over the light ones).
 * A colour token (one the Tailwind theme maps to a `--color-*`) written any other way than
 * `oklch()` is refused: skipped, a dark override would quietly measure as its light value.
 */
export function themeTokens(css: string): Record<Mode, Record<string, Oklch>> {
  const darkAt = css.indexOf('@media (prefers-color-scheme: dark) {');
  const themeAt = css.indexOf('@theme inline');
  const colours = new Set([...css.slice(themeAt).matchAll(/--color-[a-z0-9-]+:\s*var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]!));
  const read = (block: string) => {
    const tokens: Record<string, Oklch> = {};
    for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
      const value = /^oklch\(([^)]+)\)$/.exec(m[2]!.trim());
      if (value) tokens[m[1]!] = parseOklch(value[1]!);
      else if (colours.has(m[1]!)) throw new Error(`--${m[1]} isn't an oklch() colour: ${m[2]!.trim()}`);
    }
    return tokens;
  };
  const light = read(css.slice(css.indexOf(':root {'), darkAt));
  return { light, dark: { ...light, ...read(css.slice(darkAt, themeAt)) } };
}

/** OKLCH to gamma-encoded sRGB, clipped to the gamut. */
function srgb({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S, -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S, -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S];
  return linear.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  }) as Rgb;
}

/** A token painted over `under`, at its own alpha times `alpha`. */
export function paint(tokens: Record<string, Oklch>, token: string, under: Rgb, alpha = 1): Rgb {
  const t = tokens[token];
  if (!t) throw new Error(`no colour token --${token}`);
  const top = srgb(t);
  const k = t.a * alpha;
  return top.map((v, i) => k * v + (1 - k) * under[i]!) as Rgb;
}

/** An opaque token on its own. */
export function solid(tokens: Record<string, Oklch>, token: string): Rgb {
  return paint(tokens, token, [0, 0, 0]);
}

export function contrast(a: Rgb, b: Rgb): number {
  const lum = (rgb: Rgb) => {
    const [r, g, b] = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as Rgb;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  const ratio = (hi + 0.05) / (lo + 0.05);
  if (!Number.isFinite(ratio)) throw new Error(`contrast of ${a.join(',')} on ${b.join(',')} isn't a number`);
  return ratio;
}

/**
 * The colour a set of classes gives for a prefix, without variants: `bg-needs-you/26 hover:bg-x` →
 * `{ token: 'needs-you', alpha: 0.26 }`; null when none does. A class with the prefix this can't
 * read (`bg-x/[60%]`), or two of them, is refused rather than measured as no colour.
 */
export function colourOf(classes: string, prefix: 'bg' | 'text' | 'hover:bg'): { token: string; alpha: number } | null {
  const found: { token: string; alpha: number }[] = [];
  for (const c of classes.split(/\s+/)) {
    if (!c.startsWith(`${prefix}-`)) continue;
    const m = new RegExp(`^${prefix}-([a-z-]+)(?:/(\\d+))?$`).exec(c);
    if (!m) throw new Error(`can't read the colour of ${c}`);
    found.push({ token: m[1]!, alpha: m[2] ? Number(m[2]) / 100 : 1 });
  }
  if (found.length > 1) throw new Error(`more than one ${prefix} colour in "${classes}"`);
  return found[0] ?? null;
}
