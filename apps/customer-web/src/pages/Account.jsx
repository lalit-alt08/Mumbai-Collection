import {
  ChevronRight,
  User,
  ShoppingBag,
  MessageCircle,
  MapPin,
} from "lucide-react";

import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function Account() {
  const { user, logout } = useAuth();
const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white font-sans text-[#1E1E1E] md:bg-[#F8F9F5] md:py-12 md:px-4">
      {/* Container for Desktop Centering */}
      <div className="mx-auto min-h-screen w-full bg-white shadow-sm md:min-h-fit md:max-w-4xl md:rounded-[24px] md:border md:border-gray-100 md:shadow-[0_10px_40px_rgba(0,0,0,0.04)]">

        <div className="px-5 pb-12 pt-8 md:px-24 md:py-16">
          
          {/* Profile Section */}
          <div className="mb-10 flex items-center gap-4 md:mb-16 md:gap-8">
            <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-[#E8D9F6] text-[#7A3EBE] md:h-[120px] md:w-[120px]">
              <User fill="currentColor" strokeWidth={1} className="mt-1 h-9 w-9 md:h-[60px] md:w-[60px]" />
            </div>
            <div>
              <h2 className="text-[20px] font-bold text-black md:text-[32px]">
                {user?.name || "Customer"}
              </h2>
              <p className="mt-0.5 text-[15px] font-medium text-gray-500 md:mt-2 md:text-[18px]">
                {user?.email || "+91 9876543210"}
              </p>
            </div>
          </div>

          {/* Menu Items */}
          <div className="mb-12 flex flex-col gap-7 md:mb-16 md:gap-10">
            <button
              onClick={() => navigate("/account/profile")}
              className="group flex items-center justify-between"
            >
              <div className="flex items-center gap-4 md:gap-6">
                <User strokeWidth={1.5} className="h-[22px] w-[22px] text-black md:h-[28px] md:w-[28px]" />
                <span className="text-[15px] font-medium text-black md:text-[20px]">Profile</span>
              </div>
              <ChevronRight strokeWidth={2} className="h-[18px] w-[18px] text-[#FF7A00] transition-transform group-hover:translate-x-1 md:h-[24px] md:w-[24px]" />
            </button>

            <button
              onClick={() => navigate("/account/orders")}
              className="group flex items-center justify-between"
            >
              <div className="flex items-center gap-4 md:gap-6">
                <ShoppingBag strokeWidth={1.5} className="h-[22px] w-[22px] text-black md:h-[28px] md:w-[28px]" />
                <span className="text-[15px] font-medium text-black md:text-[20px]">Orders</span>
              </div>
              <ChevronRight strokeWidth={2} className="h-[18px] w-[18px] text-[#FF7A00] transition-transform group-hover:translate-x-1 md:h-[24px] md:w-[24px]" />
            </button>

            <button
              onClick={() => navigate("/support")}
              className="group flex items-center justify-between"
            >
              <div className="flex items-center gap-4 md:gap-6">
                <MessageCircle strokeWidth={1.5} className="h-[22px] w-[22px] text-black md:h-[28px] md:w-[28px]" />
                <span className="text-[15px] font-medium text-black md:text-[20px]">Customer Support</span>
              </div>
              <ChevronRight strokeWidth={2} className="h-[18px] w-[18px] text-[#FF7A00] transition-transform group-hover:translate-x-1 md:h-[24px] md:w-[24px]" />
            </button>

            <button
              onClick={() => navigate("/account/addresses")}
              className="group flex items-center justify-between"
            >
              <div className="flex items-center gap-4 md:gap-6">
                <MapPin strokeWidth={1.5} className="h-[22px] w-[22px] text-black md:h-[28px] md:w-[28px]" />
                <span className="text-[15px] font-medium text-black md:text-[20px]">Saved Addresses</span>
              </div>
              <ChevronRight strokeWidth={2} className="h-[18px] w-[18px] text-[#FF7A00] transition-transform group-hover:translate-x-1 md:h-[24px] md:w-[24px]" />
            </button>
          </div>

          {/* Logout Button */}
          <div className="mb-10 flex justify-center md:mb-16">
            <button
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="rounded-xl border border-[#FF7A00] bg-white px-10 py-2.5 text-[15px] font-bold text-[#FF7A00] transition hover:bg-orange-50 active:scale-95 md:rounded-2xl md:px-14 md:py-3.5 md:text-[18px]"
            >
              Log Out
            </button>
          </div>

          {/* Brand Footer */}
          <div className="flex justify-center opacity-40">
            <span className="text-[28px] font-bold lowercase tracking-tight text-gray-400 md:text-[40px]">
              Mumbai collection
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}

export default Account;