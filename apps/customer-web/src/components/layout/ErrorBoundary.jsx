import { Component } from "react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.href = "/";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#F7F7FB] px-4 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#F1ECFF] shadow-sm">
            <span className="text-3xl">⚠️</span>
          </div>

          <h1 className="mb-2 text-2xl font-bold text-[#1E1E1E]">
            Something went wrong
          </h1>

          <p className="mb-8 max-w-md text-sm text-[#666666]">
            We encountered an unexpected issue while loading this page. Please refresh or return to the home page.
          </p>

          <button
            onClick={this.handleReload}
            className="rounded-full bg-[#7C3AED] px-8 py-3 text-sm font-bold text-white shadow-[0_4px_16px_rgba(124,58,237,0.25)] transition-all hover:bg-[#6C35E8] active:scale-95"
          >
            Return to Home
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
