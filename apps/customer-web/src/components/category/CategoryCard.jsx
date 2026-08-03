import { Link } from "react-router-dom";

function CategoryCard({ category }) {
  return (
    <Link
      to={category.link}
      className="group"
    >
      <div className="overflow-hidden rounded-2xl bg-gray-100 transition group-hover:shadow-md">
        <img
          src={category.image}
          alt={category.name}
          className="aspect-square w-full object-cover"
        />
      </div>

      <h3 className="mt-3 text-center text-sm font-semibold md:text-lg">
        {category.name}
      </h3>
    </Link>
  );
}

export default CategoryCard;