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
        <div className="flex min-h-screen flex-col items-center justify-center bg-[#0B1425] px-4 text-center text-[#F1F5F9]">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-[#132B45] border border-[#1E3252] shadow-sm">
            <span className="text-3xl">⚠️</span>
          </div>

          <h1 className="mb-2 text-2xl font-bold text-[#F1F5F9]">
            Something went wrong
          </h1>

          <p className="mb-8 max-w-md text-sm text-[#8FA4BE]">
            We encountered an unexpected issue while loading this page. Please refresh or return to the home page.
          </p>

          <button
            onClick={this.handleReload}
            className="rounded-full bg-[#42D6E8] px-8 py-3 text-sm font-black text-[#061220] shadow-[0_4px_16px_rgba(66,214,232,0.25)] transition-all hover:bg-[#2CC4D8] active:scale-95 cursor-pointer"
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
