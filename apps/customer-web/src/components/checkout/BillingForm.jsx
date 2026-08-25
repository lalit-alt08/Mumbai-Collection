import { useEffect, useState, useRef } from "react";
import axios from "axios";
import { updateCheckout } from "../../services/storeApi";
import { useNavigate } from "react-router-dom";
import API_URL from "../../config/api.js";
import {
  MapPin,
  CreditCard,
  Loader2,
  Home,
  Building2,
  Plus,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { getIndianStateCode } from "../../data/indianStates";

function BillingForm() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { cart, refreshCart } = useCart();

  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);

  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isSubmittingRef = useRef(false);

  // Load saved addresses
  useEffect(() => {
    const loadAddresses = async () => {
      try {
        setLoadingAddresses(true);
        setError("");

        const response = await axios.get(`${API_URL}/addresses`, {
          withCredentials: true,
        });

        const savedAddresses = response.data.addresses || [];

        setAddresses(savedAddresses);

        // Automatically select first saved address
        if (savedAddresses.length > 0) {
          setSelectedAddressId(savedAddresses[0].id);
        }
      } catch (error) {
        console.error(
          "ADDRESS LOAD ERROR:",
          error.response?.data || error.message,
        );

        setError(
          error.response?.data?.message ||
            "Unable to load your saved addresses.",
        );
      } finally {
        setLoadingAddresses(false);
      }
    };

    loadAddresses();
  }, []);

  const selectedAddress = addresses.find(
    (address) => address.id === selectedAddressId,
  );

  const handlePlaceOrder = async () => {
    if (isSubmittingRef.current) return;

    if (!selectedAddress) {
      setError("Please select a delivery address.");
      return;
    }

    const itemsSubtotal = cart?.totals?.total_items
      ? Number(cart.totals.total_items) / 100
      : (cart?.items || []).reduce(
          (acc, item) =>
            acc +
            (Number(item.totals?.line_subtotal) ||
              Number(item.totals?.line_total) ||
              0),
          0,
        ) / 100;

    if (itemsSubtotal < 500) {
      const shortfall = Math.max(0, 500 - itemsSubtotal);
      setError(`Add ₹${shortfall} more to reach the minimum order value of ₹500.`);
      return;
    }

    try {
      isSubmittingRef.current = true;
      setLoading(true);
      setError("");

      /*
       * Convert saved address into WooCommerce checkout format with strict validation safeguards.
       */
      const nameParts = (selectedAddress.full_name || "").trim().split(/\s+/);

      const firstName = nameParts.shift() || "Customer";
      const lastName = nameParts.join(" ") || firstName; // Fallback to firstName if single name

      const stateCode = getIndianStateCode(selectedAddress.state);
      const userEmail = (user?.email || selectedAddress.email || "").trim() || "orders@mumbaicollection.in";
      const userPhone =
        (selectedAddress.phone || "").replace(/\D/g, "") || "9999999999";
      const cleanPincode =
        (selectedAddress.pincode || "").replace(/\D/g, "") || "";

      const billingAddress = {
        first_name: firstName,
        last_name: lastName,
        email: userEmail,
        phone: userPhone,
        address_1: selectedAddress.address_line1 || "Street Address",
        address_2: selectedAddress.address_line2 || "",
        city: selectedAddress.city || "Vasai West",
        state: stateCode,
        postcode: cleanPincode,
        country: "IN",
      };

      const shippingAddress = {
        first_name: firstName,
        last_name: lastName,
        phone: userPhone,
        address_1: selectedAddress.address_line1 || "Street Address",
        address_2: selectedAddress.address_line2 || "",
        city: selectedAddress.city || "Vasai West",
        state: stateCode,
        postcode: cleanPincode,
        country: "IN",
      };

      const response = await updateCheckout({
        billing_address: billingAddress,
        shipping_address: shippingAddress,
        payment_method: "cod",
        create_account: false,
      });
      // Refresh cart state to clear items and badges
      await refreshCart().catch(() => {});

      navigate(`/order-success/${response.order_id}`);
    } catch (error) {
      console.error(
        " PLACE ORDER ERROR:",
        error.response?.data || error.message,
      );

      setError(
        error.response?.data?.message ||
          "Failed to place order. Please try again.",
      );
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  if (loadingAddresses) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-[20px] border border-[#ECECEC] bg-white">
        <div className="flex items-center gap-2 text-[14px] font-medium text-[#666666]">
          <Loader2 size={19} className="animate-spin text-[#7C3AED]" />
          Loading your saved addresses...
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-[#ECECEC] bg-white p-5 shadow-[0_6px_24px_rgba(0,0,0,0.05)] md:p-6">
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-[25px] font-bold text-[#1E1E1E]">Checkout</h2>

        <p className="mt-1.5 text-[14px] text-[#666666]">
          Select your delivery address and payment method.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-5 rounded-[12px] bg-red-50 px-4 py-3 text-[13px] font-medium text-red-600">
          {error}
        </div>
      )}

      {/* Delivery Address */}
      <div className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-[16px] font-bold text-[#1E1E1E]">
            <MapPin size={18} className="text-[#7C3AED]" />
            Delivery Address
          </h3>

          <button
            type="button"
            onClick={() => navigate("/account/addresses")}
            className="flex items-center gap-1 text-[13px] font-bold text-[#7C3AED] transition-colors hover:text-[#6C35E8] hover:underline"
          >
            <Plus size={15} />
            Add Address
          </button>
        </div>

        {/* No saved addresses */}
        {addresses.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[#C4B5FD] bg-[#F1ECFF] p-5 text-center">
            <MapPin size={28} className="mx-auto mb-2 text-[#7C3AED]" />

            <h4 className="text-[14px] font-bold text-[#1E1E1E]">
              No saved addresses
            </h4>

            <p className="mt-1 text-[13px] text-[#666666]">
              Please add a delivery address before placing your order.
            </p>

            <button
              type="button"
              onClick={() => navigate("/account/addresses")}
              className="mt-3 rounded-xl bg-[#7C3AED] px-4 py-2 text-[13px] font-bold text-white transition hover:bg-[#6C35E8]"
            >
              Add Address
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {addresses.map((address) => {
              const isSelected = selectedAddressId === address.id;

              const isHome = address.type === "home";

              return (
                <button
                  key={address.id}
                  type="button"
                  onClick={() => setSelectedAddressId(address.id)}
                  className={`w-full rounded-[16px] border-2 p-4 text-left transition-all ${
                    isSelected
                      ? "border-[#7C3AED] bg-[#F1ECFF] shadow-[0_4px_16px_rgba(124,58,237,0.07)]"
                      : "border-[#ECECEC] bg-white hover:border-[#C4B5FD]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div
                      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                        isSelected ? "bg-[#E0D4FC]" : "bg-gray-50"
                      }`}
                    >
                      {isHome ? (
                        <Home
                          size={20}
                          className={
                            isSelected ? "text-[#7C3AED]" : "text-gray-500"
                          }
                        />
                      ) : (
                        <Building2
                          size={20}
                          className={
                            isSelected ? "text-[#7C3AED]" : "text-gray-500"
                          }
                        />
                      )}
                    </div>

                    {/* Address */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-[15px] font-bold text-[#1E1E1E]">
                          {isHome ? "Home" : "Office"}
                        </h4>

                        {isSelected && (
                          <span className="rounded-full bg-[#E0D4FC] px-2 py-0.5 text-[9px] font-bold text-[#7C3AED]">
                            SELECTED
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-[14px] font-semibold text-[#1E1E1E]">
                        {address.full_name}
                      </p>

                      <p className="mt-0.5 text-[13px] text-[#666666]">
                        {address.phone}
                      </p>

                      <p className="mt-2 text-[13px] leading-5 text-[#666666]">
                        {address.address_line1}
                        {address.address_line2 && (
                          <>
                            <br />
                            {address.address_line2}
                          </>
                        )}
                        <br />
                        {address.city}, Maharashtra
                      </p>
                    </div>

                    {/* Radio */}
                    <div
                      className={`mt-1 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                        isSelected ? "border-[#7C3AED]" : "border-gray-300"
                      }`}
                    >
                      {isSelected && (
                        <div className="h-2.5 w-2.5 rounded-full bg-[#7C3AED]" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <hr className="my-5 border-[#ECECEC]" />

      {/* Payment */}
      <div className="mb-5">
        <h3 className="mb-3 flex items-center gap-2 text-[16px] font-bold text-[#1E1E1E]">
          <CreditCard size={18} className="text-[#7C3AED]" />
          Payment Method
        </h3>

        <div className="flex items-center gap-3 rounded-[15px] border-2 border-[#7C3AED] bg-[#F1ECFF] p-4">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-[#7C3AED]">
            <div className="h-2.5 w-2.5 rounded-full bg-[#7C3AED]" />
          </div>

          <div>
            <div className="text-[14px] font-bold text-[#1E1E1E]">
              Cash on Delivery (COD)
            </div>

            <div className="mt-0.5 text-[12px] text-[#666666]">
              Pay with cash upon delivery.
            </div>
          </div>
        </div>
      </div>

      {/* Place Order */}
      <button
        type="button"
        onClick={handlePlaceOrder}
        disabled={loading || addresses.length === 0 || !selectedAddress}
        className="flex h-[54px] w-full items-center justify-center gap-2 rounded-[17px] bg-[#7C3AED] text-[15px] font-bold text-white shadow-[0_7px_22px_rgba(124,58,237,0.2)] transition-all hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={19} />
            Processing...
          </>
        ) : (
          "Place Order securely →"
        )}
      </button>
    </div>
  );
}

export default BillingForm;
