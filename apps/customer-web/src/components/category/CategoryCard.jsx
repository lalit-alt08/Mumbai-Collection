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
      <div className="overflow-hidden rounded-[16px] sm:rounded-[20px] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-gray-200/80 transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_10px_30px_rgba(124,58,237,0.08)]">
        <img
          src={imageUrl}
          alt={category.name}
          className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          loading="lazy"
        />
      </div>

      <h3 className="mt-2 text-center text-xs sm:text-sm font-bold tracking-tight text-[#111827]">
        {category.name}
      </h3>
    </Link>
  );
}

export default CategoryCard;