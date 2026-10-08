import { Component } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import Button from "@/components/ui/Button";

/**
 * A render error is a product state too. Without this, one bad row blanked the
 * entire app; now the chrome survives and the user keeps a way forward.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surfaced in the console for the ops console / Sentry-style collectors.
    console.error("[brief] screen crashed", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="py-20 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400 grid place-items-center mb-4">
          <AlertTriangle size={22} aria-hidden="true" />
        </div>
        <h2 className="text-lg font-bold text-ink-1">This screen stopped</h2>
        <p className="text-xs text-ink-3 mt-1.5 max-w-sm leading-relaxed">
          Something in the page failed to render. Nothing you did was saved or lost — reloading usually clears it.
        </p>
        <p className="mt-3 text-micro font-mono text-ink-4 max-w-md truncate">{String(this.state.error?.message || this.state.error)}</p>
        <div className="mt-5 flex gap-2">
          <Button size="sm" icon={RotateCw} onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button size="sm" variant="secondary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
