import { Component, type ErrorInfo, type ReactNode } from "react";
import { logToShell } from "../diagnostics";

interface Props {
  children: ReactNode;
  /** Label so the shell log says which boundary tripped. */
  label: string;
}

interface State {
  error: Error | null;
}

/** Stops a subtree's render error from white-screening the whole app, and
 *  forwards the error to the shell log so it's diagnosable. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logToShell(
      `ErrorBoundary[${this.props.label}]: ${error.message}\n${error.stack ?? ""}\n` +
        (info.componentStack ?? ""),
    );
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="dp-boundary">
          <div className="dp-boundary-title">⚠ {this.props.label} 오류</div>
          <pre className="dp-boundary-msg">{this.state.error.message}</pre>
          <button className="dp-btn" onClick={() => this.setState({ error: null })}>
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
