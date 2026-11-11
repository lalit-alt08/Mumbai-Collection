import { Link } from "react-router-dom";
import { getCategoryImageUrl } from "../../utils/categoryImage.js";

function CategoryCard({ category }) {
  const imageUrl = getCategoryImageUrl(category);
  const linkUrl = category.link || `/category/${category.id || category.slug}`;

  return (
    <Link
      to={linkUrl}
      className="group block"
    >
      <div className="overflow-hidden rounded-[16px] sm:rounded-[20px] bg-[#FFFFFF] shadow-[0_4px_20px_rgba(0,0,0,0.3)] border border-[#E2E8F0]/80 transition-all duration-300 group-hover:-translate-y-1 group-hover:border-[#22499F]/60 group-hover:shadow-[0_10px_30px_rgba(66,214,232,0.15)]">
        <img
          src={imageUrl}
          alt={category.name}
          width="480"
          height="480"
          className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
          decoding="async"
        />
      </div>

      <h3 className="mt-1.5 sm:mt-2 text-center text-[11px] sm:text-sm font-semibold tracking-tight text-slate-100 group-hover:text-[#22499F] transition-colors line-clamp-1">
        {category.name}
      </h3>
    </Link>
  );
}

export default CategoryCard;
