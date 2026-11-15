export function OrderBulkModals({
  bulkConfirm,
  onCloseConfirm,
  onConfirmDispatch,
  bulkBusy,
  bulkResults,
}) {
  return (
    <>
      {bulkResults && bulkResults.length > 0 && (
        <div
          role="alert"
          className="rounded-xl bg-rose-50 p-3 text-xs text-rose-800 space-y-1 mb-3"
        >
          {bulkResults.map((row) => (
            <p key={row.id}>
              Order #{row.id}: {row.message || "Dispatch failed"}
            </p>
          ))}
          <p className="font-semibold pt-1">
            Failed orders remain selected. Review them before retrying.
          </p>
        </div>
      )}

      {bulkConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm bulk dispatch"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-bold text-gray-900">
              Dispatch {bulkConfirm.reviewedIds?.length || 0} packed{" "}
              {bulkConfirm.reviewedIds?.length === 1 ? "order" : "orders"}?
            </h2>
            <div className="text-sm text-gray-600 space-y-1">
              {Object.entries(bulkConfirm.groups || {}).map(([location, count]) => (
                <p key={location} className="flex justify-between">
                  <span>{location}</span>
                  <span className="font-semibold text-gray-800">{count}</span>
                </p>
              ))}
            </div>
            <p className="text-xs text-gray-500">
              Customer tracking updates on its next refresh. Each order is checked again before dispatch.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={onCloseConfirm}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={onConfirmDispatch}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
              >
                {bulkBusy ? "Dispatching…" : "Confirm dispatch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
