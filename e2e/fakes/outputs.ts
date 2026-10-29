import { execFile } from 'node:child_process';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { OutputDecl } from '../world/builder.ts';

/** Used only for the declared pre-events install-hint fake. Ordinary Worlds mine Transcripts. */
export interface TbSessionAnswer {
  results: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  unsupported?: boolean;
}
export function checkTbSession(answer: TbSessionAnswer): TbSessionAnswer {
  if (!Array.isArray(answer.results) || !Array.isArray(answer.sessions)) throw new Error('tb-session needs results and sessions arrays.');
  return structuredClone(answer);
}
export function checkOutputs(outputs: OutputDecl[]): OutputDecl[] {
  for (const o of outputs) {
    if (!['file', 'artifact', 'share'].includes(o.kind)) throw new Error('Unknown Output kind.');
    for (const p of [o.path, o.sourcePath, o.projectPath]) {
      if (p !== undefined && (isAbsolute(p) || p.split('/').includes('..') || /[\p{Cc}\p{Cf}~:]/u.test(p))) throw new Error('World Output paths must be plain paths relative to HOME.');
    }
    if (o.kind === 'file' && !o.path) throw new Error('A file Output needs its path.');
    for (const id of [o.sessionId, o.forkOf]) if (id && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(id)) throw new Error('Invalid Output Session id.');
    if (o.git && !o.path?.startsWith('Projects/')) throw new Error('World git Output paths must be under Projects/<repo>.');
  }
  return structuredClone(outputs);
}
export interface OutputFixtures {
  transcripts: string[];
  missingTranscripts: string[];
  prunedTranscripts: string[];
}
const execFileP = promisify(execFile);
/** Writes sanitized tool calls/results and their named files; tb-session alone mines facts. */
export async function materializeOutputs(home: string, declarations: OutputDecl[]): Promise<OutputFixtures> {
  checkOutputs(declarations);
  const transcripts = new Map<string, unknown[]>();
  const missing = new Set<string>(), pruned = new Set<string>(), gitRoots = new Set<string>();
  const absolute = (p: string) => { const out = join(home, p); if (relative(home, out).startsWith('..')) throw new Error('Output escaped World HOME.'); return out; };
  const write = async (p: string, contents: string) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, contents); };
  const git = (root: string, args: string[]) => execFileP('/usr/bin/git', ['-C', root, ...args], { env: { HOME: home, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' } });
  const at = '2026-10-23T10:00:00Z';
  const sessionTranscripts = new Map<string, string>();
  for (const [n, d] of declarations.entries()) {
    const id = d.sessionId ?? (d.projectPath && d.projectPath !== 'Projects/work' ? `library-writer-${d.projectPath.split('/').at(-1)}` : 'library-writer'), cwd = absolute(d.projectPath ?? 'Projects/work');
    await mkdir(cwd, { recursive: true });
    const path = d.path ? absolute(d.path) : undefined, sourcePath = d.sourcePath ? absolute(d.sourcePath) : undefined;
    const created = d.createdAt ?? d.updatedAt ?? at, updated = d.updatedAt ?? created;
    const title = d.title ?? `World Output ${n + 1}`;
    const url = d.url ?? (d.kind === 'artifact' ? `https://claude.ai/public/artifacts/world-page-${n}` : `https://backyard.productive.io/s/world-share-${n}`);
    const markdown = path?.toLowerCase().endsWith('.md');
    const contents = d.contents ?? (markdown ? `# ${title}\n\nA World report.\n` : `<!doctype html><title>${title}</title><p>A World report.</p>`);
    // A gone file retains its directory; directoryGone models a cleared scratchpad instead.
    if (path && d.kind === 'file') {
      await mkdir(dirname(path), { recursive: true });
      if (d.exists !== false) await write(path, contents);
    }
    if (d.git && path) {
      const root = absolute(d.path!.split('/').slice(0, 2).join('/'));
      if (!gitRoots.has(root)) { await mkdir(root, { recursive: true }); await git(root, ['init', '-q']); gitRoots.add(root); }
      if (d.git === 'ignored') await appendFile(join(root, '.gitignore'), `${relative(root, path)}\n`);
      else await git(root, ['add', '--', relative(root, path)]);
    }
    const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const parent = join(home, '.claude', 'projects', slug, `${id}.jsonl`);
    const transcript = d.subagent ? join(home, '.claude', 'projects', slug, id, 'subagents', `agent-world-${n}.jsonl`) : parent;
    sessionTranscripts.set(id, parent);
    const base = { sessionId: id, cwd, gitBranch: 'main', entrypoint: d.headless ? 'sdk-ts' : 'cli' };
    if (!transcripts.has(parent)) transcripts.set(parent, [
      { ...base, type: 'user', timestamp: d.sessionCreatedAt ?? created, message: { role: 'user', content: d.sessionTitle ?? 'World report writer' } },
      { ...base, type: 'assistant', timestamp: d.sessionCreatedAt ?? created, message: { role: 'assistant', content: d.sessionTitle ?? 'World report writer' } },
    ]);
    const lines = transcripts.get(transcript) ?? [{ ...base, type: 'user', timestamp: created, isSidechain: true, message: { role: 'user', content: 'Write a Subagent report' } }];
    const original = d.forkOf ? declarations.findIndex((o) => (o.sessionId ?? 'library-writer') === d.forkOf && o.kind === d.kind && o.path === d.path && o.sourcePath === d.sourcePath) : n;
    const toolId = d.toolUseId ?? `tool-world-${original < 0 ? n : original}`;
    const tool = d.kind === 'file' ? 'Write' : d.kind === 'artifact' ? 'Artifact' : 'Bash';
    const input = d.kind === 'file' ? { file_path: path, content: contents } : d.kind === 'artifact' ? { action: 'publish', file_path: sourcePath, title } : { command: `tb-backyard share upload${sourcePath ? ` '${sourcePath}'` : ''}${d.json === false ? '' : ' --json'}` };
    const shareText = d.json === false ? `Share created\nURL: ${url}\nTitle: ${title}\nVisibility: unlisted\nFiles:\n- report.html\n` : JSON.stringify({ title, url, visibility: 'unlisted', state: 'active', files: [] });
    const result = d.kind === 'file' ? { filePath: path } : d.kind === 'artifact' ? d.refused ? { is_error: true } : { artifact_id: `world-artifact-${n}`, url, file_path: sourcePath, title, version: d.version ?? 1, seq: n + 1 } : { stdout: shareText };
    const pair = (name: string, useId: string, toolInput: unknown, toolResult: unknown, timestamp: string) => [
      { ...base, type: 'assistant', timestamp, message: { role: 'assistant', content: [{ type: 'tool_use', id: useId, name, input: toolInput }] } },
      { ...base, type: 'user', timestamp, toolUseResult: toolResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: useId, is_error: !!d.refused, content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult) }] } },
    ];
    lines.push(...pair(tool, toolId, input, result, created));
    for (let e = 1; d.kind === 'file' && e < (d.events ?? 1); e++) lines.push(...pair('Edit', `${toolId}-edit-${e}`, { file_path: path, old_string: 'report', new_string: 'updated report' }, { filePath: path }, updated));
    transcripts.set(transcript, lines);
    if (d.transcriptMissing) missing.add(id);
    if (d.pruned) pruned.add(id);
  }
  for (const [path, lines] of transcripts) await write(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  for (const d of declarations) if (d.directoryGone && d.path) await rm(dirname(absolute(d.path)), { recursive: true, force: true });
  return {
    transcripts: [...transcripts.keys()],
    missingTranscripts: [...missing].map((id) => sessionTranscripts.get(id)!),
    prunedTranscripts: [...pruned].map((id) => sessionTranscripts.get(id)!),
  };
}
