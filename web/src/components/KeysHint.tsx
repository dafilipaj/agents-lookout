import { Fragment } from 'react';
import { Kbd } from '@/components/ui/kbd';
import { useKeys } from '@/lib/keys';
import { type HintKey, hint, hintKeys } from '@/lib/shortcuts';

const words = (k: HintKey) => [...hintKeys(k), k.label].join(' ');

/**
 * VIEW-3.12: the composer's hint line names who has the keys (SIDE-11.3), in `foreground`, then up
 * to four of that place's keys from the shortcuts list, as `Kbd`s. Not a live region: the controls
 * announce a focus change themselves. Nothing while a dialog is open.
 */
export function KeysHint() {
  const keys = useKeys();
  if (!keys) return null;
  const { name, keys: list } = hint(keys.at, keys.panel);
  return (
    <span data-field="keys-hint" data-keys-at={keys.at} title={[name, ...list.map(words)].join(' · ')}>
      <span className="font-medium text-foreground">{name}</span>
      {list.map((k) => (
        <Fragment key={k.label}>
          {' · '}
          {hintKeys(k).map((key) => (
            <Fragment key={key}>
              <Kbd>{key}</Kbd>{' '}
            </Fragment>
          ))}
          {k.label}
        </Fragment>
      ))}
    </span>
  );
}
