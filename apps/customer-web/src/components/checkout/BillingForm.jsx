import { useState } from "react";
import { updateCheckout } from "../../services/storeApi";
import { useNavigate } from "react-router-dom";

function BillingForm() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    billing_address: {
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      address_1: "",
      address_2: "",
      city: "",
      state: "MH",
      postcode: "",
      country: "IN",
    },

    shipping_address: {
      first_name: "",
      last_name: "",
      phone: "",
      address_1: "",
      address_2: "",
      city: "",
      state: "MH",
      postcode: "",
      country: "IN",
    },

    payment_method: "cod",
  });

  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;

    setForm((prev) => ({
      ...prev,
      billing_address: {
        ...prev.billing_address,
        [name]: value,
      },
    }));
  };

  const handlePlaceOrder = async () => {
    try {
      setLoading(true);

      const response = await updateCheckout({
        billing_address: form.billing_address,
        shipping_address: form.billing_address,
        payment_method: form.payment_method,
        create_account: false,
      });

      navigate(`/order-success/${response.order_id}`);
    } catch (error) {
      console.error(error);
      console.log("Server Response:", error.response?.data);

      alert("Failed to place order.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border p-6">
      <h2 className="mb-5 text-2xl font-semibold">Billing Details</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <input
          name="first_name"
          placeholder="First Name"
          value={form.billing_address.first_name}
          onChange={handleChange}
          className="rounded-lg border p-3"
        />

        <input
          name="last_name"
          placeholder="Last Name"
          value={form.billing_address.last_name}
          onChange={handleChange}
          className="rounded-lg border p-3"
        />

        <input
          name="email"
          type="email"
          placeholder="Email"
          value={form.billing_address.email}
          onChange={handleChange}
          className="rounded-lg border p-3"
        />

        <input
          name="phone"
          placeholder="Phone"
          value={form.billing_address.phone}
          onChange={handleChange}
          className="rounded-lg border p-3"
        />

        <input
          name="address_1"
          placeholder="Address Line 1"
          value={form.billing_address.address_1}
          onChange={handleChange}
          className="rounded-lg border p-3 md:col-span-2"
        />

        <input
          name="address_2"
          placeholder="Address Line 2"
          value={form.billing_address.address_2}
          onChange={handleChange}
          className="rounded-lg border p-3 md:col-span-2"
        />

        <input
          name="city"
          placeholder="City"
          value={form.billing_address.city}
          onChange={handleChange}
          className="rounded-lg border p-3"
        />

        <input
          name="state"
          placeholder="State"
          value={form.billing_address.state}
          onChange={handleChange}
          className="rounded-lg border p-3"
        />

        <input
          name="postcode"
          placeholder="Pincode"
          value={form.billing_address.postcode}
          onChange={handleChange}
          className="rounded-lg border p-3"
        />

        <input
          name="country"
          value={form.billing_address.country}
          onChange={handleChange}
          className="rounded-lg border p-3"
        />
      </div>

      <button
        onClick={handlePlaceOrder}
        disabled={loading}
        className="mt-6 w-full rounded-lg bg-green-600 py-3 font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? "Placing Order..." : "Place Order"}
      </button>
    </div>
  );
}

export default BillingForm;
