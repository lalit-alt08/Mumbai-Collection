import {
  GripVertical,
  ArrowUp,
  ArrowDown,
  Edit3,
} from "lucide-react";
import { getCategoryImageUrl } from "../../utils/categoryImage.js";

function CategoryOrderItem({
  category,
  index,
  totalCount,
  isOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMoveUp,
  onMoveDown,
  onOpenUpdateModal,
}) {
  const categoryImgSrc = getCategoryImageUrl(category);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
      className={`group relative rounded-2xl border bg-white shadow-xs transition-all duration-150 ${
        isOver
          ? "border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20 scale-[1.01]"
          : "border-gray-200/90 hover:border-emerald-300 hover:shadow-sm"
      }`}
    >
      {/* ======================================================== */}
      {/* DESKTOP VIEW (sm:flex) — UNTOUCHED ORIGINAL LAYOUT        */}
      {/* ======================================================== */}
      <div className="hidden sm:flex items-center justify-between p-3.5 sm:p-4">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          {/* Drag Handle & Position Indicator */}
          <div className="flex items-center gap-1 shrink-0">
            <div
              className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-700 transition"
              title="Drag to reorder"
            >
              <GripVertical size={18} />
            </div>
            <span className="w-5 text-center text-xs font-black text-gray-500 font-mono">
              {index + 1}
            </span>
          </div>

          {/* Category Thumbnail */}
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center p-1">
            {categoryImgSrc ? (
              <img
                src={categoryImgSrc}
                alt={category.name}
                className="h-full w-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-purple-50 text-[#7C3AED] font-black text-base uppercase">
                {category.name?.charAt(0) || "C"}
              </div>
            )}
          </div>

          {/* Category Name & Product Count */}
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black text-gray-900 truncate">
              {category.name}
            </h3>

            <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
              <span className="font-semibold">
                <span className="font-bold text-emerald-700">{category.count ?? 0}</span> products
              </span>
              <span className="text-[10px] font-mono text-gray-400">
                ID #{category.id}
              </span>
            </div>
          </div>
        </div>

        {/* Actions & Move Buttons */}
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <div className="flex items-center gap-1 border-r border-gray-100 pr-2 mr-1">
            <button
              type="button"
              onClick={() => onMoveUp(index)}
              disabled={index === 0}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              title="Move Up"
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(index)}
              disabled={index >= totalCount - 1}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer"
              title="Move Down"
            >
              <ArrowDown size={14} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onOpenUpdateModal(category)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-600 hover:text-white transition shadow-2xs active:scale-95 cursor-pointer"
          >
            <Edit3 size={13} />
            Update Category
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MOBILE VIEW (< sm) — SPACIOUS, COMFORTABLE TOUCH CARD     */}
      {/* ======================================================== */}
      <div className="flex sm:hidden flex-col p-3.5 space-y-3">
        {/* Top Row: Position Badge & Category Details */}
        <div className="flex items-start gap-3">
          {/* Position Badge */}
          <div className="flex flex-col items-center justify-center shrink-0 w-7 pt-1">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 font-mono font-black text-xs">
              {index + 1}
            </span>
            <div className="text-gray-300 mt-1">
              <GripVertical size={14} />
            </div>
          </div>

          {/* Thumbnail */}
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center p-1">
            {categoryImgSrc ? (
              <img
                src={categoryImgSrc}
                alt={category.name}
                className="h-full w-full object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-purple-50 text-[#7C3AED] font-black text-base uppercase">
                {category.name?.charAt(0) || "C"}
              </div>
            )}
          </div>

          {/* Name & Count */}
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-black text-gray-900 break-words leading-snug">
              {category.name}
            </h3>

            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                {category.count ?? 0} products
              </span>
              <span className="text-[10px] font-mono text-gray-400">
                #{category.id}
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Row: Reorder Touch Controls & Update Button */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          {/* Touch Reorder Controls */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onMoveUp(index)}
              disabled={index === 0}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95 disabled:opacity-30 disabled:active:scale-100 transition shadow-2xs cursor-pointer"
              aria-label={`Move ${category.name} Up`}
            >
              <ArrowUp size={16} />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(index)}
              disabled={index >= totalCount - 1}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95 disabled:opacity-30 disabled:active:scale-100 transition shadow-2xs cursor-pointer"
              aria-label={`Move ${category.name} Down`}
            >
              <ArrowDown size={16} />
            </button>
            <span className="text-[11px] font-bold text-gray-400 ml-1">Reorder</span>
          </div>

          {/* Primary Update Button */}
          <button
            type="button"
            onClick={() => onOpenUpdateModal(category)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-black text-emerald-800 hover:bg-emerald-600 hover:text-white transition shadow-2xs active:scale-95 cursor-pointer"
          >
            <Edit3 size={13} />
            Update Category
          </button>
        </div>
      </div>
    </div>
  );
}

export default CategoryOrderItem;
