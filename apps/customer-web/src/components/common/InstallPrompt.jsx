import { useState, useEffect } from "react";
import { X, Download, Share, PlusSquare } from "lucide-react";

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    // 1. Check if already installed / running in standalone mode
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true ||
      localStorage.getItem("mumbai_pwa_installed") === "true";

    if (isStandalone) {
      return;
    }

    // 2. Check if user dismissed the prompt in this session
    const isDismissed = sessionStorage.getItem("mumbai_pwa_dismissed");
    if (isDismissed) {
      return;
    }

    // 3. Detect iOS Safari
    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice =
      /iphone|ipad|ipod/.test(ua) &&
      !window.MSStream;
    const isSafari =
      ua.includes("safari") &&
      !ua.includes("crios") &&
      !ua.includes("fxios");

    if (isIosDevice && isSafari) {
      setIsIos(true);
      // Show prompt after a short delay on iOS
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 3000);
      return () => clearTimeout(timer);
    }

    // 4. Android / Chromium: Listen for beforeinstallprompt event
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
    if (isIos) {
      setShowIosGuide(true);
      return;
    }

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
    setShowIosGuide(false);
    sessionStorage.setItem("mumbai_pwa_dismissed", "true");
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <>
      {/* Floating PWA Banner (Positioned at top to prevent collision with bottom cart pill) */}
      <aside aria-label="Install app" className="fixed top-3 left-3 right-3 z-[60] mx-auto max-w-md animate-in fade-in slide-in-from-top-4 duration-300 md:top-4 md:left-auto md:right-6">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#1E3252] bg-[#0E1A2E]/95 p-3.5 shadow-2xl backdrop-blur-md">
          {/* App Icon */}
          <img
            src="/icons/icon-192.png"
            alt="Mumbai Collection"
            className="h-12 w-12 flex-shrink-0 rounded-xl shadow-md border border-[#1E3252]/80 object-cover"
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

      {/* iOS Safari Step-by-Step Installation Modal */}
      {showIosGuide && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm rounded-[24px] border border-[#1E3252] bg-[#111F36] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-[#1E3252]">
              <div className="flex items-center gap-3">
                <img
                  src="/icons/icon-192.png"
                  alt="Mumbai Collection"
                  className="h-10 w-10 rounded-xl border border-[#1E3252]"
                />
                <div>
                  <h3 className="text-base font-bold text-[#F1F5F9]">Install on iPhone</h3>
                  <p className="text-xs text-[#8FA4BE]">Add to your Home Screen</p>
                </div>
              </div>
              <button
                onClick={() => setShowIosGuide(false)}
                className="rounded-lg p-1 text-[#6E84A3] hover:text-[#F1F5F9]"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-5 space-y-4 text-sm text-[#F1F5F9]">
              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1E3252] text-[#42D6E8] flex-shrink-0">
                  <Share size={16} />
                </div>
                <p className="text-[13px] text-[#CBD5E1] pt-0.5">
                  1. Tap the <span className="font-bold text-[#42D6E8]">Share</span> icon in the bottom menu bar of Safari.
                </p>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1E3252] text-[#42D6E8] flex-shrink-0">
                  <PlusSquare size={16} />
                </div>
                <p className="text-[13px] text-[#CBD5E1] pt-0.5">
                  2. Scroll down and tap <span className="font-bold text-[#42D6E8]">Add to Home Screen</span>.
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setShowIosGuide(false);
                localStorage.setItem("mumbai_pwa_installed", "true");
                setShowPrompt(false);
              }}
              className="mt-6 w-full rounded-xl bg-[#42D6E8] py-3 text-center text-sm font-bold text-[#061220] transition hover:bg-[#2CC4D8]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
