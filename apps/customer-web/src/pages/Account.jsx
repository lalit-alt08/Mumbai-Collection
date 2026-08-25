import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import API_URL from "../config/api.js";
import {
  User,
  ShoppingBag,
  Heart,
  MapPin,
  HelpCircle,
  ChevronRight,
  ArrowLeft,
  LogOut,
  Pencil,
  Package,
} from "lucide-react";

function Account() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const loadProfile = async () => {
      try {
        const res = await axios.get(`${API_URL}/profile`, {
          withCredentials: true,
        });
        if (isMounted && res.data?.profile) {
          setProfile(res.data.profile);
        }
      } catch (err) {
        // Fallback to user context
      }
    };
    loadProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  const username = user?.username || user?.display_name || "Customer";
  const fullName = profile?.full_name || user?.name || user?.display_name || "Customer";
  const avatarInitials =
    (fullName || username)
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "MC";

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FD] text-[#111827] px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-xl space-y-4 sm:space-y-5">
        {/* ────────────────────────────────────────────────────────── */}
        {/* TOP BAR / NAVIGATION                                       */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            aria-label="Back to Home"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-xs border border-gray-200 transition-all hover:border-[#7C3AED]/40 hover:bg-[#F5F3FF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={17} strokeWidth={2.4} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight text-[#111827] sm:text-2xl">
            My Account
          </h1>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* PROFILE HERO CARD (COMPACT & CLEAN)                        */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-[24px] border border-[#7C3AED]/20 bg-gradient-to-br from-[#FAF5FF] via-white to-[#F5F3FF] p-4 sm:p-5 shadow-[0_8px_30px_rgba(124,58,237,0.05)]">
          {/* Subtle Decorative Background Blur */}
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#7C3AED]/10 blur-2xl" />

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Avatar */}
              <div className="flex h-13 w-13 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#7C3AED] to-[#9333EA] text-white font-black text-xl shadow-[0_4px_16px_rgba(124,58,237,0.25)] ring-3 ring-white">
                {avatarInitials}
              </div>

              {/* Name & Username */}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-xl font-extrabold text-[#111827] tracking-tight truncate">
                  {username}
                </h2>
                <p className="text-xs sm:text-sm font-semibold text-[#4B5563] truncate mt-0.5">
                  {fullName}
                </p>
              </div>
            </div>

            {/* Edit Action Pill */}
            <button
              onClick={() => navigate("/account/profile")}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-white border border-[#7C3AED]/30 px-4 py-1.5 text-xs font-extrabold text-[#6D28D9] shadow-xs transition-all hover:bg-[#7C3AED] hover:text-white active:scale-95 cursor-pointer"
            >
              <Pencil size={13} />
              <span>Edit</span>
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* UNIFIED ACCOUNT HUB SECTION                                */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="px-1 text-xs font-extrabold tracking-wider uppercase text-[#6B7280]">
            Account & Preferences
          </div>

          <div className="overflow-hidden rounded-[22px] border border-gray-200/90 bg-white shadow-[0_4px_24px_rgba(0,0,0,0.03)] divide-y divide-gray-100">
            {/* 1. Personal Profile */}
            <button
              onClick={() => navigate("/account/profile")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FAF8FF] active:bg-[#F5F3FF] cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#6D28D9] transition-colors group-hover:bg-[#DDD6FE] group-hover:scale-105">
                  <User size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#111827] group-hover:text-[#6D28D9] transition-colors">
                    Personal Information
                  </h3>
                  <p className="text-xs font-semibold text-[#4B5563] mt-0.5">
                    Name, age, phone & security
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#6D28D9]"
              />
            </button>

            {/* 2. Orders */}
            <button
              onClick={() => navigate("/account/orders")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FAF8FF] active:bg-[#F5F3FF] cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#6D28D9] transition-colors group-hover:bg-[#DDD6FE] group-hover:scale-105">
                  <Package size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#111827] group-hover:text-[#6D28D9] transition-colors">
                    My Orders
                  </h3>
                  <p className="text-xs font-semibold text-[#4B5563] mt-0.5">
                    Track live deliveries & purchase history
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#6D28D9]"
              />
            </button>

            {/* 3. My Wishlist */}
            <button
              onClick={() => navigate("/account/favorites")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FAF8FF] active:bg-[#F5F3FF] cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-pink-100/70 text-pink-700 transition-colors group-hover:bg-pink-200/80 group-hover:scale-105">
                  <Heart size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#111827] group-hover:text-[#6D28D9] transition-colors">
                    My Wishlist
                  </h3>
                  <p className="text-xs font-semibold text-[#4B5563] mt-0.5">
                    Saved favorite products
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#6D28D9]"
              />
            </button>

            {/* 4. Saved Addresses */}
            <button
              onClick={() => navigate("/account/addresses")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FAF8FF] active:bg-[#F5F3FF] cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#6D28D9] transition-colors group-hover:bg-[#DDD6FE] group-hover:scale-105">
                  <MapPin size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#111827] group-hover:text-[#6D28D9] transition-colors">
                    Saved Addresses
                  </h3>
                  <p className="text-xs font-semibold text-[#4B5563] mt-0.5">
                    Home & Office delivery locations
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#6D28D9]"
              />
            </button>

            {/* 5. Customer Support */}
            <button
              onClick={() => navigate("/support")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FAF8FF] active:bg-[#F5F3FF] cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-100/70 text-amber-800 transition-colors group-hover:bg-amber-200/80 group-hover:scale-105">
                  <HelpCircle size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#111827] group-hover:text-[#6D28D9] transition-colors">
                    Help & Customer Support
                  </h3>
                  <p className="text-xs font-semibold text-[#4B5563] mt-0.5">
                    Contact store, FAQs & delivery help
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-gray-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#6D28D9]"
              />
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* LOGOUT ACTION CARD                                         */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="pt-1">
          <button
            onClick={handleLogout}
            className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-white px-5 py-3.5 text-sm font-bold text-red-600 shadow-xs transition-all hover:bg-red-50 hover:border-red-300 active:scale-[0.99] cursor-pointer"
          >
            <LogOut
              size={17}
              className="transition-transform group-hover:-translate-x-0.5 text-red-600"
            />
            <span>Log Out</span>
          </button>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* BRAND WATERMARK                                            */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="pt-4 pb-2 text-center">
          <p className="text-sm font-black tracking-widest text-[#1F2937] uppercase">
            Mumbai Collection
          </p>
          <p className="text-xs font-semibold text-[#4B5563] mt-1">
            Vasai Store • Fast Local Delivery
          </p>
        </div>
      </div>
    </div>
  );
}

export default Account;