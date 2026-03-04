import type { ErrorInfo, ReactNode } from "react";
import { Component } from "react";

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  errorMessage: string | null;
};

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = {
    errorMessage: null,
  };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    const message =
      error instanceof Error ? error.message : "Unknown render error";
    return { errorMessage: message };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("RootErrorBoundary caught render error:", error, errorInfo);
  }

  render() {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <main
        style={{
          minHeight: "100vh",
          width: "100%",
          display: "grid",
          placeItems: "center",
          padding: "20px",
          background: "#ffffff",
          color: "#111827",
          fontFamily:
            '"Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif',
        }}
      >
        <section
          style={{
            width: "min(640px, 100%)",
            border: "1px solid #d1d5db",
            borderRadius: "10px",
            background: "#f9fafb",
            padding: "16px",
          }}
        >
          <h1 style={{ margin: "0 0 8px", fontSize: "16px" }}>
            前端渲染失败
          </h1>
          <p style={{ margin: "0 0 8px", fontSize: "13px", lineHeight: 1.6 }}>
            应用捕获到了渲染异常，已阻止白屏。请将错误信息和
            <code style={{ marginLeft: 4 }}>
              %LOCALAPPDATA%\com.kimi.shell\logs\app.log
            </code>
            一并反馈。
          </p>
          <pre
            style={{
              margin: 0,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontSize: "12px",
              lineHeight: 1.5,
              color: "#374151",
            }}
          >
            {this.state.errorMessage}
          </pre>
        </section>
      </main>
    );
  }
}
