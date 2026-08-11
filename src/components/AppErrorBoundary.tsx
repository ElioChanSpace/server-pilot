import React from "react";

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("应用渲染失败:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <h2>应用遇到错误</h2>
          <p>{this.state.error.message || String(this.state.error)}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
