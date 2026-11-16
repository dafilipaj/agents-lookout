import { Coffee } from 'lucide-react';
import { useRef, useState } from 'react';
import { AMPHETAMINE_BUSY, AWAKE_OFF, type AwakeMode, type AwakeSnapshot } from '@shared/awake.ts';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { FOOTER_LINE, FOOTER_LINE_TRIGGER } from '@/components/ui/footer-line';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { IconButton } from '@/components/ui/icon-button';
import { Loading } from '@/components/ui/loading';
import { AWAKE_ITEMS, cornerText, cornerTip } from '@/lib/awake';
import { SaveError } from '@/lib/client';
import { formatAge } from '@/lib/time';
import { cn } from '@/lib/utils';

export interface KeepAwakeProps {
  awake: AwakeSnapshot | null;
  now: number;
  /** AWAKE-1.1: resolves with the server's answer, or rejects with why (a SaveError). */
  onSet(mode: AwakeMode, replace?: boolean): Promise<AwakeSnapshot>;
}

/**
 * AWAKE-4.1: the closed right sidebar's rail ends in a 28 px line, level with the Memory line,
 * holding the switch as a `Coffee` icon button, pressed while keep-awake is on.
 */
export function KeepAwakeRail(props: KeepAwakeProps) {
  const on = (props.awake?.mode ?? 'off') !== 'off';
  return (
    <div data-slot="keep-awake" className={cn('mt-auto justify-center', FOOTER_LINE)}>
      <KeepAwakeMenu {...props}>
        <IconButton
          size="sm"
          label={cornerTip(props.awake, props.now).split('\n')[0]!}
          tip={cornerTip(props.awake, props.now)}
          aria-pressed={on}
          data-field="keep-awake-button"
          className={cn(on ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground')}
        >
          <Coffee />
        </IconButton>
      </KeepAwakeMenu>
    </div>
  );
}

/**
 * AWAKE-4.2: under the open right sidebar's panels, a 28 px line drawn like the Memory line:
 * `Coffee` and the state in words.
 */
export function KeepAwakeFooter(props: KeepAwakeProps) {
  const on = (props.awake?.mode ?? 'off') !== 'off';
  const tip = cornerTip(props.awake, props.now);
  return (
    <div data-slot="keep-awake" className="flex shrink-0">
      <KeepAwakeMenu {...props} line={{ label: tip.split('\n')[0]!, tip }}>
        <span className={cn('flex min-w-0 items-center gap-1.5', on ? 'text-foreground' : 'text-muted-foreground')}>
          <Coffee aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate" data-field="keep-awake-text">
            {cornerText(props.awake, props.now)}
          </span>
        </span>
      </KeepAwakeMenu>
    </div>
  );
}

/**
 * AWAKE-4.3, 4.4: the menu both open: Off, Awake and Lid closed, each with its line, the mode the
 * server holds checked, Lid closed disabled with its reason while unavailable; the last note under
 * them. A pick shows the server's answer, not the pick; `amphetamine-busy` asks first (AWAKE-3.2).
 */
function KeepAwakeMenu({ awake, now, onSet, line, children }: KeepAwakeProps & { line?: { label: string; tip: string }; children: React.ReactNode }) {
  const a = awake ?? AWAKE_OFF;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AwakeMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** AWAKE-3.2: the dialog takes focus; the closing menu mustn't hand it back to its button. */
  const askingRef = useRef(false);

  const pick = async (mode: AwakeMode, replace = false) => {
    if (pending) return;
    setPending(mode);
    setError(null);
    try {
      await onSet(mode, replace);
      setOpen(false);
      askingRef.current = false;
      setAsking(false);
    } catch (err) {
      if (err instanceof SaveError && err.kind === AMPHETAMINE_BUSY) {
        askingRef.current = true;
        setOpen(false);
        setAsking(true);
      } else {
        askingRef.current = false;
        setAsking(false);
        setError(err instanceof Error ? err.message : "Couldn't change keep-awake.");
        setOpen(true);
      }
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <DropdownMenu
        modal={false}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setError(null);
        }}
      >
        <DropdownMenuTrigger
          asChild={!line}
          ref={triggerRef}
          {...(line
            ? {
                'data-field': 'keep-awake-line',
                'aria-label': line.label,
                title: line.tip,
                className: cn(FOOTER_LINE_TRIGGER, 'min-w-0 data-[state=open]:bg-sidebar-accent/60'),
              }
            : {})}
        >
          {children}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          collisionPadding={8}
          className="w-72"
          onCloseAutoFocus={(e) => {
            if (askingRef.current) e.preventDefault();
          }}
        >
          <DropdownMenuRadioGroup value={a.mode}>
            {AWAKE_ITEMS.map((item) => {
              const lidOff = item.mode === 'lid' && !a.lid.available;
              const line = item.mode === 'lid' && a.lid.reason ? a.lid.reason : item.line;
              return (
                <DropdownMenuRadioItem
                  key={item.mode}
                  value={item.mode}
                  disabled={lidOff || (pending !== null && pending !== item.mode)}
                  data-field={`keep-awake-${item.mode}`}
                  className="items-start"
                  onSelect={(e) => {
                    // The menu stays open until the server answers (AWAKE-4.4).
                    e.preventDefault();
                    void pick(item.mode);
                  }}
                >
                  <span className="flex min-w-0 flex-col">
                    <span>{item.label}</span>
                    {pending === item.mode ? (
                      <Loading size="caption" label={item.mode === 'lid' ? 'Asking Amphetamine…' : 'Changing…'} />
                    ) : (
                      <span className={cn('text-caption leading-4 text-muted-foreground', item.mode === 'lid' && a.lid.reason && 'whitespace-normal')} data-field={`keep-awake-${item.mode}-line`}>
                        {line}
                      </span>
                    )}
                  </span>
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          {error && <Alert layout="inline" title={error} className="px-2 py-1" data-field="keep-awake-error" />}
          {a.note && (
            <>
              <DropdownMenuSeparator />
              <p className="px-2 py-1 text-caption leading-4 text-muted-foreground" data-field="keep-awake-note">
                {a.note.text} · {formatAge(now - a.note.at)} ago
              </p>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={asking}
        onOpenChange={(next) => {
          if (pending || next) return;
          askingRef.current = false;
          setAsking(false);
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          showCloseButton={false}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            triggerRef.current?.focus();
          }}
        >
          <DialogTitle className="text-title">Amphetamine already has a session running</DialogTitle>
          <DialogDescription className="text-body leading-5">Replace it with Lookout&apos;s? Keep it, and Lookout stays Awake instead, without a closed lid.</DialogDescription>
          {error && <Alert title={error} />}
          <DialogFooter>
            <Button variant="quiet" size="form" autoFocus onClick={() => void pick('awake')} disabled={pending !== null}>
              {pending === 'awake' ? 'Keeping…' : 'Keep it'}
            </Button>
            <Button variant="secondary" size="form" onClick={() => void pick('lid', true)} disabled={pending !== null}>
              {pending === 'lid' ? 'Replacing…' : 'Replace'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
