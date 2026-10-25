import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { OutputDecl } from '../world/builder.ts';

/** A declared CLI answer, not an indexer. All identifiers and URLs here are invented fixtures. */
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
    if (o.sessionId && !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(o.sessionId)) throw new Error('Invalid Output Session id.');
  }
  return structuredClone(outputs);
}
/** Writes the named files and representative tool-result Transcript fixtures under this World only. */
export async function materializeOutputs(home: string, declarations: OutputDecl[], unsupported = false): Promise<TbSessionAnswer> {
  checkOutputs(declarations);
  const rows: Record<string, unknown>[] = [], sessions = new Map<string, Record<string, unknown>>();
  const transcripts = new Map<string, unknown[]>();
  const absolute = (p: string) => { const out = join(home, p); if (relative(home, out).startsWith('..')) throw new Error('Output escaped World HOME.'); return out; };
  const write = async (p: string, contents: string) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, contents); };
  const at = '2026-10-23T10:00:00Z';
  for (const [n, d] of declarations.entries()) {
    const id = d.sessionId ?? 'library-writer', cwd = absolute(d.projectPath ?? 'Projects/work');
    await mkdir(cwd, { recursive: true });
    const path = d.path ? absolute(d.path) : undefined, sourcePath = d.sourcePath ? absolute(d.sourcePath) : undefined;
    const created = d.createdAt ?? at, updated = d.updatedAt ?? created;
    const title = d.title ?? `World Output ${n + 1}`, event = d.kind === 'file' ? (d.events && d.events > 1 ? 'edit' : 'write') : d.kind === 'artifact' ? 'publish' : 'upload';
    const url = d.url ?? (d.kind === 'artifact' ? `https://claude.ai/public/artifacts/world-page-${n}` : `https://backyard.productive.io/s/world-share-${n}`);
    const type = d.type ?? (path?.endsWith('.md') ? 'markdown' : path?.endsWith('.pdf') ? 'pdf' : path && /\.(png|jpe?g|gif|svg|webp)$/i.test(path) ? 'image' : 'html');
    const entry = { harness: 'claude', session_id: id, last_at: updated, title: d.sessionTitle ?? 'World report writer', project_path: cwd, headless: d.headless ?? false, transcript_missing: d.transcriptMissing ?? false, events: d.events ?? 1, event, pruned: d.pruned ?? false };
    const session = { ...entry, summary: entry.title, first_prompt: entry.title, created_at: created, modified_at: updated, git_branch: 'main', message_count: 2 };
    if (!d.pruned) sessions.set(id, session);
    const contents = d.contents ?? (type === 'markdown' ? `# ${title}\n\nA World report.\n` : `<!doctype html><title>${title}</title><p>A World report.</p>`);
    if (path && d.exists !== false && d.kind === 'file') await write(path, contents);
    const slug = cwd.replace(/[^a-zA-Z0-9]/g, '-');
    const transcript = join(home, '.claude', 'projects', slug, d.subagent ? `${id}/subagents/agent-world-${n}.jsonl` : `${id}.jsonl`);
    const lines = transcripts.get(transcript) ?? [];
    const toolId = `tool-world-${n}`;
    const tool = d.kind === 'file' ? 'Write' : d.kind === 'artifact' ? 'mcp__claude_ai_Artifact__publish' : 'Bash';
    const input = d.kind === 'file' ? { file_path: path, content: contents } : d.kind === 'artifact' ? { file_path: sourcePath, title } : { command: `tb-backyard share upload ${sourcePath ?? 'report.html'}${d.json === false ? '' : ' --json'}` };
    const result = d.kind === 'file' ? { filePath: path } : d.kind === 'artifact' ? d.refused ? { is_error: true } : { artifact_id: `world-artifact-${n}`, url, file_path: sourcePath, title, version: 1 } : d.json === false ? `Uploaded ${title}\n${url}` : JSON.stringify({ title, url, visibility: 'unlisted', state: 'active' });
    lines.push({ type: 'user', sessionId: id, cwd, timestamp: created, message: { role: 'user', content: entry.title } }, { type: 'assistant', sessionId: id, cwd, timestamp: created, message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: tool, input }] } }, { type: 'user', sessionId: id, cwd, timestamp: created, toolUseResult: result, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, is_error: !!d.refused, content: JSON.stringify(result) }] } });
    if (d.kind === 'file' && (d.events ?? 1) > 1) {
      lines.push({ type: 'assistant', sessionId: id, cwd, timestamp: updated, message: { role: 'assistant', content: [{ type: 'tool_use', id: `${toolId}-edit`, name: 'Edit', input: { file_path: path, old_string: 'report', new_string: 'updated report' } }] } }, { type: 'user', sessionId: id, cwd, timestamp: updated, toolUseResult: { filePath: path }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `${toolId}-edit`, content: 'Edited' }] } });
    }
    if (!d.transcriptMissing && !d.pruned) transcripts.set(transcript, lines);
    if (d.refused) continue;
    rows.push({ kind: d.kind, key: d.kind === 'file' ? path : d.kind === 'artifact' ? url : `world-share-${n}`, ...(d.kind === 'file' ? { path, type } : { url, source_path: sourcePath }), title, harness: 'claude', session_id: id, project_path: cwd, git_branch: 'main', headless: d.headless ?? false, created_at: created, updated_at: updated, events: d.events ?? 1, sessions: [d.pruned ? { harness: 'claude', session_id: id, last_at: updated, events: d.events ?? 1, event, pruned: true } : entry] });
  }
  for (const r of rows.filter((r) => r.kind === 'artifact')) {
    const source = rows.find((s) => s.kind === 'file' && s.path === r.source_path);
    if (source) {
      r.source = { path: source.path, type: source.type, created_at: source.created_at, updated_at: source.updated_at, events: source.events };
      const combined = [...r.sessions as Record<string, unknown>[], ...source.sessions as Record<string, unknown>[]].sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
      const seen = new Set<unknown>();
      r.sessions = combined.filter((s) => { if (seen.has(s.session_id)) return false; seen.add(s.session_id); return true; });
    }
  }
  for (const [path, lines] of transcripts) await write(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return { results: rows.filter((r) => !(r.kind === 'file' && rows.some((a) => a.kind === 'artifact' && a.source_path === r.path))), sessions: [...sessions.values()], unsupported };
}
