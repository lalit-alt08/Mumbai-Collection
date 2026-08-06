import { Link } from "react-router-dom";

function CategoryCard({ category }) {
  return (
    <Link
      to={category.link}
      className="group block"
    >
      <div className="overflow-hidden rounded-[20px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.03)] border border-[#ECECEC] transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)]">
        <img
          src={category.image}
          alt={category.name}
          className="aspect-square w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      </div>

      <h3 className="mt-4 text-center text-[15px] font-medium tracking-tight text-[#1E1E1E]">
        {category.name}
      </h3>
    </Link>
  );
}

export default CategoryCard;