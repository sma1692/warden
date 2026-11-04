import React from 'react';

interface ErrorBoundaryProps {
  section?: string;
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// Isolates a crashing section so one bad row or payload can't white-screen the dashboard.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[Warden] ${this.props.section || 'section'} crashed:`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-panel)] p-4 text-sm text-[var(--surface-text)]">
          <p className="font-bold">{this.props.section || 'This section'} ran into a problem.</p>
          <p className="mt-1 text-xs text-[var(--surface-text-secondary)]">
            The rest of the dashboard keeps working. Reload the page to retry.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] hover:bg-[var(--surface-elevated)] px-3 py-1.5 text-xs font-semibold transition cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
