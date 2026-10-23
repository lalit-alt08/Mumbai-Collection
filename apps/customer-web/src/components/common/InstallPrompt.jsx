import { useState, useEffect } from "react";
import { X, Download } from "lucide-react";

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // 1. Strict Android Mobile Only: Filter out iOS and all Desktop devices
    if (typeof window === "undefined" || !window.navigator) return;

    const ua = (window.navigator.userAgent || "").toLowerCase();
    const isAndroid = /android/i.test(ua);
    const isMobile = /mobile/i.test(ua);

    // Only proceed on Android mobile devices
    if (!isAndroid || !isMobile) {
      return;
    }

    // 2. Check if already installed / running in standalone mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true ||
      localStorage.getItem("mumbai_pwa_installed") === "true";

    if (isStandalone) {
      return;
    }

    // 3. Check if user dismissed the prompt in this session
    const isDismissed = sessionStorage.getItem("mumbai_pwa_dismissed");
    if (isDismissed) {
      return;
    }

    // 4. Android Chromium: Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      // Show prompt after a short delay
      setTimeout(() => {
        setShowPrompt(true);
      }, 2000);
    };

    const handleAppInstalled = () => {
      localStorage.setItem("mumbai_pwa_installed", "true");
      setShowPrompt(false);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) {
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      localStorage.setItem("mumbai_pwa_installed", "true");
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    sessionStorage.setItem("mumbai_pwa_dismissed", "true");
  };

  if (!showPrompt || !deferredPrompt) {
    return null;
  }

  return (
    <aside
      aria-label="Install app"
      className="md:hidden fixed top-3 left-3 right-3 z-[60] mx-auto max-w-md animate-in fade-in slide-in-from-top-4 duration-300"
    >
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#1E3252] bg-[#0E1A2E]/95 p-3.5 shadow-2xl backdrop-blur-md">
        {/* App Icon */}
        <img
          src="/icons/icon-192.png"
          alt="Mumbai Collection"
          className="h-11 w-11 flex-shrink-0 rounded-xl shadow-md border border-[#1E3252]/80 object-cover"
        />

        {/* Text Info */}
        <div className="flex-1 min-w-0 pr-1">
          <h4 className="text-[14px] font-bold text-[#F1F5F9] truncate">
            Mumbai Collection
          </h4>
          <p className="text-[12px] text-[#8FA4BE] truncate">
            Install app for faster shopping
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleInstallClick}
            className="flex items-center gap-1.5 rounded-xl bg-[#42D6E8] px-3.5 py-2 text-[13px] font-extrabold text-[#061220] transition-all hover:bg-[#2CC4D8] active:scale-95 cursor-pointer"
          >
            <Download size={15} strokeWidth={2.5} />
            <span>Install</span>
          </button>

          <button
            onClick={handleDismiss}
            aria-label="Dismiss install prompt"
            className="rounded-lg p-1.5 text-[#6E84A3] transition-colors hover:bg-[#1E3252] hover:text-[#F1F5F9] cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
