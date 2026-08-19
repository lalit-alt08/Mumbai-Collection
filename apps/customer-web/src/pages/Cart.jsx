import { useState } from "react";
import { updateCartItem, removeCartItem } from "../services/storeApi";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { useAuth } from "../context/AuthContext";
import { ArrowLeft, Share } from "lucide-react";
import CartItem from "../components/cart/CartItem";
import CartSummary from "../components/cart/CartSummary";

function Cart() {
  const navigate = useNavigate();
  const { cart, loading, refreshCart } = useCart();
  const { isAuthenticated } = useAuth();
  const [updatingKey, setUpdatingKey] = useState(null);

  const handleDecreaseQuantity = async (item) => {
    if (updatingKey) return;
    try {
      setUpdatingKey(item.key);
      if (item.quantity <= 1) {
        await removeCartItem(item.key);
      } else {
        await updateCartItem(item.key, item.quantity - 1);
      }
    } catch (err) {
      console.error("Cart decrease conflict handled:", err.response?.data || err.message);
    } finally {
      await refreshCart().catch(() => {});
      setUpdatingKey(null);
    }
  };

  const handleIncreaseQuantity = async (item) => {
    if (updatingKey) return;
    try {
      setUpdatingKey(item.key);
      await updateCartItem(item.key, item.quantity + 1);
    } catch (err) {
      console.error("Cart increase conflict handled:", err.response?.data || err.message);
    } finally {
      await refreshCart().catch(() => {});
      setUpdatingKey(null);
    }
  };

  const handleCheckout = () => {
    if (!isAuthenticated) {
      navigate("/login", { state: { from: "/checkout" } });
      return;
    }
    navigate("/checkout");
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-[15px] font-medium text-[#666666]">Loading cart...</div>
      </div>
    );
  }

  if (!cart || !cart.items || cart.items.length === 0) {
    return (
      <div className="mx-auto flex max-w-[700px] flex-col items-center justify-center px-6 py-20 text-center">
        <h1 className="mb-4 text-[24px] font-bold text-[#1E1E1E]">
          Your Cart is Empty
        </h1>
        <p className="mb-8 text-[#666666]">
          Looks like you haven&apos;t added anything to your cart yet.
        </p>
        <button
          onClick={() => navigate("/")}
          className="rounded-full bg-[#FF8A00] px-8 py-3.5 font-semibold text-white transition-all hover:bg-[#FF7300] active:scale-95 shadow-[0_4px_20px_rgba(255,138,0,0.2)]"
        >
          Start Shopping
        </button>
      </div>
    );
  }

  // Calculate values safely
  const discount = cart.totals?.total_discount
    ? Number(cart.totals.total_discount) / 100
    : 0;
  const delivery = cart.totals?.total_shipping
    ? Number(cart.totals.total_shipping) / 100
    : 0;
  const tax = cart.totals?.total_tax ? Number(cart.totals.total_tax) / 100 : 0;
  const total = Number(cart.totals.total_price) / 100;

  const itemsTotal = cart.totals?.total_items
    ? Number(cart.totals.total_items) / 100
    : cart.items.reduce(
        (acc, item) =>
          acc +
          (Number(item.totals?.line_subtotal) ||
            Number(item.totals?.line_total) ||
            0),
        0,
      ) / 100;

  return (
    <div className="mx-auto w-full max-w-[700px] pb-[120px] md:pt-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between rounded-[22px] bg-white px-4 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.03)] md:mb-6">
        <button
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="p-2 -ml-2 text-[#1E1E1E] transition-colors hover:bg-gray-50 rounded-full"
        >
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-[18px] font-bold text-[#1E1E1E]">My Cart</h1>
        <button
          aria-label="Share cart"
          className="p-2 -mr-2 text-[#1E1E1E] transition-colors hover:bg-gray-50 rounded-full"
        >
          <Share size={20} />
        </button>
      </div>

      <div className="space-y-5">
        {/* Product Items List */}
        <div className="space-y-4">
          {cart.items.map((item) => (
            <CartItem
              key={item.key}
              item={item}
              updatingKey={updatingKey}
              onDecrease={handleDecreaseQuantity}
              onIncrease={handleIncreaseQuantity}
            />
          ))}
        </div>

        {/* Bill Summary, Policies & Floating Bar */}
        <CartSummary
          cart={cart}
          itemsTotal={itemsTotal}
          discount={discount}
          delivery={delivery}
          tax={tax}
          total={total}
          onCheckout={handleCheckout}
        />
      </div>
    </div>
  );
}

export default Cart;
