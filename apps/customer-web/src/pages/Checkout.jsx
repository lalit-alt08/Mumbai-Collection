import { useEffect, useState } from "react";
import { getCart, getCheckout } from "../services/storeApi";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShoppingBag } from "lucide-react";
import BillingForm from "../components/checkout/BillingForm";

function Checkout() {
  const navigate = useNavigate();
  const [checkout, setCheckout] = useState(null);
  const [cart, setCart] = useState(null);

  useEffect(() => {
    const loadCheckout = async () => {
      try {
        const cartData = await getCart();
        setCart(cartData);

        const checkoutData = await getCheckout();
        setCheckout(checkoutData);
      } catch (error) {
        console.error(error);
      }
    };

    loadCheckout();
  }, []);

  if (!cart || !checkout) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-[15px] font-medium text-[#666666]">Loading secure checkout...</div>
      </div>
    );
  }

  const discount = cart.totals?.total_discount ? Number(cart.totals.total_discount) / 100 : 0;
  const delivery = cart.totals?.total_shipping ? Number(cart.totals.total_shipping) / 100 : 0;
  const tax = cart.totals?.total_tax ? Number(cart.totals.total_tax) / 100 : 0;
  const total = Number(cart.totals.total_price) / 100;
  const itemsTotal = cart.totals?.total_items ? Number(cart.totals.total_items) / 100 : 
    cart.items.reduce((acc, item) => acc + (Number(item.totals.line_subtotal) || Number(item.totals.line_total) || 0), 0) / 100;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 md:py-8 lg:px-8">
      
      {/* Header */}
      <div className="mb-6 flex items-center rounded-[20px] bg-white px-4 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.03)] md:mb-10 lg:w-fit lg:pr-8">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-[#1E1E1E] transition-colors hover:bg-gray-50 rounded-full">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-[18px] font-bold text-[#1E1E1E] ml-2">Checkout</h1>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-10">
        
        {/* LEFT - BILLING FORM */}
        <div className="lg:w-[60%] xl:w-[65%]">
          <BillingForm />
        </div>

        {/* RIGHT - ORDER SUMMARY */}
        <div className="lg:sticky lg:top-8 lg:w-[40%] xl:w-[35%]">
          <div className="rounded-[20px] border border-[#FFD9B3] bg-white p-6 shadow-[0_8px_30px_rgba(255,138,0,0.1)] transition-all hover:shadow-[0_12px_40px_rgba(255,138,0,0.15)]">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FF7300]">
                <ShoppingBag size={20} className="text-white" />
              </div>
              <h2 className="text-[18px] font-bold text-[#1E1E1E]">Order Summary</h2>
            </div>

            <div className="max-h-[300px] overflow-y-auto pr-2 space-y-4">
              {cart.items.map((item) => (
                <div key={item.key} className="flex items-center gap-4">
                  <div className="flex h-[64px] w-[64px] flex-shrink-0 items-center justify-center rounded-[12px] border border-[#ECECEC] bg-white p-1">
                    <img
                      src={item.images?.[0]?.src}
                      alt={item.name}
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="flex flex-1 flex-col">
                    <h3 className="line-clamp-2 text-[14px] font-semibold text-[#1E1E1E] leading-snug">
                      {item.name}
                    </h3>
                    <p className="mt-1 text-[13px] text-[#666666]">Qty: <span className="font-medium text-[#1E1E1E]">{item.quantity}</span></p>
                  </div>

                  <div className="font-bold text-[#1E1E1E] text-[15px]">
                    ₹{Number(item.totals.line_total) / 100}
                  </div>
                </div>
              ))}
            </div>

            <hr className="my-6 border-[#ECECEC]" />

            <div className="space-y-3.5 text-[14px] text-[#666666]">
              <div className="flex justify-between items-center">
                <span>Items Subtotal</span>
                <span className="font-medium text-[#1E1E1E]">₹{itemsTotal}</span>
              </div>
              
              {discount > 0 && (
                <div className="flex justify-between items-center text-blue-600">
                  <span>Discount</span>
                  <span className="font-medium">-₹{discount}</span>
                </div>
              )}

              <div className="flex justify-between items-center">
                <span>Delivery</span>
                {delivery === 0 ? (
                  <span className="font-bold text-[#FF8A00]">FREE</span>
                ) : (
                  <span className="font-medium text-[#1E1E1E]">₹{delivery}</span>
                )}
              </div>

              {tax > 0 && (
                <div className="flex justify-between items-center">
                  <span>Tax</span>
                  <span className="font-medium text-[#1E1E1E]">₹{tax}</span>
                </div>
              )}
            </div>
            
            <hr className="my-5 border-[#ECECEC]" />
            
            <div className="flex justify-between items-center">
              <span className="text-[16px] font-bold text-[#1E1E1E]">Grand Total</span>
              <span className="text-[24px] font-extrabold text-[#FF8A00]">₹{total}</span>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}

export default Checkout;
