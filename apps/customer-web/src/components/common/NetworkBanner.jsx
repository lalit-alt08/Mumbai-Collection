import { useState, useEffect, useRef } from "react";
import { WifiOff, Wifi, RefreshCw } from "lucide-react";

function NetworkBanner() {
  const bannerRef = useRef(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true
  );
  const [showReconnected, setShowReconnected] = useState(false);
  const [checking, setChecking] = useState(false);

  const isVisible = !isOnline || showReconnected;

  useEffect(() => {
    if (typeof document === "undefined") return;

    if (!isVisible) {
      document.documentElement.style.setProperty("--network-banner-height", "0px");
      return;
    }

    const updateHeight = () => {
      if (bannerRef.current) {
        const height = bannerRef.current.offsetHeight || 0;
        document.documentElement.style.setProperty("--network-banner-height", `${height}px`);
      }
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
      document.documentElement.style.setProperty("--network-banner-height", "0px");
    };
  }, [isVisible]);

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
  if (!isVisible) {
    return null;
  }

  return (
    <div
      ref={bannerRef}
      role="status"
      aria-live="polite"
      className={`sticky top-0 z-[100] w-full transition-all duration-300 ${
        !isOnline
          ? "bg-[#111F36] text-[#F1F5F9] border-b border-[#1E3252] shadow-lg"
          : "bg-[#42D6E8] text-[#061220] font-bold shadow-md"
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5 text-xs font-semibold sm:px-6">
        <div className="flex items-center gap-2.5">
          {!isOnline ? (
            <>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#132B45] border border-[#1E3252] text-[#42D6E8]">
                <WifiOff size={14} className="animate-pulse" />
              </span>
              <span>
                You are currently offline. Please check your internet or WiFi.
              </span>
            </>
          ) : (
            <>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#111F36]/30 text-[#061220]">
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
            className="flex items-center gap-1 rounded-full bg-[#132B45] border border-[#1E3252] px-3 py-1 text-[11px] font-bold text-[#42D6E8] transition hover:bg-[#42D6E8] hover:text-[#061220] active:scale-95 disabled:opacity-50"
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
