import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * DS-8.5 (0012): a person's picture in a 16 px circle, from Lookout's own origin, over their initial,
 * which stays while the picture loads and when it can't be had. The one component that renders an
 * `<img>`. Its accessible name and tooltip are the login.
 */
export function Avatar({ login, src, className }: { login: string; src: string; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return (
    <span
      role="img"
      aria-label={login}
      title={login}
      data-slot="avatar"
      data-state={state}
      className={cn('relative inline-flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-caption font-medium text-muted-foreground', className)}
    >
      {state !== 'loaded' && <span aria-hidden>{login.slice(0, 1).toUpperCase()}</span>}
      {state !== 'failed' && (
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn('absolute inset-0 size-full object-cover', state !== 'loaded' && 'opacity-0')}
        />
      )}
    </span>
  );
}
