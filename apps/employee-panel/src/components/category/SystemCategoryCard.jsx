import { getCategoryImageUrl } from "../../utils/categoryImage.js";

function SystemCategoryCard({ category }) {
  const categoryImgSrc = getCategoryImageUrl(category);

  return (
    <div
      key={category.id}
      className="flex items-center justify-between rounded-2xl border border-dashed border-gray-300 bg-gray-50/70 p-3.5 sm:p-4 shadow-2xs"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white flex items-center justify-center p-1">
          {categoryImgSrc ? (
            <img
              src={categoryImgSrc}
              alt={category.name}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-100 text-gray-400 font-bold text-sm uppercase">
              U
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h4 className="text-sm font-bold text-gray-700 truncate">
              {category.name}
            </h4>
            <span className="shrink-0 inline-flex items-center gap-0.5 rounded-md bg-amber-100 text-amber-800 px-1.5 py-0.2 text-[10px] font-bold">
              System Locked
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Default fallback category &bull; Excluded from storefront merchandising order
          </p>
        </div>
      </div>

      <span className="text-[11px] font-bold text-gray-400 italic px-2 shrink-0">
        Protected
      </span>
    </div>
  );
}

export default SystemCategoryCard;
