import { Component, type ReactNode } from "react";

interface State {
  failed: boolean;
}

/**
 * Keeps a fault in one view from blanking the whole window. The story is in its store and the
 * music in its own player, so both carry on; the view can simply be drawn again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error("A view failed", error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="syncing" role="alert">
        <p className="syncing__title">This view ran into a problem</p>
        <p className="live__note">
          Your story is safe and any music keeps playing. Draw the view again to go on.
        </p>
        <button
          type="button"
          className="live__action is-primary"
          onClick={() => {
            this.setState({ failed: false });
          }}
        >
          Try again
        </button>
      </section>
    );
  }
}
