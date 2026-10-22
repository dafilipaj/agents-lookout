import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { Input } from './input';
import { Label } from './label';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Textarea } from './textarea';

/** The font-size classes an element carries: the scale's steps and anything else that sets a size. */
const sizes = (el: Element) => [...el.classList].filter((c) => /^text-(?:caption|meta|body|prose|title|xs|sm|base|lg|[2-9]?xl|\[[\d.]+(?:px|rem|em)\])$/.test(c));

describe('shadcn components on the type scale', () => {
  it('DS-1.2: a button, input, textarea, menu item, label and popover are body; a dialog title is title, its description meta', () => {
    render(
      <>
        <Button>Save</Button>
        <Button size="xs">Show</Button>
        <Input aria-label="Name" />
        <Textarea aria-label="Prompt" />
        <Label htmlFor="x">Folder</Label>
        <DropdownMenu open>
          <DropdownMenuTrigger>Model</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Opus</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover open>
          <PopoverTrigger>Usage</PopoverTrigger>
          <PopoverContent>Details</PopoverContent>
        </Popover>
        <Dialog open>
          <DialogContent>
            <DialogTitle>New Session</DialogTitle>
            <DialogDescription>Runs in its own Session host.</DialogDescription>
          </DialogContent>
        </Dialog>
      </>,
    );
    expect(sizes(screen.getByRole('button', { name: 'Save', hidden: true }))).toEqual(['text-body']);
    // A smaller button is a step down, never a size off the scale.
    expect(sizes(screen.getByRole('button', { name: 'Show', hidden: true }))).toEqual(['text-meta']);
    expect(sizes(screen.getByRole('textbox', { name: 'Name', hidden: true }))).toEqual(['text-body']);
    expect(sizes(screen.getByRole('textbox', { name: 'Prompt', hidden: true }))).toEqual(['text-body']);
    expect(sizes(screen.getByText('Folder'))).toEqual(['text-body']);
    expect(sizes(screen.getByRole('menuitem', { name: 'Opus', hidden: true }))).toEqual(['text-body']);
    expect(sizes(screen.getByText('Details'))).toEqual(['text-body']);
    expect(sizes(screen.getByRole('heading', { name: 'New Session', hidden: true }))).toEqual(['text-title']);
    expect(sizes(screen.getByText('Runs in its own Session host.'))).toEqual(['text-meta']);
  });

  it('DS-1.2 (support): cn() treats the steps as font sizes, so a later step wins and a colour stays', () => {
    expect(cn('text-body text-muted-foreground', 'text-meta')).toBe('text-muted-foreground text-meta');
    expect(cn('text-meta', 'text-muted-foreground')).toBe('text-meta text-muted-foreground');
    expect(cn('text-caption leading-4', 'text-title')).toBe('text-title');
  });
});
