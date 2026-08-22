import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Employee Panel ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#0F172A] p-4 text-white">
          <div className="w-full max-w-md rounded-3xl bg-[#1E293B] p-8 border border-white/10 text-center shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <AlertTriangle size={28} />
            </div>

            <div>
              <h2 className="text-xl font-black tracking-tight text-white">
                Something went wrong
              </h2>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                An unexpected interface error occurred. You can attempt to recover this view or refresh the page.
              </p>
            </div>

            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleReset}
                className="flex items-center gap-2 rounded-xl bg-white/10 px-5 py-2.5 text-xs font-bold text-white hover:bg-white/20 transition cursor-pointer"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 shadow-[0_4px_16px_rgba(16,185,129,0.3)] transition cursor-pointer"
              >
                <RotateCcw size={14} /> Reload Panel
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
