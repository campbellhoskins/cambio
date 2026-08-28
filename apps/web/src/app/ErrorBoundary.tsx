import { Component, type ReactNode } from "react";
import { Button } from "@cambio/ui";

interface ErrorBoundaryState {
  readonly hasError: boolean;
}

export class ErrorBoundary extends Component<{ readonly children: ReactNode }, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(): void {
    // Error details are intentionally not logged to avoid exposing session data.
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="app-shell" id="main-content">
        <section className="panel" role="alert">
          <h1>Something went wrong</h1>
          <p>Refresh the page and resume from your retained rooms.</p>
          <Button onClick={() => window.location.assign("/")}>Return home</Button>
        </section>
      </main>
    );
  }
}
