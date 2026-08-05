function ProductDescription({ product }) {
  return (
    <section className="rounded-2xl border bg-white p-6">

      <h2 className="mb-5 text-2xl font-bold">
        Product Description
      </h2>

      <div
        className="prose max-w-none"
        dangerouslySetInnerHTML={{
          __html: product.description,
        }}
      />

    </section>
  );
}

export default ProductDescription;