import { useState } from "react";
import { updateCheckout } from "../../services/storeApi";
import { useNavigate } from "react-router-dom";
import { User, MapPin, CreditCard, Loader2 } from "lucide-react";

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
    <div className="rounded-[20px] border border-[#ECECEC] bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.06)] md:p-8">
      <div className="mb-8">
        <h2 className="text-[28px] font-bold text-[#1E1E1E]">Checkout</h2>
        <p className="mt-2 text-[15px] text-[#666666]">Please enter your delivery information.</p>
      </div>

      {/* Personal Info Section */}
      <div className="mb-8">
        <h3 className="mb-4 flex items-center gap-2 text-[16px] font-bold text-[#1E1E1E]">
          <User size={18} className="text-[#3E8E2E]" />
          Personal Details
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <input
            name="first_name"
            placeholder="First Name"
            value={form.billing_address.first_name}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999]"
          />
          <input
            name="last_name"
            placeholder="Last Name"
            value={form.billing_address.last_name}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999]"
          />
          <input
            name="email"
            type="email"
            placeholder="Email Address"
            value={form.billing_address.email}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999] md:col-span-2"
          />
        </div>
      </div>

      <hr className="my-8 border-[#ECECEC]" />

      {/* Delivery Info Section */}
      <div className="mb-8">
        <h3 className="mb-4 flex items-center gap-2 text-[16px] font-bold text-[#1E1E1E]">
          <MapPin size={18} className="text-[#3E8E2E]" />
          Delivery Address
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <input
            name="phone"
            placeholder="Phone Number"
            value={form.billing_address.phone}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999] md:col-span-2"
          />
          <input
            name="address_1"
            placeholder="Address Line 1"
            value={form.billing_address.address_1}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999] md:col-span-2"
          />
          <input
            name="address_2"
            placeholder="Address Line 2 (Optional)"
            value={form.billing_address.address_2}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999] md:col-span-2"
          />
          <input
            name="city"
            placeholder="City"
            value={form.billing_address.city}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999]"
          />
          <input
            name="state"
            placeholder="State"
            value={form.billing_address.state}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999]"
          />
          <input
            name="postcode"
            placeholder="Pincode"
            value={form.billing_address.postcode}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999]"
          />
          <input
            name="country"
            placeholder="Country"
            value={form.billing_address.country}
            onChange={handleChange}
            className="h-[52px] w-full rounded-[14px] border border-[#ECECEC] bg-white px-4 text-[15px] text-[#1E1E1E] outline-none transition-all focus:border-[#3E8E2E] focus:ring-4 focus:ring-[#3E8E2E]/10 placeholder:text-[#999999]"
          />
        </div>
      </div>

      <hr className="my-8 border-[#ECECEC]" />

      {/* Payment Section */}
      <div className="mb-10">
        <h3 className="mb-4 flex items-center gap-2 text-[16px] font-bold text-[#1E1E1E]">
          <CreditCard size={18} className="text-[#3E8E2E]" />
          Payment Method
        </h3>
        <div className="flex cursor-pointer items-center gap-4 rounded-[16px] border-2 border-[#3E8E2E] bg-[#F7F8FA] p-4 transition-all hover:bg-[#EEF2ED]">
          <div className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-[#3E8E2E]">
            <div className="h-2.5 w-2.5 rounded-full bg-[#3E8E2E]"></div>
          </div>
          <div>
            <div className="font-bold text-[#1E1E1E]">Cash on Delivery (COD)</div>
            <div className="text-[13px] text-[#666666]">Pay with cash upon delivery.</div>
          </div>
        </div>
      </div>

      <button
        onClick={handlePlaceOrder}
        disabled={loading}
        className="flex h-[58px] w-full items-center justify-center gap-2 rounded-[20px] bg-[#3E8E2E] text-[16px] font-bold text-white shadow-[0_8px_30px_rgba(62,142,46,0.25)] transition-all duration-300 hover:bg-[#2F7424] hover:shadow-[0_12px_40px_rgba(62,142,46,0.3)] active:scale-95 disabled:opacity-70 disabled:hover:scale-100"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={20} />
            Processing...
          </>
        ) : (
          "Place Order securely \u2192"
        )}
      </button>
    </div>
  );
}

export default BillingForm;
