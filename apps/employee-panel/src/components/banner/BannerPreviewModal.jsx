import { Eye, X, Monitor, Smartphone } from "lucide-react";

export function BannerPreviewModal({
  banner,
  onClose,
  previewMode,
  setPreviewMode,
}) {
  if (!banner) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl rounded-3xl bg-white p-5 sm:p-7 shadow-2xl border border-gray-100 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
              <Eye size={18} className="text-emerald-600" />
              Storefront Banner Preview
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {banner.title || "Promotional Banner"} &bull; Links to:{" "}
              <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700 font-mono text-[11px]">
                {banner.link}
              </code>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 rounded-xl hover:bg-gray-100 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Viewport Mode Switcher */}
        <div className="flex items-center justify-center gap-2 bg-gray-100 p-1 rounded-2xl w-fit mx-auto border border-gray-200">
          <button
            type="button"
            onClick={() => setPreviewMode("desktop")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition ${
              previewMode === "desktop"
                ? "bg-white text-gray-900 shadow-2xs font-black"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Monitor size={14} /> Desktop (8:3)
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode("mobile")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition ${
              previewMode === "mobile"
                ? "bg-white text-gray-900 shadow-2xs font-black"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Smartphone size={14} /> Mobile (16:7)
          </button>
        </div>

        {/* Preview Viewport Canvas */}
        <div className="bg-[#0B1425] p-4 sm:p-6 rounded-2xl border border-[#1E3252]/60 flex items-center justify-center">
          <div
            className={`w-full overflow-hidden rounded-[18px] border border-white/10 shadow-lg ${
              previewMode === "desktop"
                ? "aspect-[16/6] max-w-full"
                : "aspect-[16/7] max-w-xs mx-auto"
            }`}
          >
            {previewMode === "desktop" ? (
              banner.desktop_image || banner.mobile_image ? (
                <img
                  src={banner.desktop_image || banner.mobile_image}
                  alt="Preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center bg-gray-800 text-gray-400 text-xs font-bold">
                  No desktop image uploaded
                </div>
              )
            ) : banner.mobile_image || banner.desktop_image ? (
              <img
                src={banner.mobile_image || banner.desktop_image}
                alt="Preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex items-center justify-center bg-gray-800 text-gray-400 text-xs font-bold">
                No mobile image uploaded
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition"
          >
            Close Preview
          </button>
        </div>
      </div>
    </div>
  );
}
