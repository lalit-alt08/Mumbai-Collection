import { useState, useEffect } from "react";
import { WifiOff, Wifi, RefreshCw } from "lucide-react";

function NetworkBanner() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true
  );
  const [showReconnected, setShowReconnected] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let timer;

    const handleOnline = () => {
      setIsOnline(true);
      setShowReconnected(true);
      timer = setTimeout(() => {
        setShowReconnected(false);
      }, 3500);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setShowReconnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const handleManualCheck = async () => {
    try {
      setChecking(true);
      // Attempt a lightweight fetch check
      await fetch("/favicon.ico", { method: "HEAD", cache: "no-store" });
      setIsOnline(true);
      setShowReconnected(true);
      setTimeout(() => setShowReconnected(false), 3500);
    } catch {
      setIsOnline(false);
    } finally {
      setChecking(false);
    }
  };

  // If online and not showing reconnected flash, render nothing
  if (isOnline && !showReconnected) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-[100] w-full transition-all duration-300 ${
        !isOnline
          ? "bg-[#1E1E1E] text-white border-b border-[#FF8A00]/40 shadow-lg"
          : "bg-emerald-600 text-white shadow-md"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 text-xs font-semibold sm:px-6">
        <div className="flex items-center gap-2.5">
          {!isOnline ? (
            <>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FF8A00]/20 text-[#FF8A00]">
                <WifiOff size={14} className="animate-pulse" />
              </span>
              <span>
                You are currently offline. Please check your internet or WiFi.
              </span>
            </>
          ) : (
            <>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/40 text-white">
                <Wifi size={14} />
              </span>
              <span>Back online! Reconnected to Mumbai Collection.</span>
            </>
          )}
        </div>

        {!isOnline && (
          <button
            onClick={handleManualCheck}
            disabled={checking}
            className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white transition hover:bg-white/20 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw
              size={11}
              className={checking ? "animate-spin" : ""}
            />
            {checking ? "Checking..." : "Retry"}
          </button>
        )}
      </div>
    </div>
  );
}

export default NetworkBanner;
