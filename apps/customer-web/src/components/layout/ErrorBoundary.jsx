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
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#F0F8E8] px-4 text-center text-[#1E293B]">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#FFFFFF] border border-[#E2E8F0] shadow-sm">
            <span className="text-3xl">⚠️</span>
          </div>

          <h1 className="mb-2 text-2xl font-bold text-[#1E293B]">
            Something went wrong
          </h1>

          <p className="mb-8 max-w-md text-sm text-[#64748B]">
            We encountered an unexpected issue while loading this page. Please refresh or return to the home page.
          </p>

          <button
            onClick={this.handleReload}
            className="rounded-full bg-[#22499F] px-8 py-3 text-sm font-black text-[#FFFFFF] shadow-[0_4px_16px_rgba(66,214,232,0.25)] transition-all hover:bg-[#1B3B82] active:scale-95 cursor-pointer"
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
