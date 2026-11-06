import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/**
 * DS-18.1: a Button's role is its `variant`, each with one look; DS-18.3: its place is its `size`.
 * - `primary`: the action the surface exists for (Send, Start, a dialog's confirm, Save); one per surface (DS-18.4).
 * - `soft`: the next step in a dense place (a row's first action, a past Session's Resume).
 * - `secondary`: a real alternative (Stop, Esc, Cancel).
 * - `quiet`: frequent, low-stakes actions in headers and toolbars (Add to Topic, More, Copy, Show more).
 * - `danger`: End Session and Delete where they're used, last, after a divider (DS-18.5).
 * - `destructive`: only the confirming button of a dialog that ends or deletes something.
 * - `link`: a button inside a line of text.
 * Sizes: `line` 24 px in a line of text, a card's line or the status line; `default` 28 px in headers,
 * rows, panels, toolbars and the chat; `form` 32 px in dialogs and Settings' forms. A button that is
 * only an icon is an `IconButton` (DS-7).
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-body font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        soft: "bg-primary-soft text-primary-text hover:bg-primary/15 dark:hover:bg-primary/30",
        secondary:
          "border bg-background text-foreground shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        quiet:
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        danger:
          "text-destructive-text hover:bg-accent dark:hover:bg-accent/50",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        link: "text-foreground underline underline-offset-4",
      },
      size: {
        line: "h-6 gap-1 px-2 text-meta has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        default: "h-7 gap-1.5 px-2.5 has-[>svg]:px-2",
        form: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "secondary",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

/**
 * DS-18.5: the divider before a danger action (End Session, a Topic's Delete): a 1 px line in
 * `border`, 16 px tall, 4 px either side. Its default margin fits a row with a 6 px gap (the Session
 * header); a row with another gap passes the margin that makes 4 px.
 */
function ButtonDivider({ className }: { className?: string }) {
  return <span aria-hidden data-slot="button-divider" className={cn("-mx-0.5 h-4 w-px shrink-0 bg-border", className)} />
}

export { Button, ButtonDivider, buttonVariants }
