import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import API_URL from "../config/api.js";
import safeStorage, { safeSessionStorage } from "../utils/safeStorage.js";
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
  Plus,
  Package,
  Home,
  Phone,
  Mail,
} from "lucide-react";
import { useNoIndex } from "../hooks/useNoIndex";
import { triggerHaptic } from "../utils/haptics";
import { setStorefrontTheme, useStorefrontTheme } from "../utils/storefrontTheme.js";

function Account() {
  useNoIndex();
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const theme = useStorefrontTheme();

  // Instant synchronous hydration from scoped session cache
  const [profileState, setProfileState] = useState(() => {
    // Purge legacy unscoped localStorage profile if present
    safeStorage.removeItem("user_profile");
    if (!user?.id) return { data: null, userId: null };
    const cached = safeSessionStorage.getJSON(`user_profile_${user.id}`, null);
    return { data: cached || null, userId: user.id };
  });

  const profile = profileState.userId === user?.id ? profileState.data : null;

  const [isProfileFetching, setIsProfileFetching] = useState(() => {
    if (!user?.id) return false;
    const cached = safeSessionStorage.getJSON(`user_profile_${user.id}`, null);
    return !cached && !user?.phone;
  });

  useEffect(() => {
    if (!user?.id) {
      setProfileState({ data: null, userId: null });
      setIsProfileFetching(false);
      return;
    }

    const currentUserId = user.id;
    const scopedKey = `user_profile_${currentUserId}`;
    const cached = safeSessionStorage.getJSON(scopedKey, null);
    // Unconditionally reset state to current user's cache or null on account switch
    setProfileState({ data: cached || null, userId: currentUserId });
    setIsProfileFetching(!cached && !user?.phone);

    let isMounted = true;
    const controller = new AbortController();

    const loadProfile = async () => {
      try {
        const res = await axios.get(`${API_URL}/profile`, {
          withCredentials: true,
          signal: controller.signal,
        });
        if (isMounted && res.data?.profile && user?.id === currentUserId) {
          setProfileState({ data: res.data.profile, userId: currentUserId });
          safeSessionStorage.setJSON(scopedKey, res.data.profile);
          if (updateUser) {
            updateUser({
              name: res.data.profile.full_name,
              full_name: res.data.profile.full_name,
              phone: res.data.profile.phone,
              email: res.data.profile.email || user?.email,
              is_google_user: res.data.profile.is_google_user ?? res.data.is_google_user ?? user?.is_google_user,
            });
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        // Fallback to user context
      } finally {
        if (isMounted) {
          setIsProfileFetching(false);
        }
      }
    };
    loadProfile();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [user?.id]);

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

  const rawPhone = (profile?.phone || user?.phone || "").trim();

  const formatPhoneNumber = (phone) => {
    if (!phone) return "";
    const clean = String(phone).replace(/\D/g, "");
    let national = clean;
    if (clean.length === 12 && clean.startsWith("91")) {
      national = clean.slice(2);
    } else if (clean.length === 11 && clean.startsWith("0")) {
      national = clean.slice(1);
    } else if (clean.length > 10) {
      national = clean.slice(-10);
    }

    if (national.length === 10) {
      return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
    }
    return phone.startsWith("+") ? phone : `+91 ${phone}`;
  };

  const formattedPhone = formatPhoneNumber(rawPhone);

  const displayEmail = (profile?.email || user?.email || "").trim();

  const isGoogleLinked =
    user?.is_google_user === true ||
    profile?.is_google_user === true ||
    Boolean(user?.google_id) ||
    Boolean(profile?.google_id);

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
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] px-4 pt-4 pb-28 sm:px-6 md:pt-8 md:pb-16">
      <div className="mx-auto max-w-xl space-y-4 sm:space-y-5">
        {/* ────────────────────────────────────────────────────────── */}
        {/* TOP BAR / NAVIGATION                                       */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2.5 sm:gap-3">
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
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-white border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule utilizing available space with clear typography and no inner pill */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E2E8F0] px-5 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.3)]">
            <h1 className="text-[19px] sm:text-[20px] font-extrabold text-[#1E293B] tracking-[-0.01em] leading-normal antialiased select-none">
              My Account
            </h1>
          </div>

          {/* Right: Circular Home Button */}
          <Link
            to="/"
            onClick={() => triggerHaptic("light")}
            aria-label="Home"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#22499F] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 hover:text-white active:scale-95 cursor-pointer"
          >
            <Home size={21} strokeWidth={2.2} />
          </Link>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* PROFILE HERO CARD (COMPACT & CLEAN - DUAL-ROW IDENTITY)    */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="account-hero relative overflow-hidden rounded-[24px] border border-[#E2E8F0]/80 bg-[#FFFFFF] p-4 sm:p-5 shadow-lg">
          {/* Subtle Decorative Background Glow */}
          <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[#22499F]/10 blur-2xl" />

          <div className="relative z-10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0">
              {/* Avatar */}
              <div className="account-avatar flex h-13 w-13 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#22499F] to-[#1B3B82] text-[#FFFFFF] font-black text-xl shadow-lg ring-2 ring-[#E2E8F0]">
                {avatarInitials}
              </div>

              {/* Name & Dual-Row Contact Details */}
              <div className="min-w-0 flex-1 space-y-1 sm:space-y-1.5">
                <h2 className="text-[19px] sm:text-[21px] font-black text-[#1E293B] tracking-[-0.015em] leading-snug truncate capitalize antialiased">
                  {displayName}
                </h2>

                {/* Primary Row: Phone Number or Add Phone CTA */}
                <div className="flex items-center gap-2 min-w-0">
                  <Phone size={13.5} className="shrink-0 text-[#22499F]" strokeWidth={2.2} />
                  {rawPhone ? (
                    <span className="text-[13.5px] sm:text-[14px] font-semibold text-[#64748B] tracking-[0.01em] truncate leading-tight antialiased">
                      {formattedPhone}
                    </span>
                  ) : isProfileFetching ? (
                    <div className="h-4 w-28 rounded bg-[#FFFFFF] animate-pulse" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate("/account/profile", { state: { edit: true, focusField: "phone" } })}
                      className="inline-flex items-center text-[12.5px] sm:text-[13px] font-bold text-[#22499F] hover:text-[#22499F] hover:underline transition-colors cursor-pointer antialiased"
                    >
                      <span>Add mobile number</span>
                    </button>
                  )}
                </div>

                {/* Secondary Row: Account Email */}
                {displayEmail && (
                  <div className="flex items-center gap-2 min-w-0">
                    <Mail size={13.5} className="shrink-0 text-[#64748B]" strokeWidth={2.2} />
                    <span className="text-[12.5px] sm:text-[13px] font-medium text-[#CBD5E1] tracking-[0.005em] truncate leading-tight antialiased">
                      {displayEmail}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Edit Action Pill */}
            <button
              onClick={() => navigate("/account/profile", { state: { edit: true } })}
              className="account-edit inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#FFFFFF] border border-[#E2E8F0] px-4 text-[13px] font-bold text-[#22499F] shadow-xs transition-all hover:bg-[#22499F] hover:text-[#FFFFFF] active:scale-95 cursor-pointer"
            >
              <Pencil size={15} aria-hidden="true" />
              <span>Edit</span>
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* UNIFIED ACCOUNT HUB SECTION                                */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="px-1 text-xs font-extrabold tracking-wider uppercase text-[#64748B]">
            Account & Preferences
          </div>

          <section className="store-theme-picker" aria-labelledby="store-theme-title">
            <div>
              <h2 id="store-theme-title">Appearance</h2>
              <p>Choose your theme.</p>
            </div>
            <div className="store-theme-options" role="group" aria-label="Store appearance">
              <button type="button" aria-pressed={theme === "light"} onClick={() => setStorefrontTheme("light")}>Light</button>
              <button type="button" aria-pressed={theme === "dark"} onClick={() => setStorefrontTheme("dark")}>Dark</button>
            </div>
          </section>

          <div className="account-menu overflow-hidden rounded-[22px] border border-[#E2E8F0]/80 bg-[#FFFFFF] shadow-lg divide-y divide-[#E2E8F0]/60">
            {/* 1. Personal Profile */}
            <button
              onClick={() => navigate("/account/profile")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FFFFFF] active:bg-[#E2E8F0]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] transition-colors group-hover:scale-105 border border-[#E2E8F0]">
                  <User size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#1E293B] group-hover:text-[#22499F] transition-colors">
                    Personal Information
                  </h3>
                  <p className="text-xs font-semibold text-[#64748B] mt-0.5">
                    Name, phone & security
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#22499F]"
              />
            </button>

            {/* 2. Orders */}
            <button
              onClick={() => navigate("/account/orders")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FFFFFF] active:bg-[#E2E8F0]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] transition-colors group-hover:scale-105 border border-[#E2E8F0]">
                  <Package size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#1E293B] group-hover:text-[#22499F] transition-colors">
                    My Orders
                  </h3>
                  <p className="text-xs font-semibold text-[#64748B] mt-0.5">
                    Track live deliveries & purchase history
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#22499F]"
              />
            </button>

            {/* 3. My Wishlist */}
            <button
              onClick={() => navigate("/account/favorites")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FFFFFF] active:bg-[#E2E8F0]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-pink-400 transition-colors group-hover:scale-105 border border-[#E2E8F0]">
                  <Heart size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#1E293B] group-hover:text-[#22499F] transition-colors">
                    My Wishlist
                  </h3>
                  <p className="text-xs font-semibold text-[#64748B] mt-0.5">
                    Saved favorite products
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#22499F]"
              />
            </button>

            {/* 4. Saved Addresses */}
            <button
              onClick={() => navigate("/account/addresses")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FFFFFF] active:bg-[#E2E8F0]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] transition-colors group-hover:scale-105 border border-[#E2E8F0]">
                  <MapPin size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#1E293B] group-hover:text-[#22499F] transition-colors">
                    Saved Addresses
                  </h3>
                  <p className="text-xs font-semibold text-[#64748B] mt-0.5">
                    Home & Office delivery locations
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#22499F]"
              />
            </button>

            {/* 5. Customer Support */}
            <button
              onClick={() => navigate("/support")}
              className="group flex w-full items-center justify-between p-4 transition-colors hover:bg-[#FFFFFF] active:bg-[#E2E8F0]/40 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-amber-400 transition-colors group-hover:scale-105 border border-[#E2E8F0]">
                  <HelpCircle size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#1E293B] group-hover:text-[#22499F] transition-colors">
                    Help & Customer Support
                  </h3>
                  <p className="text-xs font-semibold text-[#64748B] mt-0.5">
                    Contact store, FAQs & delivery help
                  </p>
                </div>
              </div>

              <ChevronRight
                size={17}
                className="text-[#64748B] transition-transform group-hover:translate-x-0.5 group-hover:text-[#22499F]"
              />
            </button>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* LOGOUT ACTION CARD                                         */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="pt-1">
          {!isGoogleLinked && (
            <div className="mb-3">
              <GoogleAuthButton mode="link" />
            </div>
          )}
          <button
            onClick={handleLogout}
            className="group flex w-full items-center justify-center gap-2 rounded-2xl border border-rose-900/60 bg-[#FFFFFF] px-5 py-3.5 text-sm font-bold text-rose-400 shadow-xs transition-all hover:bg-rose-950/40 hover:border-rose-800 active:scale-[0.99] cursor-pointer"
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
          <p className="text-sm font-black tracking-widest text-[#64748B] uppercase">
            Mumbai Collection
          </p>
        </div>
      </div>
    </div>
  );
}

export default Account;
