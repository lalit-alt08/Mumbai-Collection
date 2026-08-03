import categories from "../../data/category.js";
import CategoryCard from "./CategoryCard";

function CategoryGrid() {
  return (
    <section>
      <h2 className="mb-5 text-2xl font-bold">
        Shop by Category
      </h2>

      <div className="grid grid-cols-3 gap-4">
        {categories.map((category) => (
          <CategoryCard
            key={category.id}
            category={category}
          />
        ))}
      </div>
    </section>
  );
}

export default CategoryGrid;