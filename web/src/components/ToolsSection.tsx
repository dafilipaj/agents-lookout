import { TOOLS, TOOL_IDS, type ToolRow, type ToolsSnapshot } from '@shared/tools.ts';
import { CircleArrowUp, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CommandBlock } from '@/components/ui/command-block';
import { formatAgeAgo } from '@/lib/usage';
import { cn } from '@/lib/utils';

/** TOOLS-3.4: said once, at the top of the section. */
export const NEVER_RUNS = 'These are the CLIs Lookout runs. Lookout never installs or updates them; copy a command and run it.';

interface Props {
  /** The server's last read, or null before it sent one. */
  tools: ToolsSnapshot | null;
  now: number;
  /** TOOLS-1.4: the page opened: the server reads when its last read is a minute old. */
  load(): Promise<unknown>;
  /** TOOLS-1.4: Refresh: the server reads now. */
  refresh(): Promise<unknown>;
}

/** Before the server's first read lands: every Tool, "checking…" (UX, Loading). */
const CHECKING: ToolRow[] = TOOL_IDS.map((id) => ({
  id,
  purpose: TOOLS[id].purpose,
  path: null,
  via: null,
  version: null,
  number: null,
  revision: null,
  pin: null,
  needs: [...TOOLS[id].needs],
  state: 'unknown',
  reason: '',
  fix: null,
  checkedAt: null,
}));

/**
 * TOOLS-1: Settings › Tools, every Tool Lookout runs: what it's for, where it was found, its
 * version and its state. `missing` and `behind` are error Alerts, `update-available` and
 * `newer-than-known` info ones (TOOLS-4.2), `ok` plain text; a fix is a command to copy (TOOLS-3.4).
 */
export function ToolsSection({ tools, now, load, refresh }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Read once per opening of the page (TOOLS-1.4), whatever the parent passes on later renders.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Checking the Tools failed.'));
  }, []);

  const press = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checking the Tools failed.');
    } finally {
      setRefreshing(false);
    }
  };

  const rows = tools?.rows.length ? tools.rows : CHECKING;
  const reading = refreshing || tools?.reading === true;
  const checked = reading ? 'Checking…' : tools?.checkedAt ? `Checked ${formatAgeAgo(tools.checkedAt, now)}` : 'Not checked yet';

  return (
    <section aria-labelledby="tools-title" className="mt-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 id="tools-title" className="text-body font-medium">
          Tools
        </h2>
        <span className="ml-auto text-meta text-muted-foreground" data-field="checked">
          {checked}
        </span>
        <Button type="button" size="sm" variant="outline" className="h-7" disabled={reading} onClick={() => void press()}>
          <RefreshCw className={cn(reading && 'motion-safe:animate-spin')} /> Refresh
        </Button>
      </div>
      <p className="mt-1 text-meta text-muted-foreground" data-field="never-runs">
        {NEVER_RUNS}
      </p>
      {error && <Alert layout="inline" title={error} className="mt-2" />}
      <ul aria-label="Tools" className="mt-3 flex flex-col divide-y divide-border rounded-md border border-border">
        {rows.map((row) => (
          <ToolItem key={row.id} row={row} />
        ))}
      </ul>
    </section>
  );
}

/** The Version column: "checking…" until the first read lands, Fleet with its revision. */
function versionText(row: ToolRow): string {
  if (row.checkedAt === null) return 'checking…';
  if (row.number) return row.revision ? `${row.number} @ ${row.revision}` : row.number;
  return row.version ?? '—';
}

function ToolItem({ row }: { row: ToolRow }) {
  return (
    <li data-tool={row.id} data-state={row.checkedAt === null ? 'checking' : row.state} className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 font-mono text-body font-medium">{row.id}</span>
        <span className="min-w-0 flex-1 truncate text-meta text-muted-foreground" data-field="purpose" title={row.purpose}>
          {row.purpose}
        </span>
        <span className="shrink-0 font-mono text-meta" data-field="version" title={row.version ?? undefined}>
          {versionText(row)}
        </span>
      </div>
      <p className="min-w-0 truncate font-mono text-caption text-muted-foreground" data-field="path" title={row.path ?? undefined}>
        {row.path ?? '—'}
        {row.via && ` (${row.via})`}
      </p>
      {row.checkedAt !== null && <ToolStateView row={row} />}
    </li>
  );
}

/** TOOLS-4.2: the state's tone; the reason, and the fix to copy. */
function ToolStateView({ row }: { row: ToolRow }) {
  const fix = row.fix && <CommandBlock>{row.fix}</CommandBlock>;
  // TOOLS-2.2: Fleet's pin beside a revision that can't be read; `ok` and `behind` name it in their reason.
  const pinned = row.pin ? ` · pinned ${row.pin}` : '';
  switch (row.state) {
    case 'missing':
    case 'behind':
      return (
        <Alert title={`${row.id} is ${row.state}`} detail={row.reason}>
          {fix}
        </Alert>
      );
    case 'update-available':
      return (
        <Alert tone="info" icon={CircleArrowUp} title="An update is available" detail={row.reason}>
          {fix}
        </Alert>
      );
    case 'newer-than-known':
      return <Alert tone="info" title={`Newer than Fleet knows (${TOOLS[row.id].checkedUpTo ?? '?'})`} detail={row.reason} />;
    case 'ok':
      return (
        <p className="text-meta text-muted-foreground" data-field="state">
          ok
          {row.reason && ` · ${row.reason}`}
        </p>
      );
    case 'unknown':
      return (
        <div className="flex flex-col gap-1.5">
          <p className="text-meta text-muted-foreground" data-field="state">
            unknown{pinned}
            {row.reason && ` · ${row.reason}`}
          </p>
          {fix}
        </div>
      );
  }
}
