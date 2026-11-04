import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import API_URL from "../config/api.js";
import safeStorage from "../utils/safeStorage.js";
import GoogleAuthButton from "../components/auth/GoogleAuthButton.jsx";
import {
  User,
  Heart,
  MapPin,
  HelpCircle,
  ChevronRight,
  ArrowLeft,
  ChevronLeft,
  LogOut,
  Pencil,
  Package,
} from "lucide-react";
import { useNoIndex } from "../hooks/useNoIndex";
import { triggerHaptic } from "../utils/haptics";

function Account() {
  useNoIndex();
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();

  // Instant synchronous hydration from cache to prevent any flashing
  const [profile, setProfile] = useState(() => {
    return safeStorage.getJSON("user_profile", null);
  });

  useEffect(() => {
    let isMounted = true;
    const loadProfile = async () => {
      try {
        const res = await axios.get(`${API_URL}/profile`, {
          withCredentials: true,
        });
        if (isMounted && res.data?.profile) {
          setProfile(res.data.profile);
          safeStorage.setJSON("user_profile", res.data.profile);
          if (updateUser && res.data.profile.full_name) {
            updateUser({
              name: res.data.profile.full_name,
              full_name: res.data.profile.full_name,
              phone: res.data.profile.phone,
            });
          }
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

  const isStoreName = (str) => {
    if (!str || typeof str !== "string") return true;
    const s = str.trim().toLowerCase();
    return s === "mumbaicollection" || s === "mumbai collection" || s === "mumbai_collection";
  };

  const displayName =
    (!isStoreName(profile?.full_name) ? profile?.full_name?.trim() : "") ||
    (!isStoreName(user?.full_name) ? user?.full_name?.trim() : "") ||
    (!isStoreName(user?.name) ? user?.name?.trim() : "") ||
    (!isStoreName(user?.username) ? user?.username?.trim() : "") ||
    "Customer";

  const displayContact =
    profile?.phone?.trim() ||
    user?.phone?.trim() ||
    profile?.email?.trim() ||
    user?.email?.trim() ||
    "";

  const avatarInitials =
    displayName
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "MC";

  const handleLogout = async () => {
    try {
      const result = await logout();
      if (!result?.server_revocation_confirmed) {
        window.alert("You have been signed out on this device, but the server could not confirm logout. Please contact support if you need to secure your account.");
      }
    } finally {
      navigate("/", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1425] text-[#F1F5F9] px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-xl space-y-4 sm:space-y-5">
        {/* ────────────────────────────────────────────────────────── */}
        {/* TOP BAR / NAVIGATION                                       */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Left: Circular Back Button */}
          <button
            onClick={() => {
              triggerHaptic("light");
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                navigate("/");
              }
            }}
            aria-label="Back"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#122038]/90 backdrop-blur-md text-white border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#1A2E4C] hover:border-white/20 active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule utilizing available space with clear typography and no inner pill */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#122038]/95 backdrop-blur-md border border-white/12 px-5 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.3)]">
            <h1 className="text-[19px] sm:text-[20px] font-extrabold text-white tracking-[-0.01em] leading-normal antialiased select-none">
              My Account
            </h1>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* PROFILE HERO CARD (COMPACT & CLEAN)                        */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-[24px] border border-[#1E3252]/80 bg-[#111F36] p-4 sm:p-5 shadow-lg">
          {/* Subtle Decorative Background Glow */}
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#42D6E8]/10 blur-2xl" />

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Avatar */}
              <div className="flex h-13 w-13 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#42D6E8] to-[#2CC4D8] text-[#061220] font-black text-xl shadow-lg ring-2 ring-[#1E3252]">
                {avatarInitials}
              </div>

              {/* Name & Contact Details */}
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-xl font-extrabold text-[#F1F5F9] tracking-tight truncate capitalize">
                  {displayName}
                </h2>
                {displayContact && (
                  <p className="text-xs sm:text-sm font-semibold text-[#8FA4BE] truncate mt-0.5">
                    {displayContact}
                  </p>
                )}
              </div>
            </div>

            {/* Edit Action Pill */}
            <button
              onClick={() => navigate("/account/profile")}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#132B45] border border-[#1E3252] px-4 py-1.5 text-xs font-extrabold text-[#67E8F9] shadow-xs transition-all hover:bg-[#42D6E8] hover:text-[#061220] active:scale-95 cursor-pointer"
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
          <div className="px-1 text-xs font-extrabold tracking-wider uppercase text-[#8FA4BE]">
            Account & Preferences
          </div>

          <div className="overflow-hidden rounded-[22px] border border-[#1E3252]/80 bg-[#111F36] shadow-lg divide-y divide-[#1E3252]/60">
            {/* 1. Personal Profile */}
            <button
              onClick={() => navigate("/account/profile")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#162744] active:bg-[#1E3252]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] transition-colors group-hover:scale-105 border border-[#1E3252]">
                  <User size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#F1F5F9] group-hover:text-[#42D6E8] transition-colors">
                    Personal Information
                  </h3>
                  <p className="text-xs font-semibold text-[#8FA4BE] mt-0.5">
                    Name, phone & security
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#6E84A3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#42D6E8]"
              />
            </button>

            {/* 2. Orders */}
            <button
              onClick={() => navigate("/account/orders")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#162744] active:bg-[#1E3252]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] transition-colors group-hover:scale-105 border border-[#1E3252]">
                  <Package size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#F1F5F9] group-hover:text-[#42D6E8] transition-colors">
                    My Orders
                  </h3>
                  <p className="text-xs font-semibold text-[#8FA4BE] mt-0.5">
                    Track live deliveries & purchase history
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#6E84A3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#42D6E8]"
              />
            </button>

            {/* 3. My Wishlist */}
            <button
              onClick={() => navigate("/account/favorites")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#162744] active:bg-[#1E3252]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-pink-400 transition-colors group-hover:scale-105 border border-[#1E3252]">
                  <Heart size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#F1F5F9] group-hover:text-[#42D6E8] transition-colors">
                    My Wishlist
                  </h3>
                  <p className="text-xs font-semibold text-[#8FA4BE] mt-0.5">
                    Saved favorite products
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#6E84A3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#42D6E8]"
              />
            </button>

            {/* 4. Saved Addresses */}
            <button
              onClick={() => navigate("/account/addresses")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#162744] active:bg-[#1E3252]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] transition-colors group-hover:scale-105 border border-[#1E3252]">
                  <MapPin size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#F1F5F9] group-hover:text-[#42D6E8] transition-colors">
                    Saved Addresses
                  </h3>
                  <p className="text-xs font-semibold text-[#8FA4BE] mt-0.5">
                    Home & Office delivery locations
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#6E84A3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#42D6E8]"
              />
            </button>

            {/* 5. Customer Support */}
            <button
              onClick={() => navigate("/support")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#162744] active:bg-[#1E3252]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-amber-400 transition-colors group-hover:scale-105 border border-[#1E3252]">
                  <HelpCircle size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#F1F5F9] group-hover:text-[#42D6E8] transition-colors">
                    Help & Customer Support
                  </h3>
                  <p className="text-xs font-semibold text-[#8FA4BE] mt-0.5">
                    Contact store, FAQs & delivery help
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#6E84A3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#42D6E8]"
              />
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* LOGOUT ACTION CARD                                         */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="pt-1">
          <div className="mb-3"><GoogleAuthButton mode="link" /></div>
          <button
            onClick={handleLogout}
            className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-900/60 bg-[#111F36] px-5 py-3.5 text-sm font-bold text-rose-400 shadow-xs transition-all hover:bg-rose-950/40 hover:border-rose-800 active:scale-[0.99] cursor-pointer"
          >
            <LogOut
              size={17}
              className="transition-transform group-hover:-translate-x-0.5 text-rose-400"
            />
            <span>Log Out</span>
          </button>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* BRAND WATERMARK                                            */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="pt-4 pb-2 text-center">
          <p className="text-sm font-black tracking-widest text-[#6E84A3] uppercase">
            Mumbai Collection
          </p>
        </div>
      </div>
    </div>
  );
}

export default Account;
