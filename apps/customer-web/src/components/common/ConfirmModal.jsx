import { useEffect } from "react";
import { Trash2, Loader2, X } from "lucide-react";

function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Delete address?",
  message = "Are you sure you want to delete this address? This action cannot be undone.",
  confirmText = "Delete Address",
  cancelText = "Cancel",
  isLoading = false,
  variant = "danger", // "danger" | "emerald"
  icon: Icon = Trash2,
}) {
  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape" && !isLoading) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Lock background scrolling
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const isDanger = variant === "danger";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        onClick={() => {
          if (!isLoading) onClose();
        }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity animate-[fadeIn_0.2s_ease-out]"
      />

      {/* Modal Container */}
      <div className="relative z-10 w-full max-w-[500px] sm:max-w-[520px] overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-[#FFFFFF] p-6 shadow-[0_25px_70px_rgba(0,0,0,0.6)] animate-[scaleUp_0.2s_ease-out] sm:p-8 sm:px-9">
        
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          aria-label="Close modal"
          className="absolute right-4.5 top-4.5 flex h-9 w-9 items-center justify-center rounded-full text-[#64748B] transition hover:bg-[#FFFFFF] hover:text-[#1E293B] disabled:opacity-50 cursor-pointer"
        >
          <X size={20} />
        </button>

        {/* Icon Badge */}
        <div className="mx-auto flex justify-center">
          <div
            className={`flex h-16 w-16 sm:h-[68px] sm:w-[68px] items-center justify-center rounded-2xl border ${
              isDanger
                ? "border-rose-900/60 bg-rose-950/40 text-rose-400"
                : "border-[#E2E8F0] bg-[#FFFFFF] text-[#22499F]"
            }`}
          >
            <Icon size={32} strokeWidth={2.2} />
          </div>
        </div>

        {/* Content */}
        <div className="mt-4 text-center sm:mt-5">
          <h3
            id="confirm-modal-title"
            className="text-xl sm:text-[23px] font-black tracking-tight text-[#1E293B]"
          >
            {title}
          </h3>
          <div className="mx-auto mt-2.5 w-full text-xs leading-relaxed text-[#CBD5E1] sm:text-sm">
            {message}
          </div>
        </div>

        {/* Prominent Action Buttons */}
        <div className="mt-6 flex flex-col gap-3 sm:mt-7">
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`flex h-[52px] sm:h-[56px] w-full items-center justify-center gap-2.5 rounded-2xl px-6 text-[15px] sm:text-base font-extrabold shadow-md transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer ${
              isDanger
                ? "bg-rose-600 text-white shadow-[0_6px_20px_rgba(225,29,72,0.28)] hover:bg-rose-700"
                : "bg-[#22499F] text-[#FFFFFF] font-black shadow-[0_6px_20px_rgba(66,214,232,0.3)] hover:bg-[#1B3B82]"
            }`}
          >
            {isLoading && <Loader2 size={18} className="animate-spin" />}
            <span>{isLoading ? "Processing..." : confirmText}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="flex h-[52px] sm:h-[56px] w-full items-center justify-center rounded-2xl border-2 border-[#E2E8F0] bg-[#F0F8E8] px-6 text-[15px] sm:text-base font-bold text-[#1E293B] shadow-sm transition hover:bg-[#FFFFFF] hover:border-[#22499F]/50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {cancelText}
          </button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleUp {
          from { opacity: 0; transform: scale(0.95) translateY(10px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}} />
    </div>
  );
}

export default ConfirmModal;
