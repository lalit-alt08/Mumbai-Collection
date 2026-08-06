import { useParams } from "react-router-dom";

function OrderSuccess() {
  const { id } = useParams();

  return (
    <div className="mx-auto max-w-3xl p-10">
      <div className="rounded-xl border bg-white p-10 text-center shadow-sm">
        <div className="mb-6 text-6xl">🎉</div>

        <h1 className="mb-3 text-4xl font-bold">
          Thank You!
        </h1>

        <p className="mb-6 text-gray-600">
          Your order has been placed successfully.
        </p>

        <div className="rounded-lg bg-gray-100 p-5">
          <p className="text-lg">
            Order Number
          </p>

          <h2 className="mt-2 text-3xl font-bold">
            #{id}
          </h2>
        </div>
      </div>
    </div>
  );
}

export default OrderSuccess;