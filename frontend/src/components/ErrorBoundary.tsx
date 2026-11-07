import React from 'react';
import { PixelEmptyState } from './ui/pixel/PixelEmptyState';
import { PixelButton } from './ui/pixel/PixelButton';

/** Catches a crash in one page so the rest of the app (the sidebar, sign-out) keeps working. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Page crashed:', error); }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <PixelEmptyState
        kind="error"
        title="Something went wrong on this page"
        description="The rest of the app still works. Reload the page, or go to another one."
        action={<PixelButton onClick={() => window.location.reload()}>Reload page</PixelButton>}
      />
    );
  }
}
