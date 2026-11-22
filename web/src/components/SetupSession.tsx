import type { SessionInstruction, SessionMemoryEntry, SessionRan, SessionSetup } from '@shared/setup.ts';
import { ArrowRight, Bookmark, CircleOff, CornerDownRight, FileText, FolderGit2, User } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Chip } from '@/components/ui/chip';
import { SectionLabel } from '@/components/ui/details';
import { RowActions } from '@/components/ui/row-actions';
import { RowDetails, RowTitle } from '@/components/ui/row-details';
import { clock } from '@/lib/evidence';
import { SESSION_GROUP, type SessionGroup, type SessionRow, type SessionSection, changedSummary, domId, everywhereLine, fileMeta, notLoadedWhy, ranCount, ranMeta, repoMeta, stateOf, tipOf, tokensWord } from '@/lib/setup';
import { cn } from '@/lib/utils';
import { Hit, SetupRow, Summary } from './SetupRow';

/**
 * SETUP-6 to SETUP-9: This Session, the selected Session's story in order: the instruction files
 * it loaded and their imports, its memory, what ran in it by kind, then what its repo adds; the
 * rest it loaded in one line that switches to Everywhere (canvas A).
 */

const GROUP_ICON = { yours: User, repo: FolderGit2, memory: Bookmark } as const;
/** SETUP-6.3: the closing line's key among the list's options. */
export const EVERYWHERE_LINE = 'session:everywhere';
/**
 * DS-17.1: a row's padding, and where its hairline starts, where its name does: under its group's
 * name, 16 px further for an import (SETUP-7.2), or not inset with no icon (Ran, SETUP-8.1).
 */
const INDENT = {
  group: { className: 'pl-7', style: { '--row-inset': '48px' } as CSSProperties },
  import: { className: 'pl-11', style: { '--row-inset': '64px' } as CSSProperties },
  deep: { className: 'pl-15', style: { '--row-inset': '80px' } as CSSProperties },
  flat: { className: 'pl-2', style: { '--row-inset': '8px' } as CSSProperties },
} as const;
type Indent = keyof typeof INDENT;

export interface SetupSessionProps {
  data: SessionSetup;
  sections: SessionSection[];
  query: string;
  active: string | null;
  expanded: string | null;
  isOpen(key: string): boolean;
  groupLine(key: string, body: ReactNode, label: string): ReactNode;
  onPress(key: string, e: { detail: number }): void;
  onOpenFile(file: string, line: number | null): void;
  onEverywhere(): void;
}

export function SetupSession({ data, sections, query, active, expanded, isOpen, groupLine, onPress, onOpenFile, onEverywhere }: SetupSessionProps) {
  const transcriptErrors = data.errors.filter((e) => e.where === 'transcript');
  const row = (r: SessionRow) => {
    const common = { query, active: active === r.key, expanded: expanded === r.key, onPress: (e: { detail: number }) => onPress(r.key, e) };
    switch (r.type) {
      case 'file':
        return <FileRow key={r.key} rowKey={r.key} file={r.file} depth={r.depth} importer={data.instructions.find((f) => f.key === r.file.importer) ?? null} onOpen={() => onOpenFile(r.file.path, null)} {...common} />;
      case 'memory':
        return <MemoryRow key={r.key} rowKey={r.key} entry={r.entry} onOpen={() => onOpenFile(r.entry.file, null)} {...common} />;
      case 'ran':
        return <RanRow key={r.key} rowKey={r.key} ran={r.ran} onOpen={() => r.ran.item && onOpenFile(r.ran.item.file, r.ran.item.line)} {...common} />;
      case 'item':
        return (
          <SetupRow
            key={r.key}
            rowKey={r.key}
            item={r.item}
            busy={false}
            flat
            meta={r.why ? `${repoMeta(r.item, data.directory).split(' · ')[0]} · ${notLoadedWhy(r.why)}` : repoMeta(r.item, data.directory)}
            onOpen={() => onOpenFile(r.item.file, r.item.line)}
            {...common}
          />
        );
    }
  };
  const group = (g: SessionGroup) => {
    const Icon = GROUP_ICON[g.icon];
    return (
      <div key={g.key} role="presentation" className="flex flex-col">
        {groupLine(
          g.key,
          <>
            <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{g.label}</span>
            <span className="shrink-0 font-normal text-muted-foreground tabular-nums">{g.rows.length}</span>
          </>,
          `${g.label}, ${g.rows.length}`,
        )}
        {isOpen(g.key) && (
          <div role="presentation" className="flex flex-col" data-field="group-rows" data-group={g.key}>
            {g.rows.map(row)}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {transcriptErrors.map((e) => (
        <Alert key={e.file} layout="inline" title={`Couldn’t read ${e.file}: ${e.error}`} className="mx-2 my-2" data-field="setup-error" />
      ))}
      {sections.map((s) => {
        const labelId = `setup-session-${s.id}`;
        return (
          <div key={s.id} role="group" aria-labelledby={labelId} data-section={s.id} className="flex flex-col">
            <div role="presentation" className="px-2 pt-3 pb-1">
              <SectionLabel as="p" note={s.note}>
                <span id={labelId}>{s.label}</span>
              </SectionLabel>
            </div>
            {s.id === 'repo' &&
              data.errors
                .filter((e) => e.where === 'repo')
                .map((e) => <Alert key={e.file} layout="inline" title={`Couldn’t read ${e.file}: ${e.error}`} className="mx-2 my-1" data-field="setup-error" />)}
            {s.groups.map(group)}
            {s.kinds.map((k) => (
              <div key={k.kind} role="presentation" className="flex flex-col" data-ran={k.kind}>
                {/* SETUP-8.1: a quiet kind label, a group in a list (GUIDE, A section heading). */}
                <p role="presentation" className="flex items-baseline gap-1.5 px-2 pt-2 pb-0.5 text-caption font-medium text-muted-foreground" data-field="ran-kind">
                  <span>{k.label}</span>
                  <span className="font-normal tabular-nums">{k.rows.length}</span>
                </p>
                {k.rows.map(row)}
              </div>
            ))}
            {s.rows.map(row)}
            {s.notLoaded.length > 0 && (
              <>
                {groupLine(
                  SESSION_GROUP.notLoaded,
                  <>
                    <CircleOff aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{s.notLoaded.length} not loaded</span>
                  </>,
                  `${s.notLoaded.length} not loaded`,
                )}
                {isOpen(SESSION_GROUP.notLoaded) && (
                  <div role="presentation" className="flex flex-col opacity-60" data-field="not-loaded-rows">
                    {s.notLoaded.map(row)}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      {/* SETUP-6.3: what else it loaded, in one line that switches to Everywhere; an option, so j/k reach it and Enter runs it. */}
      {!query.trim() && !transcriptErrors.length && (
        <div
          id={domId(EVERYWHERE_LINE)}
          role="option"
          aria-selected={active === EVERYWHERE_LINE}
          aria-label={`${everywhereLine(data.everywhere)}, show Everywhere`}
          onClick={onEverywhere}
          className={cn('mt-2 flex min-w-0 cursor-default items-center gap-1.5 rounded-md px-2 py-[7px] text-meta text-muted-foreground hover:bg-sidebar-accent/60', active === EVERYWHERE_LINE && 'bg-sidebar-accent')}
          data-field="everywhere-line"
        >
          <span className="min-w-0 flex-1">{everywhereLine(data.everywhere)}</span>
          <ArrowRight aria-hidden className="size-3.5 shrink-0" />
        </div>
      )}
    </>
  );
}

interface LineProps {
  rowKey: string;
  query: string;
  active: boolean;
  expanded: boolean;
  onPress(e: { detail: number }): void;
}

/** A This Session row: one line, its icon, its name, its `meta`, and something at the right; expanded, its details. */
function Line({ rowKey, active, expanded, onPress, icon, name, meta, right, label, details, indent, field }: Omit<LineProps, 'query'> & { icon?: ReactNode; name: ReactNode; meta: ReactNode; right?: ReactNode; label: string; details: ReactNode; indent: Indent; field: string }) {
  const id = domId(rowKey);
  const at = INDENT[indent];
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-expanded={expanded}
      aria-label={label}
      aria-describedby={expanded ? `${id}-details-state ${id}-details` : undefined}
      onClick={onPress}
      data-slot="row"
      data-selected={active || undefined}
      data-field={field}
      style={at.style}
      className={cn('flex min-w-0 cursor-default flex-col gap-0.5 rounded-md py-[7px] pr-2 text-body hover:bg-sidebar-accent/60', at.className, active && 'bg-sidebar-accent')}
    >
      <div className={cn('flex min-w-0 gap-1.5', expanded ? 'items-start' : 'items-center')}>
        {icon && <span className="flex h-5 shrink-0 items-center text-muted-foreground">{icon}</span>}
        <RowTitle expanded={expanded} className={cn('font-medium', expanded ? 'flex-1' : 'max-w-[56%] shrink-0')}>
          {name}
        </RowTitle>
        {!expanded && (
          <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" data-field="description">
            {meta}
          </span>
        )}
        {right}
      </div>
      {expanded && <div className={cn(icon && 'pl-5')}>{details}</div>}
    </div>
  );
}

const openAction = (onOpen: () => void, enabled = true, tip = 'Open in VS Code (Enter)') => ({ 'data-action': 'open-vscode', action: 'open-vscode' as const, tip, enabled, onPress: onOpen });

/** SETUP-7.1 to 7.4: an instruction file: its path, its lines and tokens, its imports, changed or gone. */
function FileRow({ file: f, depth, importer, onOpen, query, ...rest }: LineProps & { file: SessionInstruction; depth: number; importer: SessionInstruction | null; onOpen(): void }) {
  const id = domId(rest.rowKey);
  const chip = f.disk === 'changed' ? <Chip tone="warning">changed</Chip> : f.disk === 'gone' ? <Chip tone="muted">gone</Chip> : null;
  const Icon = depth > 0 ? CornerDownRight : FileText;
  return (
    <Line
      {...rest}
      field="file"
      indent={depth === 0 ? 'group' : depth === 1 ? 'import' : 'deep'}
      icon={<Icon aria-hidden className="size-3.5" />}
      name={<Hit text={f.shown} query={query} />}
      meta={fileMeta(f)}
      right={chip && <span className="ml-auto flex shrink-0 items-center">{chip}</span>}
      label={[f.shown, fileMeta(f), f.disk !== 'same' && f.disk].filter(Boolean).join(', ')}
      details={
        <RowDetails
          id={`${id}-details`}
          // Its size first and whole; the source, which its group line names too, last, so it's what a narrow sidebar cuts.
          state={[
            <span key="lines" className="shrink-0">{`${f.lines} ${f.lines === 1 ? 'line' : 'lines'}`}</span>,
            <span key="tokens" className="shrink-0">{tokensWord(f.tokens)}</span>,
            f.later ? `loaded at ${clock(f.loadedAt)}` : null,
            importer ? `imported by ${importer.shown}` : null,
            f.group === 'yours' ? 'Yours' : 'This repo',
          ]}
          stateTip={f.path}
          summary={f.disk === 'changed' && changedSummary(f) ? <p data-field="changed">{changedSummary(f)}</p> : null}
          links={[]}
          actions={<RowActions name={f.shown} primary={openAction(onOpen, f.disk !== 'gone', f.disk === 'gone' ? 'It’s no longer on disk' : undefined)} more={[]} />}
        />
      }
    />
  );
}

/** SETUP-7.5: a memory entry: its title, its type; it opens its file. */
function MemoryRow({ entry, onOpen, query, ...rest }: LineProps & { entry: SessionMemoryEntry; onOpen(): void }) {
  const id = domId(rest.rowKey);
  return (
    <Line
      {...rest}
      field="memory"
      indent="group"
      icon={<FileText aria-hidden className="size-3.5" />}
      name={<Hit text={entry.title} query={query} />}
      meta={entry.type ?? ''}
      label={[entry.title, entry.type].filter(Boolean).join(', ')}
      details={<RowDetails id={`${id}-details`} state={[entry.type ?? 'no type', 'Memory']} stateTip={entry.file} links={[]} actions={<RowActions name={entry.title} primary={openAction(onOpen)} more={[]} />} />}
    />
  );
}

/** SETUP-8: one thing that ran: its name, its source (a hook's events and failed runs), its count at the right. */
function RanRow({ ran: r, onOpen, query, ...rest }: LineProps & { ran: SessionRan; onOpen(): void }) {
  const id = domId(rest.rowKey);
  const item = r.item;
  return (
    <Line
      {...rest}
      field="ran"
      indent="flat"
      name={<Hit text={r.name} query={query} />}
      meta={ranMeta(r)}
      right={<span className="ml-auto shrink-0 text-meta text-muted-foreground tabular-nums" data-field="count">{ranCount(r)}</span>}
      label={[r.name, ranMeta(r), ranCount(r)].join(', ')}
      details={
        item ? (
          // SETUP-8.2: as the item's own row expands (SETUP-3), its count first.
          <RowDetails id={`${id}-details`} state={[ranCount(r), ...stateOf(item)]} stateTip={tipOf(item)} summary={<Summary item={item} query={query} />} links={[]} actions={<RowActions name={r.name} primary={openAction(onOpen)} more={[]} />} />
        ) : (
          <RowDetails id={`${id}-details`} state={[ranCount(r), r.builtIn ? 'Built into Claude Code' : (r.origin ?? 'Not in Setup'), ...(r.kind === 'hook' && r.events.length ? [r.events.join(', ')] : [])]} links={[]} actions={null} />
        )
      }
    />
  );
}
