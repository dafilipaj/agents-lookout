import type { ChatEntry, ChatPage, HistoryDetail } from '@shared/types.ts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COPY_FEEDBACK_MS } from '@/lib/copy';
import { BATCH_DELAY_MS, pathParts, vscodeHref } from '@/lib/files';
import { CACHED_ENTRIES, MAX_CHAT_ENTRIES, answerFor, applyChatEvent, applyPage, chatItems, emptyChat, setFollowing, toolsLabel } from '@/lib/chat';
import { textParts } from '@/lib/links';
import { initialState, reducer } from '@/lib/store';
import { fakeResizeObserver, movePointer, renderApp, row, sizeBoxByText } from '@/test/helpers';

let n = 0;
const c = () => `c${++n}`;
const you = (text: string, over: Partial<Extract<ChatEntry, { kind: 'user' }>> = {}): ChatEntry => ({ kind: 'user', cursor: c(), ts: '2026-10-16T10:00:00Z', text, queued: false, ...over });
const agent = (text: string): ChatEntry => ({ kind: 'assistant', cursor: c(), ts: '2026-10-16T10:00:05Z', text, final: true });
const tool = (name: string, summary: string): ChatEntry => ({ kind: 'tool_call', cursor: c(), ts: null, id: `t${n}`, tool: name, summary });
const question = (over: Partial<Extract<ChatEntry, { kind: 'question' }>> = {}): ChatEntry => ({
  kind: 'question',
  cursor: c(),
  ts: null,
  id: 'toolu_q',
  questions: [
    {
      question: 'How should invoices that already exist be handled?',
      header: 'Invoices',
      multiSelect: false,
      options: [
        { label: 'Leave them as they are', description: '' },
        { label: 'Recalculate drafts only', description: 'Sent invoices keep their amounts.' },
        { label: 'Recalculate all', description: '' },
      ],
    },
  ],
  status: 'pending',
  answer: null,
  ...over,
});

const messages = () => within(screen.getByRole('list', { name: 'Messages' }));

function open(id = 'a', over: Parameters<typeof row>[0] | object = {}, options: Parameters<typeof renderApp>[1] = {}) {
  const app = renderApp(`/s/${id}`, options);
  app.snapshot([row({ id, ...over })]);
  const reset = (entries: ChatEntry[], before: string | null = null, queue: ChatEntry[] = []) =>
    app.emit({ type: 'chat', sessionId: id, op: 'reset', entries, before, queue });
  const append = (entries: ChatEntry[], updated: ChatEntry[] = [], queue: ChatEntry[] = []) =>
    app.emit({ type: 'chat', sessionId: id, op: 'append', entries, updated, queue });
  return { app, reset, append };
}

describe('chat rendering', () => {
  it('DS-12.4: your messages use Primary soft, while replies and queued prompts keep their own surfaces', () => {
    const { reset } = open();
    reset([you('Your prompt'), agent('A reply')], null, [you('Queued prompt', { queued: true })]);
    expect(screen.getByText('Your prompt').closest('.rounded-lg')).toHaveClass('bg-primary-soft');
    expect(screen.getByText('A reply').closest('.bg-primary-soft')).toBeNull();
    expect(screen.getByText('Queued prompt').closest('.rounded-lg')).toHaveClass('bg-transparent');
    expect(screen.getByText('Queued prompt').closest('.rounded-lg')).not.toHaveClass('bg-primary-soft');
  });

  it('VIEW-1.1: prompts and replies in order, newest at the bottom, replies as Markdown with code blocks', () => {
    const { app, reset } = open();
    reset([you('Fix the rate rounding'), agent('The rounding is in **`RateCalculator#apply`**:\n\n```ruby\nlines.sum { |l| l.amount }\n```')]);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('You');
    expect(items[0]).toHaveTextContent('Fix the rate rounding');
    expect(items[1]).toHaveTextContent('Claude');
    const strong = items[1]!.querySelector('strong');
    expect(strong).toHaveTextContent('RateCalculator#apply');
    expect(items[1]!.querySelector('pre code')).toHaveTextContent('lines.sum { |l| l.amount }');

    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [you('Thanks'), agent('You’re welcome.')], updated: [], queue: [] });
    const after = screen.getAllByRole('listitem');
    expect(after.at(-1)).toHaveTextContent('You’re welcome.');
    expect(after.at(-2)).toHaveTextContent('Thanks');
  });

  it('VIEW-1.1: a Codex chat names Codex, and its prompts keep their line breaks as typed', () => {
    const { reset } = open('x', { harness: 'codex' });
    reset([you('line one\n  line two'), agent('- one\n- two')]);
    expect(messages().getByText(/line one/).textContent).toBe('line one\n  line two');
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('Codex');
    expect(screen.getAllByRole('listitem')[1]!.querySelectorAll('ul li')).toHaveLength(2);
  });

  it('VIEW-1.1: Markdown from a Transcript is sanitized: no raw HTML, no script links, no remote images', () => {
    const { reset } = open();
    reset([
      agent(
        [
          'Hello <b>bold?</b> <script>alert(1)</script>',
          '<img src="x" onerror="alert(2)">',
          '[click](javascript:alert(3)) and [docs](https://example.com/docs)',
          '![diagram](https://evil.example/track.png)',
          '<iframe src="https://evil.example"></iframe>',
        ].join('\n\n'),
      ),
    ]);
    const reply = screen.getAllByRole('listitem')[0]!;
    for (const tag of ['script', 'b', 'img', 'iframe']) expect(reply.querySelector(tag)).toBeNull();
    expect(reply.innerHTML).not.toContain('onerror');
    expect(reply.innerHTML).not.toContain('javascript:');
    const links = within(reply).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com/docs');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(reply).toHaveTextContent('[image: diagram]');
    expect(reply).toHaveTextContent('click');
  });

  it('VIEW-1.1: footnotes keep their heading for screen readers only', () => {
    const { reset } = open();
    reset([agent('See the note.[^1]\n\n[^1]: Rounded half to even.')]);
    const reply = screen.getAllByRole('listitem')[0]!;
    expect(reply.querySelector('h2.sr-only')).toHaveTextContent('Footnotes');
    expect(reply.querySelector('h3')).toBeNull();
    expect(within(reply).getAllByRole('link')[0]!.getAttribute('href')).toMatch(/^#/);
  });

  it('VIEW-1.1: slash commands show as yours', () => {
    const { reset } = open();
    reset([{ kind: 'command', cursor: c(), ts: null, text: '/model claude-opus-5-5' }]);
    expect(messages().getByText('/model claude-opus-5-5').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('You');
  });

  it("VIEW-1.3: a subagent's result shows as one compact line, set apart from messages; the reply after it starts a turn", () => {
    const { reset } = open();
    const text = 'Agent "Build" finished\nsummary details stay in the title';
    reset([you('Build it'), agent('Starting a subagent.'), { kind: 'system', cursor: c(), ts: '2026-10-16T10:02:00Z', text }, agent('The build passed.')]);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    const row = items[2]!.querySelector('[data-kind="system"]')!;
    expect(row).toHaveTextContent('Agent "Build" finished');
    expect(row).not.toHaveTextContent('summary details');
    expect(row).not.toHaveTextContent(/You|Claude/);
    expect(row.className).toMatch(/\btext-meta\b/); // smaller than messages (prose)
    expect(row.querySelector('[title]')).toHaveAttribute('title', text);
    expect(items[3]).toHaveTextContent('Claude'); // the reply to it is headed again
  });
});

describe('links (VIEW-1.12)', () => {
  const links = (el: Element) => [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  const prompt = () => document.querySelector('[data-kind="user"]')!;

  it('VIEW-1.12: an address in your prompt is a link that opens in a new tab with no referrer; the text reads as before', () => {
    const { reset } = open();
    const text = 'Review https://github.com/productiveio/lookout/pull/12, then\n  ship it.';
    reset([you(text), { kind: 'command', cursor: c(), ts: null, text: '/review https://github.com/productiveio/lookout/pull/13' }]);
    const link = within(prompt() as HTMLElement).getByRole('link', { name: 'https://github.com/productiveio/lookout/pull/12' });
    expect(link).toHaveAttribute('href', 'https://github.com/productiveio/lookout/pull/12');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(link.className).toContain('underline'); // Markdown's look
    expect(prompt().lastElementChild!.textContent).toBe(text);
    // A slash command is yours too.
    expect(links(document.querySelector('[data-kind="command"]')!)).toEqual(['https://github.com/productiveio/lookout/pull/13']);
  });

  it('VIEW-1.12: trailing punctuation and unbalanced brackets stay text; balanced parentheses stay in the address', () => {
    const cases: [string, string[]][] = [
      ['Read https://en.wikipedia.org/wiki/Foo_(bar).', ['https://en.wikipedia.org/wiki/Foo_(bar)']],
      ['(see https://example.com/docs)', ['https://example.com/docs']],
      ['Done: https://x.dev/a?b=1&c=2#top! Next?', ['https://x.dev/a?b=1&c=2#top']],
      ['Is it https://x.dev/a?', ['https://x.dev/a']],
      ['one https://x.dev/a; two https://x.dev/b, three https://x.dev/c:', ['https://x.dev/a', 'https://x.dev/b', 'https://x.dev/c']],
      [`['https://a.dev/x', "https://b.dev/y"]`, ['https://a.dev/x', 'https://b.dev/y']],
      ['[docs](https://c.dev/z) and <https://d.dev> and {url: https://e.dev/q}', ['https://c.dev/z', 'https://d.dev', 'https://e.dev/q']],
      ['https://f.dev/a)].', ['https://f.dev/a']],
      ['HTTP://F.DEV/Upper', ['HTTP://F.DEV/Upper']],
      ['nothing after the scheme: https://. or http://', []],
    ];
    for (const [text, hrefs] of cases) {
      const parts = textParts(text);
      expect(parts.flatMap((p) => (p.href ? [p.href] : [])), text).toEqual(hrefs);
      expect(parts.map((p) => p.text).join(''), text).toBe(text);
    }
    const { reset } = open();
    reset([you(cases[0]![0]), you(cases[1]![0])]);
    const [wiki, docs] = screen.getAllByRole('link');
    expect(wiki).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(wiki!.parentElement!.textContent).toBe('Read https://en.wikipedia.org/wiki/Foo_(bar).');
    expect(docs).toHaveAttribute('href', 'https://example.com/docs');
    expect(docs!.parentElement!.textContent).toBe('(see https://example.com/docs)');
  });

  it('VIEW-1.12: an address followed by a 200,000-character run of closing brackets is cut in well under a second', () => {
    const tail = ')'.repeat(199_980);
    const started = performance.now();
    const parts = textParts(`https://example.com/${tail}`);
    expect(performance.now() - started).toBeLessThan(250); // was minutes: two scans per bracket cut off
    expect(parts).toEqual([
      { text: 'https://example.com/', href: 'https://example.com/' },
      { text: tail, href: null },
    ]);
  });

  it('VIEW-1.12: Markdown’s `*`, `_` and `~` after an address stay text, so code links the same address prose does', () => {
    const cases: [string, string][] = [
      ['https://example.com**', 'https://example.com'],
      ['(https://example.com)**', 'https://example.com'],
      ['**https://example.com/b**', 'https://example.com/b'],
      ['see https://example.com/a_', 'https://example.com/a'],
      ['https://example.com/a~~.', 'https://example.com/a'],
      ['https://example.com/a*b*', 'https://example.com/a*b'],
      ['https://example.com/snake_case_x.', 'https://example.com/snake_case_x'],
      ['Read https://en.wikipedia.org/wiki/Foo_(bar)_.', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
    ];
    const { reset } = open();
    reset([agent(cases.flatMap(([text]) => [text, `\`${text}\``]).join('\n\n'))]);
    const paragraphs = [...document.querySelector('[data-kind="assistant"] > div:last-child')!.children];
    expect(paragraphs).toHaveLength(cases.length * 2);
    for (const [i, [text, href]] of cases.entries()) {
      const prose = paragraphs[2 * i]!;
      const code = paragraphs[2 * i + 1]!.querySelector('code')!;
      expect(links(prose), text).toEqual([href]);
      expect(links(code), text).toEqual([href]);
      expect(code.textContent, text).toBe(text);
    }
  });

  it('VIEW-1.12: javascript:, file: and other schemes stay text; Markdown’s mailto: links still work', () => {
    const text = 'javascript:alert(1) file:///etc/passwd data:text/html,<b>x</b> ftp://x.dev mailto:me@x.dev xhttps://x.dev';
    expect(textParts(text)).toEqual([{ text, href: null }]);
    const { reset } = open();
    reset([you(text), tool('Read', 'file:///Users/me/notes.md'), agent('Run `javascript:void(0)` or `file:///tmp/x`, or [write](mailto:me@x.dev).')]);
    expect(links(document.body)).toEqual(['mailto:me@x.dev']);
    expect(prompt().lastElementChild!.textContent).toBe(text);
  });

  it('VIEW-1.12: addresses in inline code and code blocks in replies are links; code that is a link’s text isn’t linked again', () => {
    const { reset } = open();
    reset([
      agent(
        [
          'Open `https://example.com/a` or see https://example.com/c.',
          "```sh\ncurl -s 'https://api.example.com/v1/items?id=2' | jq .\n```",
          '[`https://example.com/b`](https://example.com/b)',
        ].join('\n\n'),
      ),
    ]);
    const reply = screen.getAllByRole('listitem')[0]!;
    expect(links(reply)).toEqual(['https://example.com/a', 'https://example.com/c', 'https://api.example.com/v1/items?id=2', 'https://example.com/b']);
    expect(reply.querySelector('p > code > a')).toHaveAttribute('href', 'https://example.com/a');
    const block = reply.querySelector('pre code')!;
    expect(block.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    expect(block.querySelector('a')).toHaveAttribute('target', '_blank');
    expect(block.textContent).toBe("curl -s 'https://api.example.com/v1/items?id=2' | jq .\n");
    expect(reply.querySelectorAll('a a')).toHaveLength(0);
  });

  it('VIEW-1.12: tool-call lines link their addresses, alone and expanded; they still truncate, titled with the whole line', async () => {
    const user = userEvent.setup();
    const { reset } = open();
    const summary = 'https://docs.example.com/api/auth (the token section)';
    reset([agent('Checking.'), tool('WebFetch', summary), agent('Then two.'), tool('WebFetch', 'https://a.dev/x'), tool('Bash', "curl -s 'https://b.dev/y'")]);
    const lone = document.querySelector('[data-kind="tool_call"] [title]')!;
    expect(lone).toHaveAttribute('title', summary);
    expect(lone).toHaveClass('truncate');
    expect(links(lone)).toEqual(['https://docs.example.com/api/auth']);
    expect(lone.textContent).toBe(summary);

    await user.click(screen.getByRole('button', { name: '2 tool calls: WebFetch, Bash' }));
    const lines = [...document.querySelectorAll('[data-kind="tool_calls"] li [title]')];
    expect(lines.map((l) => l.getAttribute('title'))).toEqual(['https://a.dev/x', "curl -s 'https://b.dev/y'"]);
    expect(lines.flatMap(links)).toEqual(['https://a.dev/x', 'https://b.dev/y']);
    expect(lines.every((l) => l.classList.contains('truncate'))).toBe(true);
  });

  it('VIEW-1.12: a Subagent row links its address, keeping its title', () => {
    const { reset } = open();
    const text = 'Agent "Deploy" finished: https://deploy.example.com/runs/42.\nsummary details';
    reset([{ kind: 'system', cursor: c(), ts: null, text }]);
    const line = document.querySelector('[data-kind="system"] [title]')!;
    expect(line).toHaveAttribute('title', text);
    expect(links(line)).toEqual(['https://deploy.example.com/runs/42']);
    expect(line.textContent).toBe('Agent "Deploy" finished: https://deploy.example.com/runs/42.');
  });

  it('VIEW-1.12: a question’s header, text, options and typed answer link their addresses; under the uppercase header a link keeps its case', () => {
    const { reset } = open();
    const base = (question() as Extract<ChatEntry, { kind: 'question' }>).questions[0]!;
    reset([
      question({
        status: 'answered',
        questions: [
          {
            ...base,
            header: 'Per https://figma.example.com/f/aBc',
            question: 'Which design (https://figma.example.com/f/1)?',
            options: [{ label: 'The new one', description: 'As in https://figma.example.com/f/2' }, ...base.options],
          },
        ],
        answer: { answers: ['The one at https://figma.example.com/f/3'], picked: [[]] },
      }),
    ]);
    const q = document.querySelector('[data-kind="question"]')!;
    expect(links(q)).toEqual(['https://figma.example.com/f/aBc', 'https://figma.example.com/f/1', 'https://figma.example.com/f/2', 'https://figma.example.com/f/3']);
    expect(q).toHaveTextContent('Which design (https://figma.example.com/f/1)?');
    const header = within(q as HTMLElement).getByRole('link', { name: 'https://figma.example.com/f/aBc' });
    expect(header.parentElement).toHaveClass('uppercase');
    expect(header).toHaveClass('normal-case');
  });

  it('VIEW-1.12: Enter or Space on a focused link opens it; Space doesn’t scroll the chat or release a jump’s hold; Shift+Space still scrolls up', async () => {
    const user = userEvent.setup();
    const { reset } = open();
    reset([you('See https://example.com/x'), agent('Done.')]);
    // A jump to the prompt's Mark holds the chat as scrolled up (VIEW-1.11). jsdom has no layout,
    // so the chat is always at its bottom: a scroll shows "Jump to latest" only while the hold lasts.
    await user.click(await screen.findByRole('button', { name: /^Your prompt/ }));
    const chat = screen.getByTestId('chat');
    const holds = () => {
      fireEvent.scroll(chat);
      return !!screen.queryByRole('button', { name: /Jump to latest/ });
    };
    expect(holds()).toBe(true);
    const link = screen.getByRole('link');
    let opened = 0;
    link.addEventListener('click', (e) => {
      opened++;
      e.preventDefault(); // jsdom can't navigate
    });
    link.focus();
    await user.keyboard('{Enter}');
    expect(opened).toBe(1);
    expect(fireEvent.keyDown(link, { key: ' ' })).toBe(false); // default prevented: no scroll
    expect(opened).toBe(2);
    fireEvent.keyDown(link, { key: ' ', repeat: true }); // held down: one tab, not one per repeat
    expect(opened).toBe(2);
    expect(holds()).toBe(true);
    // Shift+Space scrolls up, as anywhere else: it opens nothing, and it's your own scroll.
    expect(fireEvent.keyDown(link, { key: ' ', shiftKey: true })).toBe(true);
    expect(opened).toBe(2);
    expect(holds()).toBe(false);
  });

  it('VIEW-1.12: an address ends at a bidi control or an invisible character, in your prompt, on a tool line and in code', () => {
    // U+202E reverses what follows: `https://\u202E@evil.example/moc.elgoog` reads as `https://google.com/elpmaxe.live@`.
    const spoof = 'https://\u202E@evil.example/moc.elgoog';
    expect(textParts(spoof)).toEqual([{ text: spoof, href: null }]);
    for (const hidden of ['\u061C', '\u200B', '\u200D', '\u200F', '\u202A', '\u202E', '\u2060', '\u2066', '\u2069', '\uFEFF']) {
      const text = `see https://x.dev/a${hidden}b`;
      expect(textParts(text).flatMap((p) => (p.href ? [p.href] : [])), JSON.stringify(text)).toEqual(['https://x.dev/a']);
    }
    const { reset } = open();
    reset([you(`Open ${spoof}`), tool('WebFetch', `${spoof} and https://ok.dev/\u2066x`), agent(`Run \`curl ${spoof}\` or \`curl https://ok.dev/\u200Bb\`.`)]);
    expect(links(document.body)).toEqual(['https://ok.dev/', 'https://ok.dev/']);
    expect(prompt().lastElementChild!.textContent).toBe(`Open ${spoof}`);
    // A right-to-left override before an address can't reverse it: each link is a bidi isolate.
    reset([you('\u202Ehttps://evil.example/moc.elgoog//:sptth')]);
    expect(screen.getByRole('link')).toHaveAttribute('dir', 'ltr');
  });

  it('VIEW-1.12: a Markdown link whose text or href holds a bidi control or an invisible character, percent-encoded or not, stays text', () => {
    const { reset } = open();
    reset([
      agent(
        [
          'Bare: https://\u202E@evil.example/moc.elgoog',
          'Angled: <https://\u202E@evil.example/moc.elgoog>',
          'Text: [https://\u2066x.dev](https://x.dev)',
          'Href: [docs](https://x.dev/a\u200Bb)',
          'Encoded: [docs](https://x.dev/%E2%80%AEb) and [docs](https://x.dev/%ef%bb%bf) and [docs](https://x.dev/%D8%9Cb)',
          'Letter mark: <https://؜127.0.0.1:8080@203.0.113.9/>',
          'Fine: <https://ok.dev/a> and [ok](https://ok.dev/b)',
        ].join('\n\n'),
      ),
    ]);
    const reply = document.querySelector('[data-kind="assistant"]')!;
    expect(links(reply)).toEqual(['https://ok.dev/a', 'https://ok.dev/b']);
    expect(reply.querySelectorAll('a[dir="auto"]')).toHaveLength(2);
    expect(reply).toHaveTextContent('Angled: https://\u202E@evil.example/moc.elgoog');
    expect(reply).toHaveTextContent('Encoded: docs and docs');
  });

  it('VIEW-1.12: a quote inside an address stays in it; a quote ends it only when the same quote opens right before it', () => {
    const cases: [string, string[]][] = [
      ["See https://en.wikipedia.org/wiki/Murphy's_law", ["https://en.wikipedia.org/wiki/Murphy's_law"]],
      ["curl 'https://x.dev/a'", ['https://x.dev/a']],
      ['["https://x.dev/a"]', ['https://x.dev/a']],
      ['{"a":"https://x.dev/a","b":"https://y.dev/b?q=\'d\'&e=1"}', ['https://x.dev/a', "https://y.dev/b?q='d'&e=1"]],
      ["\"https://x.dev/it's\"", ["https://x.dev/it's"]],
      ['git commit -m "fix, see https://x.dev/a"', ['https://x.dev/a']],
    ];
    for (const [text, hrefs] of cases) {
      const parts = textParts(text);
      expect(parts.flatMap((p) => (p.href ? [p.href] : [])), text).toEqual(hrefs);
      expect(parts.map((p) => p.text).join(''), text).toBe(text);
    }
    // Code links what prose does.
    const { reset } = open();
    reset([agent("https://en.wikipedia.org/wiki/Murphy's_law\n\n`https://en.wikipedia.org/wiki/Murphy's_law`")]);
    expect(links(document.querySelector('[data-kind="assistant"]')!)).toEqual(["https://en.wikipedia.org/wiki/Murphy's_law", "https://en.wikipedia.org/wiki/Murphy's_law"]);
  });

  it('VIEW-1.12: an IPv6 host links in code and in Markdown’s <…> and […](…) links; a bare one in prose stays text', () => {
    const { reset } = open();
    reset([agent('`https://[::1]:8080/a`\n\n<https://[::1]:8080/b>\n\n[local](https://me@[fe80::1]/c)\n\nhttps://[::1]:8080/d')]);
    const reply = document.querySelector('[data-kind="assistant"]')!;
    expect(links(reply)).toEqual(['https://[::1]:8080/a', 'https://[::1]:8080/b', 'https://me@[fe80::1]/c']);
    expect(within(reply as HTMLElement).getByRole('link', { name: 'https://[::1]:8080/b' })).toBeInTheDocument();
    expect(reply).toHaveTextContent('https://[::1]:8080/d');
  });

  it('VIEW-1.12: a truncated row shows whole while a link in it has keyboard focus, so Tab doesn’t scroll it sideways', async () => {
    const user = userEvent.setup();
    const { reset } = open();
    const whole = ['has-focus-visible:whitespace-normal', 'has-focus-visible:break-words'];
    reset([
      { kind: 'system', cursor: c(), ts: null, text: 'Agent "Deploy" finished: https://deploy.example.com/runs/42' },
      agent('One.'),
      tool('Bash', 'cd /a/very/long/path && curl https://x.dev/a'),
      agent('Two.'),
      tool('WebFetch', 'https://a.dev/x'),
      tool('Bash', "curl -s 'https://b.dev/y'"),
    ]);
    await user.click(screen.getByRole('button', { name: '2 tool calls: WebFetch, Bash' }));
    const rows = [...document.querySelectorAll('[data-kind="system"] [title], [data-kind="tool_call"] [title], [data-kind="tool_calls"] li [title]')];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.querySelector('a')).not.toBeNull();
      expect(row).toHaveClass('truncate', ...whole);
    }
  });
});

describe('code blocks (VIEW-1.14, VIEW-1.15)', () => {
  const draft = 'Hey team, the chat polish lands today.\n\n  Shout if anything looks off after you pull.  ';
  const reply = () => agent(`Here's a draft:\n\n\`\`\`\n${draft}\n\`\`\`\n\nAnd the type:\n\n\`\`\`ts\nexport const LINK_REL = 'noopener';\n\`\`\``);
  let restore: (() => void) | null = null;
  const clipboard = (writeText: (text: string) => Promise<void>) => {
    const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    restore = () => (had ? Object.defineProperty(navigator, 'clipboard', had) : delete (navigator as { clipboard?: unknown }).clipboard);
  };
  afterEach(() => {
    restore?.();
    restore = null;
    vi.useRealTimers();
  });

  it('VIEW-1.14: every code block has a "Copy code" button; a click copies the text between its fences and reads "Copied" for 2 s', async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    const { reset } = open();
    reset([reply()]);
    const buttons = screen.getAllByRole('button', { name: 'Copy code' });
    expect(buttons).toHaveLength(2);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(buttons[0]!);
    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith(draft); // exactly as written: no line break added at its end
    expect(buttons[0]).toHaveTextContent('Copied');
    expect(buttons[0]).toHaveAccessibleName('Copy code'); // it keeps its name…
    expect(buttons[0]!.parentElement!.querySelector('[role="status"]')).toHaveTextContent('Copied'); // …and says the outcome
    act(() => vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1));
    expect(buttons[0]).toHaveTextContent('Copied');
    act(() => vi.advanceTimersByTime(1));
    expect(buttons[0]).not.toHaveTextContent('Copied');
    expect(buttons[0]!.parentElement!.querySelector('[role="status"]')).toHaveTextContent('');

    fireEvent.click(buttons[1]!);
    await act(async () => {});
    expect(writeText).toHaveBeenLastCalledWith("export const LINK_REL = 'noopener';");
  });

  it('VIEW-1.14: "Couldn’t copy" when the browser refuses, or has no clipboard', async () => {
    clipboard(async () => {
      throw new DOMException('Document is not focused.', 'NotAllowedError');
    });
    const { reset } = open();
    reset([reply()]);
    const [button] = screen.getAllByRole('button', { name: 'Copy code' });
    fireEvent.click(button!);
    expect(await within(button!).findByText("Couldn't copy")).toBeInTheDocument();
    expect(button).toHaveClass('text-destructive');
    restore?.();
    restore = null;
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    restore = () => delete (navigator as { clipboard?: unknown }).clipboard;
    const [, second] = screen.getAllByRole('button', { name: 'Copy code' });
    fireEvent.click(second!);
    expect(await within(second!).findByText("Couldn't copy")).toBeInTheDocument();
  });

  it('VIEW-1.14: the button shows on hover or keyboard focus, Tab reaches it, and it stays in the corner while the block scrolls', async () => {
    const user = userEvent.setup();
    const { reset } = open();
    reset([agent('See https://example.com/a\n\n```ts\nconst a = 1;\n```')]);
    const button = screen.getByRole('button', { name: 'Copy code' });
    // Hidden, not removed: it stays focusable.
    expect(button).toHaveClass('opacity-0', 'group-hover/code:opacity-100', 'focus-visible:opacity-100');
    expect(button.closest('.group\\/code')).not.toBeNull();
    // Outside the block that scrolls, positioned over its corner.
    expect(button.closest('pre')).toBeNull();
    expect(button).toHaveClass('absolute', 'top-1.5', 'right-1.5');
    screen.getByRole('link', { name: 'https://example.com/a' }).focus();
    await user.tab();
    expect(button).toHaveFocus();
  });

  it('VIEW-1.15: a block without a language, or with text, txt or plain, wraps; one with another language scrolls sideways', () => {
    const { reset } = open();
    reset([agent(['```\nplain\n```', '```text\ntext\n```', '```TXT\ntxt\n```', '```plain\nplain\n```', '```ts\nts\n```', '```sh\nsh\n```'].join('\n\n'))]);
    const blocks = [...document.querySelectorAll('[data-kind="assistant"] pre')];
    expect(blocks.map((b) => b.classList.contains('whitespace-pre-wrap'))).toEqual([true, true, true, true, false, false]);
    expect(blocks.map((b) => b.classList.contains('overflow-x-auto'))).toEqual([false, false, false, false, true, true]);
    expect(blocks.slice(0, 4).every((b) => b.classList.contains('break-words'))).toBe(true);
  });

  it('VIEW-1.20: a table fits the chat: cells wrap at word boundaries, the table is never wider than the chat, and scrolling is only a fallback', () => {
    // jsdom has no layout: assert the classes that make it wrap.
    const { reset } = open();
    reset([agent('| a | b | c |\n|---|---|---|\n| x | a long sentence of prose https://example.com/a/very/long/unbroken/address | z |')]);
    const table = document.querySelector('[data-kind="assistant"] table')!;
    expect(table).toHaveClass('w-fit', 'max-w-full');
    expect(table).not.toHaveClass('w-max');
    expect(table.parentElement).toHaveClass('overflow-x-auto');
    const cells = [...table.querySelectorAll('th, td')];
    expect(cells).toHaveLength(6);
    expect(cells.every((c) => c.classList.contains('break-words') && !c.classList.contains('[overflow-wrap:anywhere]'))).toBe(true);
  });

  it('VIEW-1.19: a wrapped block makes room for the copy button on its first line only, and the room holds no text', () => {
    // Only the structure: whether the first line clears the button is layout, checked by hand in Chromium.
    const { reset } = open();
    reset([agent(['```\nplain\n```', '```text\ntext\n```', '```TXT\ntxt\n```', '```plain\nplain\n```', '```ts\nts\n```', '```sh\nsh\n```'].join('\n\n'))]);
    const blocks = [...document.querySelectorAll('[data-kind="assistant"] pre')];
    const room = blocks.map((b) => b.querySelector(':scope > [data-copy-room]'));
    expect(room.map(Boolean)).toEqual([true, true, true, true, false, false]);
    for (const r of room.slice(0, 4)) {
      expect(r).toBe(r!.parentElement!.firstElementChild);
      expect(r).toHaveClass('float-right', 'h-[1lh]', 'w-28');
      expect(r).toHaveAttribute('aria-hidden');
      expect(r!.textContent).toBe('');
    }
    expect(blocks[0]!.textContent).toBe('plain\n');
  });
});

describe('file links (VIEW-1.17)', () => {
  const ROOT = '/Users/me/Projects/acme-app';
  /** A server that knows these files, by the path as asked. */
  const knows = (files: Record<string, string>) =>
    vi.fn(async (_id: string, paths: string[]) => paths.map((path) => ({ path, exists: path in files, absolute: files[path] ?? null })));
  const vscode = (el: Element = document.body) => [...el.querySelectorAll('a[href^="vscode:"]')].map((a) => a.getAttribute('href'));
  const found = (text: string) => pathParts(text).flatMap((p) => (p.ref ? [p.text] : []));

  it('VIEW-1.17: a path in your prompt, a slash command, a reply’s prose and inline code, and a tool-call line opens in VS Code once the server finds the file', async () => {
    const checkPaths = knows({
      'src/rates.ts': `${ROOT}/src/rates.ts`,
      'README.md': '/Users/me/My Projects/acme-app/README.md',
      [`${ROOT}/app/deal.rb`]: `${ROOT}/app/deal.rb`,
    });
    const { reset } = open('a', {}, { checkPaths });
    const prompt = 'Fix src/rates.ts:12 and keep README.md current.';
    reset([
      you(prompt),
      { kind: 'command', cursor: c(), ts: null, text: '/review src/rates.ts' },
      agent('Rounding is in `src/rates.ts:12:5`; see **README.md**. The file src/gone.ts is missing.\n\n```\nsrc/rates.ts\n```'),
      tool('Read', `${ROOT}/app/deal.rb`),
    ]);
    await waitFor(() => expect(vscode()).toHaveLength(6));
    expect(vscode(document.querySelector('[data-kind="user"]')!)).toEqual([`vscode://file${ROOT}/src/rates.ts:12`, 'vscode://file/Users/me/My%20Projects/acme-app/README.md']);
    expect(vscode(document.querySelector('[data-kind="command"]')!)).toEqual([`vscode://file${ROOT}/src/rates.ts`]);
    const reply = document.querySelector('[data-kind="assistant"]')!;
    expect(vscode(reply)).toEqual([`vscode://file${ROOT}/src/rates.ts:12:5`, 'vscode://file/Users/me/My%20Projects/acme-app/README.md']);
    expect(reply.querySelector('code a')).toHaveTextContent('src/rates.ts:12:5');
    expect(reply.querySelector('strong a')).toHaveTextContent('README.md');
    expect(reply.querySelector('pre a')).toBeNull(); // a code block's paths stay text
    expect(reply).toHaveTextContent('The file src/gone.ts is missing.');
    expect(vscode(document.querySelector('[data-kind="tool_call"]')!)).toEqual([`vscode://file${ROOT}/app/deal.rb`]);

    const link = within(document.querySelector('[data-kind="user"]') as HTMLElement).getByRole('link', { name: 'src/rates.ts:12' });
    expect(link).toHaveAttribute('title', 'Open in VS Code');
    expect(link).not.toHaveAttribute('target'); // a plain click: Chrome hands it to VS Code, the page stays
    expect(document.querySelector('[data-kind="user"]')!.lastElementChild!.textContent).toBe(prompt);
    // One request for every path the chat shows, each asked once.
    expect(checkPaths).toHaveBeenCalledTimes(1);
    expect(checkPaths.mock.calls[0]![0]).toBe('a');
    expect([...checkPaths.mock.calls[0]![1]].sort()).toEqual([`${ROOT}/app/deal.rb`, 'README.md', 'src/gone.ts', 'src/rates.ts']);
  });

  it('VIEW-1.17: :line and :line:col go into the link; a range opens at its first line', () => {
    expect(pathParts('src/a.ts:12, src/b.ts:3:7 and src/c.ts:12-20.').filter((p) => p.ref).map((p) => [p.text, p.ref])).toEqual([
      ['src/a.ts:12', { path: 'src/a.ts', line: 12, col: null }],
      ['src/b.ts:3:7', { path: 'src/b.ts', line: 3, col: 7 }],
      ['src/c.ts:12-20', { path: 'src/c.ts', line: 12, col: null }],
    ]);
    expect(vscodeHref('/a/b c/d.ts', 12, 7)).toBe('vscode://file/a/b%20c/d.ts:12:7');
    expect(vscodeHref('/a/@scope/d#e.ts', null, null)).toBe('vscode://file/a/%40scope/d%23e.ts');
  });

  it('VIEW-1.17: a path needs a known extension and no spaces; version numbers, abbreviations, sentence ends, ~ and $VAR paths and addresses stay text', () => {
    const cases: [string, string[]][] = [
      ['Bumped React to 19.3.1, Vite to v8.3.4 and node@22.1.0 (2.1.170).', []],
      ['Use it, e.g. on Fridays, i.e. rarely, etc. and so on.', []],
      ['I fixed the app. Then the rates. Done at 9 a.m.', []],
      ['https://example.com/docs/README.md, ftp://x.dev/a.md, file:///Users/me/a.md and user@host:src/a.md', []],
      ['~/notes/todo.md, $HOME/a.md, %APPDATA%/b.json, C:\\a\\b.ts and //src/a.ts', []],
      ['Makefile, Dockerfile, .env, .gitignore, notes.unknownext, src/a.ts.bak and src/a.ts-old', []],
      ['src/my file.ts', ['file.ts']], // no spaces: at most the last word could be one
      ['Built with Node.js.', ['Node.js']], // a candidate: the server drops what isn't there
      ['(src/a.ts), "src/b.tsx", `src/c.js`, **src/d.md**, src/e.rb. src/f.py: and --config=g.json', ['src/a.ts', 'src/b.tsx', 'src/c.js', 'src/d.md', 'src/e.rb', 'src/f.py', 'g.json']],
      ['./a.ts ../b/c.ts /abs/d.ts .github/workflows/ci.yml .eslintrc.json Gemfile.lock src/čaj.md', ['./a.ts', '../b/c.ts', '/abs/d.ts', '.github/workflows/ci.yml', '.eslintrc.json', 'Gemfile.lock', 'src/čaj.md']],
      ['Rates.TS and README.MD', ['Rates.TS', 'README.MD']],
    ];
    for (const [text, paths] of cases) {
      expect(found(text), text).toEqual(paths);
      expect(pathParts(text).map((p) => p.text).join(''), text).toBe(text);
    }
  });

  it('VIEW-1.17: a long run with no path, and a long text of short ones, are cut in well under a second', () => {
    const started = performance.now();
    expect(found(`${'a.'.repeat(100_000)}ts`)).toEqual([]); // one run, too long to be a path
    expect(found(`${'ab/'.repeat(160)}x.ts`)).toHaveLength(1); // 484 characters
    expect(found(`${'ab/'.repeat(170)}x.ts`)).toEqual([]); // 514: longer than any path
    expect(found('see src/a.ts, '.repeat(20_000))).toHaveLength(20_000);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('VIEW-1.17: never inside a web address or a Markdown link’s text; a link’s code isn’t linked again', async () => {
    const checkPaths = knows({ 'src/rates.ts': `${ROOT}/src/rates.ts`, 'docs/a.md': `${ROOT}/docs/a.md` });
    const { reset } = open('a', {}, { checkPaths });
    reset([
      you('See https://example.com/src/rates.ts and src/rates.ts'),
      agent('Read [docs/a.md](https://example.com/docs/a.md) or [`src/rates.ts`](https://example.com/b), then src/rates.ts.'),
    ]);
    await waitFor(() => expect(vscode()).toHaveLength(2));
    const prompt = document.querySelector('[data-kind="user"]')!;
    expect([...prompt.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com/src/rates.ts', `vscode://file${ROOT}/src/rates.ts`]);
    const reply = document.querySelector('[data-kind="assistant"]')!;
    expect([...reply.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com/docs/a.md', 'https://example.com/b', `vscode://file${ROOT}/src/rates.ts`]);
    expect(reply.querySelectorAll('a a')).toHaveLength(0);
    expect(checkPaths.mock.calls.flatMap((call) => call[1])).toEqual(['src/rates.ts']);
  });

  it('VIEW-1.17: never inside an address that isn’t linked either: a bare IPv6 host GFM leaves as text in prose, or one that doesn’t parse', async () => {
    const checkPaths = knows({ 'README.md': `${ROOT}/README.md`, 'src/a.ts': `${ROOT}/src/a.ts` });
    const { reset } = open('a', {}, { checkPaths });
    const prompt = 'Open http://[bad/?file=README.md, then README.md';
    // Emphasis, strikethrough and code cut an address GFM doesn't link (an IPv6 host, a host with
    // `_`) into several nodes: it still runs on to the next space. So does one that starts in code
    // right after a word, where the text as it reads has no address start.
    const split = 'Served at https://[::1]:8080/?f=*x*README.md, http://my_host.dev/a~~b~~src/a.ts, http://my_host.dev/a`x`src/a.ts and https://[::1]:8080/?f=`README.md`, Run`https://[::1]:8080/?f=`README.md; then src/a.ts.';
    reset([you(prompt), agent(`Served at https://[::1]:8080/?file=README.md; \`https://[::1]:8080/?file=README.md\`; edit README.md.\n\n${split}`)]);
    await waitFor(() => expect(vscode()).toHaveLength(3));
    const yours = document.querySelector('[data-kind="user"]')!;
    expect(yours.querySelectorAll('a')).toHaveLength(1); // the address doesn't parse: no web link either
    expect(yours.querySelector('a')!.previousSibling!.textContent).toBe(', then ');
    expect(yours.lastElementChild!.textContent).toBe(prompt);
    const reply = document.querySelector('[data-kind="assistant"]')!;
    // The code links the part of the address it holds, as code does.
    expect([...reply.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://[::1]:8080/?file=README.md', `vscode://file${ROOT}/README.md`, 'https://[::1]:8080/?f=', `vscode://file${ROOT}/src/a.ts`]);
    expect(reply.querySelector('a[href^="vscode:"]')!.previousSibling!.textContent).toBe('; edit ');
    expect(reply.querySelectorAll('a[href^="vscode:"]')[1]!.previousSibling!.textContent).toBe('; then ');
    expect(reply).toHaveTextContent('Served at https://[::1]:8080/?file=README.md;');
    expect([...reply.querySelectorAll('p')].at(-1)!.textContent).toBe(split.replace(/[*`]|~~/g, ''));
    expect(checkPaths.mock.calls.flatMap((call) => call[1]).sort()).toEqual(['README.md', 'src/a.ts']);
  });

  it('VIEW-1.17: a past Session’s chat has no file links, and asks nothing', async () => {
    const checkPaths = knows({ 'src/rates.ts': `${ROOT}/src/rates.ts` });
    const pastSession = vi.fn(async (): Promise<HistoryDetail> => ({
      item: { sessionId: 'gone-1', harness: 'claude', headless: false, title: 'rates', projectPath: ROOT, repo: 'acme-app', branch: null, lastActiveAt: null, snippet: null, firstPrompt: null, projectDisplay: null, blocked: 'folder-gone' },
      source: 'transcript',
      preview: 'latest',
      totalMessages: 2,
      entries: [you('Fix src/rates.ts'), agent('Done in `src/rates.ts`.')],
    }));
    renderApp('/h/claude/gone-1', { pastSession, checkPaths }).snapshot([]);
    const view = await screen.findByTestId('past-session');
    expect(await within(view).findByText('Fix src/rates.ts')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS * 3));
    expect(vscode(view)).toEqual([]);
    expect(checkPaths).not.toHaveBeenCalled();
  });
});

describe('tool calls', () => {
  it('VIEW-1.2: consecutive tool calls fold into one row naming the tools and counts', async () => {
    const user = userEvent.setup();
    const { reset } = open();
    reset([
      agent('Reading first.'),
      tool('Read', 'app/models/deal.rb'),
      tool('Grep', 'round\\('),
      tool('Read', 'app/services/rate_calculator.rb'),
      tool('Grep', 'total_with_rates'),
      tool('Read', 'spec/models/deal_spec.rb'),
      tool('Bash', 'bundle exec rspec spec/models/deal_spec.rb'),
      agent('Found it.'),
      tool('Edit', 'app/services/rate_calculator.rb'),
    ]);
    const fold = screen.getByRole('button', { name: '6 tool calls: Read ×3, Grep ×2, Bash' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('app/models/deal.rb')).toBeNull();

    await user.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    const lines = fold.parentElement!.querySelectorAll('ul li');
    expect([...lines].map((l) => l.textContent)).toEqual([
      'Readapp/models/deal.rb',
      'Grepround\\(',
      'Readapp/services/rate_calculator.rb',
      'Greptotal_with_rates',
      'Readspec/models/deal_spec.rb',
      'Bashbundle exec rspec spec/models/deal_spec.rb',
    ]);
    // A lone call is one line, nothing to expand.
    expect(screen.getByText('app/services/rate_calculator.rb', { selector: '[data-kind="tool_call"] *' })).toBeInTheDocument();
  });

  it('VIEW-1.2: a run split across pages folds as one; labels count and order tools', () => {
    const calls = [tool('Read', 'a'), tool('Read', 'b'), tool('Grep', 'x'), tool('Bash', 'ls'), tool('Grep', 'y'), tool('Read', 'c')];
    const items = chatItems([you('go'), ...calls, agent('done')]);
    expect(items.map((i) => i.type)).toEqual(['entry', 'tools', 'entry']);
    expect(toolsLabel(calls.filter((x) => x.kind === 'tool_call') as never)).toBe('6 tool calls: Read ×3, Grep ×2, Bash');
    expect(toolsLabel([calls[3]] as never)).toBe('1 tool call: Bash');
  });
});

describe('questions', () => {
  it('VIEW-1.9: a pending question shows its options and that it waits for you', () => {
    const { reset } = open();
    reset([question()]);
    const q = document.querySelector('[data-kind="question"]') as HTMLElement;
    expect(q).toHaveAttribute('data-status', 'pending');
    expect(q).toHaveTextContent('How should invoices that already exist be handled?');
    expect(q).toHaveTextContent('Invoices');
    expect(within(q).getAllByRole('listitem').map((li) => li.firstChild?.nextSibling?.firstChild?.textContent)).toEqual([
      'Leave them as they are',
      'Recalculate drafts only',
      'Recalculate all',
    ]);
    expect(q).toHaveTextContent('Sent invoices keep their amounts.');
    expect(q).toHaveTextContent('Waiting for your answer');
    expect(within(q).queryByRole('button')).toBeNull(); // answering is VIEW-4
  });

  it('VIEW-1.9: once answered, the answer you gave is marked; a typed answer and a declined one show too', () => {
    const { app, reset } = open();
    reset([question({ status: 'answered', answer: { answers: ['Recalculate drafts only'], picked: [[1]] } })]);
    let q = document.querySelector('[data-kind="question"]') as HTMLElement;
    expect(q).toHaveTextContent('Answered');
    expect([...q.querySelectorAll('[data-picked]')].map((e) => e.textContent)).toEqual(['Recalculate drafts onlySent invoices keep their amounts.']);
    expect(q.querySelector('[data-picked] [data-field="choice"] svg')).toHaveClass('lucide-circle-dot');

    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', before: null, queue: [], entries: [question({ status: 'answered', answer: { answers: ['Only the ones from October'], picked: [[]] } })] });
    q = document.querySelector('[data-kind="question"]') as HTMLElement;
    expect(q).toHaveTextContent('Answered: Only the ones from October');
    expect(q.querySelectorAll('[data-picked]')).toHaveLength(0);

    app.emit({ type: 'chat', sessionId: 'a', op: 'reset', before: null, queue: [], entries: [question({ status: 'declined', answer: { declined: true } })] });
    q = document.querySelector('[data-kind="question"]') as HTMLElement;
    expect(q).toHaveTextContent('Not answered');
    expect(q).toHaveTextContent('Dismissed without an answer.');
  });

  it('VIEW-1.9: a multi-select question marks its options with boxes, a single-select one with circles (decision 0008)', () => {
    const { reset } = open();
    const base = (question() as Extract<ChatEntry, { kind: 'question' }>).questions[0]!;
    reset([question({ status: 'answered', questions: [{ ...base, multiSelect: true }], answer: { answers: ['Leave them as they are, Recalculate all'], picked: [[0, 2]] } })]);
    let q = document.querySelector('[data-kind="question"]') as HTMLElement;
    const icons = () => [...q.querySelectorAll('[data-field="choice"] svg')].map((svg) => [...svg.classList].find((c) => c.startsWith('lucide-')));
    expect(icons()).toEqual(['lucide-square-check', 'lucide-square', 'lucide-square-check']);
    reset([question({ status: 'answered', answer: { answers: ['Recalculate all'], picked: [[2]] } })]);
    q = document.querySelector('[data-kind="question"]') as HTMLElement;
    expect(icons()).toEqual(['lucide-circle', 'lucide-circle', 'lucide-circle-dot']);
  });

  it('VIEW-1.9: options are marked by the indexes Fleet picked, even labels that contain ", "', () => {
    const q = {
      question: 'Which fixes?',
      header: '',
      multiSelect: true,
      options: [{ label: 'Fix A, then B', description: '' }, { label: 'C', description: '' }, { label: 'D', description: '' }],
    };
    expect(answerFor(q, { answers: ['Fix A, then B, C'], picked: [[0, 1]] }, 0)).toEqual({ picked: new Set([0, 1]), other: null });
    expect(answerFor(q, { answers: ['C, and the README'], picked: [[1]] }, 0)).toEqual({ picked: new Set([1]), other: 'C, and the README' });
    expect(answerFor(q, { answers: ['Something else'], picked: [[]] }, 0)).toEqual({ picked: new Set(), other: 'Something else' });
    // Without `picked` (an older Fleet), only an exact label marks an option; nothing is split.
    expect(answerFor(q, { answers: ['Fix A, then B'], picked: null }, 0)).toEqual({ picked: new Set([0]), other: null });
    expect(answerFor(q, { answers: ['Fix A, then B, C'], picked: null }, 0)).toEqual({ picked: new Set(), other: 'Fix A, then B, C' });
    expect(answerFor(q, { declined: true }, 0)).toEqual({ picked: new Set(), other: null });
  });

  it('VIEW-1.9: a question answered later flips from waiting to answered in place, live', () => {
    const { reset, append } = open();
    const asked = question();
    reset([you('Fix the invoices'), asked]);
    expect(document.querySelector('[data-kind="question"]')).toHaveTextContent('Waiting for your answer');
    const after = agent('Recalculating the drafts now.');
    append([after], [{ ...asked, status: 'answered', answer: { answers: ['Recalculate drafts only'], picked: [[1]] } } as ChatEntry]);
    const q = document.querySelector('[data-kind="question"]') as HTMLElement;
    expect(q).toHaveAttribute('data-status', 'answered');
    expect(q).not.toHaveTextContent('Waiting for your answer');
    expect([...q.querySelectorAll('[data-picked]')].map((e) => e.textContent)).toEqual(['Recalculate drafts onlySent invoices keep their amounts.']);
    expect(q.querySelector('[data-picked] [data-field="choice"] svg')).toHaveClass('lucide-circle-dot');
    expect(document.querySelectorAll('[data-kind="question"]')).toHaveLength(1);
    expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('Recalculating the drafts now.');
  });

  it('VIEW-1.1: a reply that grows is replaced in place, not repeated', () => {
    const { reset, append } = open();
    const reply = agent('First part.');
    reset([you('go'), reply]);
    append([], [{ ...reply, text: 'First part. And the rest.' } as ChatEntry]);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('First part. And the rest.');
  });
});

describe('loading, paging and problems', () => {
  it('shows a skeleton until the first entries arrive, then "No messages yet" for an empty Transcript', () => {
    const { reset } = open();
    expect(screen.getByLabelText('Loading the chat')).toBeInTheDocument();
    reset([]);
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  it('VIEW-1.6: the latest entries come first; "Show earlier" loads older ones above them until the start', async () => {
    const user = userEvent.setup();
    const older: ChatEntry[] = [you('first prompt'), agent('first reply')];
    const earlierMessages = vi.fn(async (): Promise<ChatPage> => ({ entries: older, before: null }));
    const { app, reset } = open('a', {}, { earlierMessages });
    reset([you('latest prompt'), agent('latest reply')], 'c-latest');
    await user.click(screen.getByRole('button', { name: 'Show earlier' }));
    expect(earlierMessages).toHaveBeenCalledWith('a', 'c-latest');
    await waitFor(() => expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('first prompt'));
    expect(screen.getAllByRole('listitem').map((li) => /(first|latest) (prompt|reply)/.exec(li.textContent ?? '')?.[0])).toEqual([
      'first prompt',
      'first reply',
      'latest prompt',
      'latest reply',
    ]);
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull(); // the start
    // New entries still arrive below.
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [agent('newest')], updated: [], queue: [] });
    expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('newest');
  });

  it('VIEW-1.6: a failed page says why and can be retried; a reset (rewritten Transcript) drops loaded pages', async () => {
    const user = userEvent.setup();
    let fail = true;
    const earlierMessages = vi.fn(async (): Promise<ChatPage> => {
      if (fail) throw new Error("This Session isn't running, so earlier messages can't be loaded.");
      return { entries: [you('old one')], before: 'c-older' };
    });
    const { reset } = open('a', {}, { earlierMessages });
    reset([agent('latest')], 'c-1');
    await user.click(screen.getByRole('button', { name: 'Show earlier' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("This Session isn't running");
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Show earlier' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')[1]).toHaveTextContent('old one'));
    expect(screen.getByRole('button', { name: 'Show earlier' })).toBeInTheDocument(); // more before it
    reset([agent('compacted')], null);
    expect(screen.queryByText('old one')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull();
  });

  it('VIEW-1.8: with no Transcript, the pane says so; the terminal preview and composer still work', async () => {
    const user = userEvent.setup();
    const { app } = open('a', { status: 'needs-you' });
    app.emit({ type: 'chat', sessionId: 'a', op: 'problem', problem: { kind: 'missing', message: 'no transcript found for session a' } });
    expect(screen.getByText('No Transcript found')).toBeInTheDocument();
    expect(screen.getByText('no transcript found for session a')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Terminal/ })).toHaveAttribute('aria-expanded', 'true');
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'hi{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', 'hi');
  });

  it('DS-4.2: a Transcript that is missing or can not be read is an error Alert (a box) at the top of the pane, not an empty state', () => {
    const { app } = open('a');
    app.emit({ type: 'chat', sessionId: 'a', op: 'problem', problem: { kind: 'missing', message: 'no transcript found for session a' } });
    let alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-layout', 'box');
    expect(alert).toHaveTextContent('No Transcript found');
    expect(alert).toHaveTextContent('no transcript found for session a');
    app.emit({ type: 'chat', sessionId: 'a', op: 'problem', problem: { kind: 'failed', message: 'Fleet took too long to read the Transcript.' } });
    alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-layout', 'box');
    expect(alert).toHaveTextContent("Couldn't read the Transcript");
    expect(alert).toHaveTextContent('Fleet took too long to read the Transcript. · retrying');
    expect(screen.getByTestId('chat').querySelector('[data-slot="empty-state"]')).toBeNull();
  });

  it('a read that fails later keeps the chat and says it is retrying; it clears once reads work again', () => {
    const { app, reset } = open();
    reset([agent('still here')]);
    app.emit({ type: 'chat', sessionId: 'a', op: 'problem', problem: { kind: 'failed', message: 'Fleet took too long to read the Transcript.' } });
    expect(screen.getByText('still here')).toBeInTheDocument();
    expect(messages().getByRole('status')).toHaveTextContent("Couldn't read new messages: Fleet took too long to read the Transcript. · retrying");
    app.emit({ type: 'chat', sessionId: 'a', op: 'problem', problem: null });
    expect(screen.queryByText(/retrying/)).toBeNull();
  });

  it('VIEW-1.4: entries arriving for another Session do not show here; repeats are ignored', () => {
    const { app, reset } = open();
    reset([agent('mine')]);
    app.emit({ type: 'chat', sessionId: 'other', op: 'reset', entries: [agent('not mine')], before: null, queue: [] });
    const dup = agent('once');
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [dup], updated: [], queue: [] });
    app.emit({ type: 'chat', sessionId: 'a', op: 'append', entries: [dup], updated: [], queue: [] });
    expect(screen.queryByText('not mine')).toBeNull();
    expect(screen.getAllByText('once')).toHaveLength(1);
  });

});

describe('read-only and ended Sessions', () => {
  it('an ended Session keeps its chat but offers no "Show earlier" (Fleet can no longer read it)', () => {
    const { app, reset } = open();
    reset([agent('latest')], 'c-1');
    expect(screen.getByRole('button', { name: 'Show earlier' })).toBeInTheDocument();
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull();
    expect(screen.getByText('latest')).toBeInTheDocument();
  });

  it('VIEW-5.2: a Session that is not Controllable shows its chat, read-only', () => {
    const { reset } = open('orca', { backend: 'unknown', controllable: false });
    reset([you('hello'), agent('hi')]);
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.getByText('View only: this Session runs in another app')).toBeInTheDocument();
  });

  it('VIEW-5.3: when the Session ends, its chat stays readable', () => {
    const { app, reset } = open();
    reset([you('hello'), agent('the last reply')]);
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(screen.getByText('the last reply')).toBeInTheDocument();
  });
});

describe('queued prompts (VIEW-3.3)', () => {
  it('a prompt sent while Busy shows once as queued below the history; once taken, it moves into the history once', async () => {
    const user = userEvent.setup();
    const { app, reset, append } = open('a', { status: 'busy' });
    reset([you('Fix the rounding'), agent('Working on it…')]);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Also add a KWD spec{Enter}');
    expect(app.client.sendMessage).toHaveBeenCalledWith('a', 'Also add a KWD spec');
    // Fleet's queue carries the enqueue line's time, at or after the send (VIEW-1.13 matches by it).
    const queued: ChatEntry = { kind: 'user', cursor: 'q1.0', ts: new Date().toISOString(), text: 'Also add a KWD spec', queued: true };
    append([], [], [queued]);
    append([], [], [queued]); // every response repeats the whole queue
    expect(document.querySelectorAll('[data-queued]')).toHaveLength(1);
    expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent(/queued/i);
    expect(screen.getAllByText('Also add a KWD spec')).toHaveLength(1);

    // The Harness takes it: Fleet stops listing it as queued and sends it as a normal prompt.
    append([you('Also add a KWD spec', { ts: new Date().toISOString() })], [], []);
    expect(document.querySelectorAll('[data-queued]')).toHaveLength(0);
    expect(screen.getAllByText('Also add a KWD spec')).toHaveLength(1);
    expect(screen.getAllByRole('listitem').at(-1)).not.toHaveTextContent(/queued/i);
  });

  it('a queued prompt is never a "Show earlier" cursor, and a reset brings the queue too', () => {
    const { reset } = open();
    reset([agent('latest')], 'c-1', [{ kind: 'user', cursor: 'q1.0', ts: null, text: 'waiting', queued: true }]);
    expect(document.querySelectorAll('[data-queued]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Show earlier' })).toBeInTheDocument();
  });
});

describe('chat state', () => {
  it('VIEW-1.5: past the cap, the oldest end is trimmed only while you are at the bottom; pages survive appends', () => {
    let chat = applyChatEvent(emptyChat, { type: 'chat', sessionId: 'a', op: 'reset', entries: [agent('start')], before: 'c-old', queue: [] });
    chat = setFollowing(chat, false);
    const epoch = chat.epoch;
    chat = applyChatEvent(chat, { type: 'chat', sessionId: 'a', op: 'append', entries: Array.from({ length: MAX_CHAT_ENTRIES + 5 }, (_, i) => agent(`m${i}`)), updated: [], queue: [] });
    expect(chat.entries).toHaveLength(MAX_CHAT_ENTRIES + 6); // scrolled up: nothing dropped
    expect(chat.epoch).toBe(epoch); // appends never invalidate a page in flight
    chat = applyPage(chat, 'c-old', epoch, { entries: [you('older')], before: null });
    expect(chat.entries[0]).toMatchObject({ text: 'older' });
    expect(chat.before).toBeNull();
    chat = setFollowing(chat, true); // back at the bottom: now trimmed
    expect(chat.entries).toHaveLength(MAX_CHAT_ENTRIES);
    expect(chat.before).toBe(chat.entries[0]!.cursor);
  });

  it('a page that lands after a reset is dropped', () => {
    let chat = applyChatEvent(emptyChat, { type: 'chat', sessionId: 'a', op: 'reset', entries: [agent('x')], before: 'c-1', queue: [] });
    const epoch = chat.epoch;
    chat = applyChatEvent(chat, { type: 'chat', sessionId: 'a', op: 'reset', entries: [agent('rewritten')], before: 'c-9', queue: [] });
    expect(applyPage(chat, 'c-1', epoch, { entries: [you('stale')], before: null })).toBe(chat);
  });

  it('keeps the chat in view plus 3 recent ones, those cut to their latest entries; updates for others are ignored', () => {
    let state = initialState;
    const many = Array.from({ length: CACHED_ENTRIES + 50 }, (_, i) => agent(`e${i}`));
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      state = reducer(state, { type: 'chat-view', sessionId: id });
      state = reducer(state, { type: 'event', event: { type: 'chat', sessionId: id, op: 'reset', entries: many, before: null, queue: [] } });
    }
    expect([...state.chats.keys()].sort()).toEqual(['b', 'c', 'd', 'e']);
    expect(state.chats.get('e')!.entries).toHaveLength(CACHED_ENTRIES + 50);
    expect(state.chats.get('b')!.entries).toHaveLength(CACHED_ENTRIES);
    expect(state.chats.get('b')!.before).toBe(state.chats.get('b')!.entries[0]!.cursor);
    const ignored = reducer(state, { type: 'event', event: { type: 'chat', sessionId: 'b', op: 'append', entries: [agent('late')], updated: [], queue: [] } });
    expect(ignored).toBe(state);
  });
});

describe('questions with previews, read-only (VIEW-10.6)', () => {
  /** A's question (Claude Code 2.1.312 capture, 2026-10-28, neutral text): three settings layouts, each with its mockup. */
  const SIDEBAR = [
    '┌──────────┬─────────────────────┐',
    '│ General  │ Settings / General  │',
    '│ Billing  │                     │',
    '│ Team     │ Name   [__________] │',
    '│ Security │ Email  [__________] │',
    '│          │                     │',
    '│          │      [Save changes] │',
    '└──────────┴─────────────────────┘',
  ].join('\n');
  const TABS = [
    '┌────────────────────────────────┐',
    '│ General | Billing | Team       │',
    '├────────────────────────────────┤',
    '│ Name   [__________]            │',
    '│ Email  [__________]            │',
    '│                                │',
    '│            [Save changes]      │',
    '└────────────────────────────────┘',
  ].join('\n');
  const layout = (over: Partial<Extract<ChatEntry, { kind: 'question' }>> = {}) =>
    question({
      id: 'toolu_layout',
      questions: [
        {
          question: 'Which layout should the settings page use?',
          header: 'Layout',
          multiSelect: false,
          options: [
            { label: 'Sidebar navigation with grouped sections (Recommended)', description: 'Left rail with sections', preview: SIDEBAR },
            { label: 'Top tabs', description: 'Horizontal tabs', preview: TABS },
            { label: 'Single scrolling page', description: 'All on one page' },
          ],
        },
      ],
      ...over,
    });
  const card = () => document.querySelector('[data-kind="question"]') as HTMLElement;
  const box = () => within(card()).getByRole('region', { name: /^Preview: / });
  const items = () => within(card()).getAllByRole('option');

  it('VIEW-10.6: an answered question shows the same box, read-only, on the picked option; pointer and keyboard move it, its options one tab stop with ↑/↓ between them', async () => {
    const user = userEvent.setup();
    const { reset } = open('a', { status: 'idle' });
    reset([layout({ status: 'answered', answer: { answers: ['Top tabs'], picked: [[1]] } })]);
    expect(card()).toHaveTextContent('Answered');
    expect(box()).toHaveAccessibleName('Preview: Top tabs');
    expect(box().textContent).toBe(TABS);
    // Read-only: no buttons, no field.
    expect(within(card()).queryAllByRole('button')).toEqual([]);
    expect(within(card()).queryByRole('textbox')).toBeNull();
    // One tab stop: the picked option.
    expect(items().map((li) => li.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
    await user.hover(items()[0]!);
    expect(box()).toHaveAccessibleName('Preview: Sidebar navigation with grouped sections (Recommended)');
    expect(box().textContent).toBe(SIDEBAR);
    await user.unhover(items()[0]!);
    expect(box()).toHaveAccessibleName('Preview: Top tabs');
    // Tab reaches the list once, on the pick; ↓ and ↑ move focus, and the box with it.
    for (let i = 0; i < 50 && !card().contains(document.activeElement); i++) await user.tab();
    expect(items()[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items()[2]).toHaveFocus();
    expect(box()).toHaveAccessibleName('Preview: Single scrolling page');
    expect(box()).toHaveTextContent(/^No preview$/);
    await user.keyboard('{ArrowDown}'); // the last stays the last
    expect(items()[2]).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(items()[0]).toHaveFocus();
    expect(box()).toHaveAccessibleName('Preview: Sidebar navigation with grouped sections (Recommended)');
    expect(items().map((li) => li.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    // ↑/↓ there move between options; they don't scroll the chat or switch Sessions.
    expect(window.location.pathname).toBe('/s/a');
    // The next Tab leaves the list (the box fits, so it's no tab stop); the box goes back to the pick.
    await user.tab();
    expect(items()).not.toContain(document.activeElement);
    expect(box()).toHaveAccessibleName('Preview: Top tabs');
  });

  it('VIEW-10.6: the options are a read-only listbox, the pick selected; their text is plain, never a link; ↑/↓ at the ends or with a modifier are left alone', async () => {
    const user = userEvent.setup();
    const { reset } = open('a', { status: 'idle' });
    const linked = layout({ status: 'answered', answer: { answers: ['Top tabs'], picked: [[1]] } }) as Extract<ChatEntry, { kind: 'question' }>;
    linked.questions[0]!.options[0]!.description = 'see https://example.com/spec and src/app/settings.ts:12';
    reset([linked]);
    const list = within(card()).getByRole('listbox', { name: 'Layout' });
    expect(list).toHaveAttribute('aria-readonly', 'true');
    expect(items().map((li) => li.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(within(list).queryAllByRole('link')).toEqual([]);
    expect(items()[0]).toHaveTextContent('see https://example.com/spec and src/app/settings.ts:12');
    await user.tab();
    while (!card().contains(document.activeElement)) await user.tab();
    expect(items()[1]).toHaveFocus();
    // Not at an end, unmodified: the list takes it (default prevented). At the end, or with a modifier: it doesn't.
    const press = (el: Element, init: KeyboardEventInit) => !fireEvent.keyDown(el, init) /* true when prevented */;
    expect(press(items()[1]!, { key: 'ArrowDown' })).toBe(true);
    expect(items()[2]).toHaveFocus();
    expect(press(items()[2]!, { key: 'ArrowDown' })).toBe(false);
    expect(items()[2]).toHaveFocus();
    expect(press(items()[2]!, { key: 'ArrowUp', altKey: true })).toBe(false);
    expect(press(items()[2]!, { key: 'ArrowUp', metaKey: true })).toBe(false);
    expect(press(items()[2]!, { key: 'ArrowUp', shiftKey: true })).toBe(false);
    expect(items()[2]).toHaveFocus();
    expect(press(items()[2]!, { key: 'ArrowUp' })).toBe(true);
    expect(items()[1]).toHaveFocus();
    expect(press(items()[0]!, { key: 'ArrowUp' })).toBe(false);
  });

  it('VIEW-10.6: moving from an option into the box keeps its preview, by pointer and by Tab, and the box stays focusable; it falls back only when the pointer and focus leave the area', async () => {
    const { resize } = fakeResizeObserver();
    const user = userEvent.setup();
    const { reset } = open('a', { status: 'idle' });
    reset([layout({ status: 'answered', answer: { answers: ['Top tabs'], picked: [[1]] } })]);
    // By pointer: from the first option across into the box.
    await user.hover(items()[0]!);
    expect(box()).toHaveAccessibleName('Preview: Sidebar navigation with grouped sections (Recommended)');
    movePointer(items()[0]!, box());
    expect(box()).toHaveAccessibleName('Preview: Sidebar navigation with grouped sections (Recommended)');
    await user.unhover(box());
    expect(box()).toHaveAccessibleName('Preview: Top tabs');
    // By Tab: an option, then the box, which scrolls so it takes the next Tab. Real sizes: only
    // Top tabs' preview and "No preview" (the third option) fit their box.
    const pre = box();
    sizeBoxByText(pre, [TABS, 'No preview']);
    resize(pre);
    expect(pre).not.toHaveAttribute('tabindex');
    act(() => items()[0]!.focus());
    expect(box()).toHaveAccessibleName('Preview: Sidebar navigation with grouped sections (Recommended)');
    expect(pre).toHaveAttribute('tabindex', '0');
    await user.tab();
    expect(pre).toHaveFocus();
    // Pointing at an option whose preview fits remeasures the box; it keeps the focus it has.
    await user.hover(items()[2]!);
    expect(box()).toHaveAccessibleName('Preview: Single scrolling page');
    expect(pre).toHaveAttribute('tabindex', '0');
    expect(pre).toHaveFocus();
    // Out of the area altogether: the pick again.
    await user.unhover(items()[2]!);
    await user.tab();
    expect(card().contains(document.activeElement)).toBe(false);
    expect(box()).toHaveAccessibleName('Preview: Top tabs');
  });

  it('VIEW-10.6: Space on an option of an answered question (a read-only listbox) is the chat scrolling, so it releases a jump’s hold', async () => {
    const { reset } = open();
    reset([you('Pick one'), layout({ status: 'answered', answer: { answers: ['Top tabs'], picked: [[1]] } })]);
    const chat = screen.getByTestId('chat');
    const holds = () => {
      fireEvent.scroll(chat);
      return !!screen.queryByRole('button', { name: /Jump to latest/ });
    };
    fireEvent.click(await screen.findByRole('button', { name: /^Your prompt/ }));
    expect(holds()).toBe(true);
    const item = within(card()).getAllByRole('option')[0]!;
    item.focus();
    fireEvent.keyDown(item, { key: ' ' });
    expect(holds()).toBe(false);
  });

  it('VIEW-10.6: a declined or abandoned question starts on the first option’s preview', () => {
    const { reset } = open('a', { status: 'idle' });
    reset([layout({ status: 'declined', answer: { declined: true } })]);
    expect(card()).toHaveTextContent('Not answered');
    expect(box()).toHaveAccessibleName('Preview: Sidebar navigation with grouped sections (Recommended)');
    expect(items().map((li) => li.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    reset([layout({ status: 'abandoned', answer: null })]);
    expect(box()).toHaveAccessibleName('Preview: Sidebar navigation with grouped sections (Recommended)');
  });

  it('VIEW-10.6: an ended Session’s chat, and a past Session’s, show it too', async () => {
    const { app, reset } = open('a', { status: 'idle' });
    reset([layout({ status: 'answered', answer: { answers: ['Top tabs'], picked: [[1]] } })]);
    app.emit({ type: 'sessions', upsert: [], remove: ['a'] });
    expect(screen.getByText('This Session ended')).toBeInTheDocument();
    expect(box()).toHaveAccessibleName('Preview: Top tabs');
    app.unmount();

    const pastSession = vi.fn(async (): Promise<HistoryDetail> => ({
      item: { sessionId: 'gone-1', harness: 'claude', headless: false, title: 'settings', projectPath: '/Users/me/Projects/settings-page', repo: null, branch: null, lastActiveAt: null, snippet: null, firstPrompt: null, projectDisplay: null, blocked: 'folder-gone' },
      source: 'transcript',
      preview: 'latest',
      totalMessages: 2,
      entries: [you('Sketch a few layouts for the settings page.'), layout({ status: 'answered', answer: { answers: ['Top tabs'], picked: [[1]] } })],
    }));
    renderApp('/h/claude/gone-1', { pastSession }).snapshot([]);
    const view = await screen.findByTestId('past-session');
    const past = await within(view).findByRole('region', { name: 'Preview: Top tabs' });
    expect(past.textContent).toBe(TABS);
  });

  it('VIEW-10.6: a question without previews keeps its read-only options out of the tab order', () => {
    const { reset } = open('a', { status: 'idle' });
    reset([question({ status: 'answered', answer: { answers: ['Recalculate all'], picked: [[2]] } })]);
    expect(within(card()).queryByRole('region', { name: /^Preview: / })).toBeNull();
    const rows = within(card()).getAllByRole('listitem');
    expect(rows.every((li) => !li.hasAttribute('tabindex'))).toBe(true);
    expect(within(card()).queryByRole('listbox')).toBeNull();
  });
});
