import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * DS-4.5: a main-pane view that throws while drawing shows an error Alert in its place, instead of
 * React unmounting the whole app to a blank page. The sidebar stays; a new `resetKey` (the route)
 * clears the error, so going to another view starts clean, and "Try again" draws the same view once
 * more. Never a `key`: that would remount the pane on every route change, a Codex Session's id
 * arriving included, and lose its open dialogs (VIEW-5.6).
 */
export class ViewErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Alert title="This view couldn't be drawn" detail={error.message} className="m-5" data-field="view-error">
        <Button variant="outline" size="sm" className="mt-2" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </Alert>
    );
  }
}
