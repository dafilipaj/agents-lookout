import type { WorkPr, WorkSnapshot, WorkTask } from '@shared/work.ts';
import { describe, expect, it } from 'vitest';
import { row } from '@/test/helpers';
import { filterRow, fuzzyRanges, hiddenHit, rowFields, sessionWork } from './filter';

const git = (repo: string, worktree: string | null, branch: string | null) => ({ repo, worktree, branch, commonDir: `/Users/me/Projects/${repo}/.git`, defaultBranch: 'main' });
const ids = (m: ReturnType<typeof filterRow>) => m?.hits.map((h) => h.field.id) ?? null;

describe('SIDE-12 the filter', () => {
  it('SIDE-12.1: each word matches on its own, in any field and any order, case folded as Library folds it', () => {
    const r = row({ id: 'a', title: 'Fix the rounding', git: git('work', null, 'fix/rates') });
    expect(filterRow(r, 'rates fix')).not.toBeNull();
    expect(filterRow(r, 'work rates')).not.toBeNull();
    expect(filterRow(r, '  RATES   Work ')).not.toBeNull();
    expect(filterRow(r, 'rates invoices')).toBeNull();
    // ß folds to ss both ways, as LIB-2.4's folding does.
    expect(filterRow(row({ id: 'b', title: 'Straße plan' }), 'STRASSE')).not.toBeNull();
    // No query: every row matches, nothing marked.
    expect(filterRow(r, '   ')).toEqual({ hits: [], words: [] });
  });

  it('SIDE-12.2: the fields are the names (title, repo, Worktree, branch, Harness, model, Topics, Linked PR and Task) and the text (first prompt, what it waits for, what it is doing, its Done note)', () => {
    const r = row({
      id: 'a',
      title: 'Title words',
      harness: 'codex',
      model: 'gpt-5.5-codex',
      git: git('work', 'crm-rates', 'fix/rates'),
      firstPrompt: 'please look into the invoice export',
      waitingFor: 'permission: Bash(rspec spec/models)',
      activity: 'Edit: web/src/App.tsx',
      done: { at: 0, note: 'shipped the sitemap' },
    });
    const work = { pr: { number: 3719, title: 'Fix rates rounding' }, task: { title: 'Rates by service' } };
    expect(rowFields(r, ['Quarterly rates'], work).map((f) => [f.id, f.kind])).toEqual([
      ['title', 'name'],
      ['repo', 'name'],
      ['worktree', 'name'],
      ['branch', 'name'],
      ['harness', 'name'],
      ['model', 'name'],
      ['topic-0', 'name'],
      ['pr-number', 'name'],
      ['pr-title', 'name'],
      ['task', 'name'],
      ['first-prompt', 'text'],
      ['waiting-for', 'text'],
      ['activity', 'text'],
      ['done-note', 'text'],
    ]);
    const find = (q: string) => ids(filterRow(r, q, ['Quarterly rates'], work));
    expect(find('codex')).toEqual(['harness', 'model']);
    expect(find('quarterly')).toEqual(['topic-0']);
    expect(find('#3719')).toEqual(['pr-number']);
    expect(find('rounding')).toEqual(['pr-title']);
    expect(find('service')).toEqual(['task']);
    expect(find('invoice')).toEqual(['first-prompt']);
    expect(find('rspec')).toEqual(['waiting-for']);
    expect(find('App.tsx')).toEqual(['activity']);
    expect(find('sitemap')).toEqual(['done-note']);
    // Not the working directory (Key decisions).
    expect(filterRow(row({ id: 'b', cwd: '/Users/me/Projects/elsewhere', git: null }), 'elsewhere')).toBeNull();
  });

  it("SIDE-12.2: a Session's Linked PR and Task come from Work's list, not through another Link, the first in Work's order", () => {
    const link = (sessionId: string, reason: string) => ({ sessionId, harness: 'claude' as const, title: 't', createdAt: null, modifiedAt: null, live: true, reason: reason as 'started on this PR' });
    const pr = (number: number, sessions: ReturnType<typeof link>[]) => ({ number, title: `PR ${number}`, links: { tasks: [], sessions, incomplete: false } }) as unknown as WorkPr;
    const task = (title: string, sessions: ReturnType<typeof link>[]) => ({ title, links: { prs: [], sessions, incomplete: false } }) as unknown as WorkTask;
    const work = {
      prs: { mine: [pr(1, [link('a', 'started on this PR'), link('b', 'through PR #9')])], reviewRequests: [pr(2, [link('a', 'started on this PR'), link('c', 'started on this PR')])] },
      tasks: { tasks: [task('First task', [link('a', 'started on this Task')]), task('Second task', [link('a', 'started on this Task'), link('b', 'through PR #1')])] },
    } as unknown as WorkSnapshot;
    const by = sessionWork(work);
    expect(by.get('a')).toEqual({ pr: { number: 1, title: 'PR 1' }, task: { title: 'First task' } });
    expect(by.get('b')).toBeUndefined();
    expect(by.get('c')).toEqual({ pr: { number: 2, title: 'PR 2' } });
    expect(sessionWork(null).size).toBe(0);
  });

  it('SIDE-12.3: a word of 3 letters or more matches a name with its letters in order; text only where it contains the word', () => {
    const r = row({ id: 'a', title: 'Investigate', git: git('work', 'crm-rates', 'fix/rates'), firstPrompt: 'find the report totals for this sprint' });
    expect(ids(filterRow(r, 'frts'))).toEqual(['branch']);
    expect(ids(filterRow(r, 'crmrt'))).toEqual(['worktree']);
    // The prompt has f, r, t and s in order, but text is matched by substring only.
    expect(filterRow(row({ id: 'b', title: 'x', git: null, firstPrompt: 'find the report totals for this sprint' }), 'frts')).toBeNull();
    // Under 3 letters, a name too matches only where it contains the word.
    expect(filterRow(r, 'fs')).toBeNull();
    expect(filterRow(r, 'fi')).not.toBeNull();
  });

  it('SIDE-12.3: a fuzzy match marks the letters as close together as fzf v1 finds, over whole characters', () => {
    // The forward scan ends at the last s; the backward scan starts at the second f.
    expect(fuzzyRanges('fix/fast', 'fst')).toEqual([[4, 5], [6, 8]]);
    expect(fuzzyRanges('fix/rates', 'frts')).toEqual([[0, 1], [4, 5], [6, 7], [8, 9]]);
    expect(fuzzyRanges('fix/rates', 'xyz')).toEqual([]);
    // ß folds to two letters; a mark on either covers the one character.
    expect(fuzzyRanges('xaßyc', 'asc')).toEqual([[1, 3], [4, 5]]);
    // Code point against code point: halves of 😀 and 🪀 don't make a 🚀.
    expect(fuzzyRanges('😀🪀ab', '🚀ab')).toEqual([]);
    expect(fuzzyRanges('🚀😀🪀ab', '🚀ab')).toEqual([[0, 2], [6, 8]]);
  });

  it('SIDE-12.6: the hidden line names the first field, in SIDE-12.2\'s order, of a word that matched nothing the row shows', () => {
    const r = row({ id: 'a', title: 'Fix the rounding', model: 'claude-opus-5-5', git: git('work', null, 'main'), firstPrompt: 'look at the opus rates' });
    const m = filterRow(r, 'rounding opus');
    const shownTitle = (f: { id: string }) => f.id === 'title';
    expect(hiddenHit(m, shownTitle)?.field.id).toBe('model');
    // Every word matched the title: no line.
    expect(hiddenHit(filterRow(r, 'fix rounding'), shownTitle)).toBeNull();
    // A word that also matched the shown title needs no line, even when it matched a hidden field too.
    expect(hiddenHit(filterRow(r, 'the'), shownTitle)).toBeNull();
    expect(hiddenHit(null, shownTitle)).toBeNull();
    // The line keeps the hidden word's match in view, not a shown word's earlier in the same text.
    const prompt = `alpha ${'x'.repeat(200)} omega`;
    const hit = hiddenHit(filterRow(row({ id: 'b', title: 'alpha', git: null, firstPrompt: prompt }), 'alpha omega'), shownTitle);
    expect(hit?.field.id).toBe('first-prompt');
    expect(hit?.at).toBe(prompt.indexOf('omega'));
    expect(hit?.ranges).toEqual([[0, 5], [prompt.indexOf('omega'), prompt.length]]);
  });
});
