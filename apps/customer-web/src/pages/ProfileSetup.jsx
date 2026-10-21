import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import API_URL from "../config/api.js";
import {
  User,
  MapPin,
  Home,
  Building2,
  Pencil,
  Trash2,
  Plus,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Calendar,
  ShieldCheck,
} from "lucide-react";
import {
  DELIVERY_REGIONS,
  isValidDeliveryRegion,
  isValidIndianPhone,
} from "../data/indianStates.js";
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";
import { useAuth } from "../context/AuthContext";

function ProfileSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const submittingRef = useRef(false);
  const { user, refreshUser, handleSessionExpired } = useAuth();

  const passedFirst = location.state?.first_name || "";
  const passedLast = location.state?.last_name || "";
  const isFromRegister = Boolean(location.state?.fromRegister || passedFirst);
  const initialName = user?.name || user?.full_name || "";
  const nameTokens = initialName.trim().split(/\s+/);
  const defaultFirst = passedFirst || user?.first_name || nameTokens[0] || "";
  const defaultLast = passedLast || user?.last_name || (nameTokens.length > 1 ? nameTokens.slice(1).join(" ") : "");
  const defaultPhone = user?.phone || user?.billing_phone || "";

  // Personal Information
  const [form, setForm] = useState({
    first_name: defaultFirst,
    last_name: defaultLast,
    age: "",
    phone: defaultPhone,
  });
  const [confirmPhone, setConfirmPhone] = useState(defaultPhone);

  // Saved Addresses from server
  const [addresses, setAddresses] = useState([]);

  // Active address entry form
  const [addressForm, setAddressForm] = useState({
    type: "home",
    address_line1: "",
    address_line2: "",
    city: "Vasai West",
    state: "MH",
  });

  // Whether user is currently adding/editing an address
  const [isEditingAddress, setIsEditingAddress] = useState(true);
  const [editingAddressId, setEditingAddressId] = useState(null);

  // If we already have initial user info (from register or AuthContext), render immediately without blocking spinner
  const [loading, setLoading] = useState(!Boolean(defaultFirst || user?.id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [errors, setErrors] = useState({});

  // Load existing profile & addresses on mount concurrently
  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        setLoading(true);

        const [profileResult, addressResult] = await Promise.allSettled([
          axios.get(`${API_URL}/profile`, {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
            timeout: 8000,
          }),
          axios.get(`${API_URL}/addresses`, {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
            timeout: 8000,
          }),
        ]);

        if (profileResult.status === "fulfilled") {
          const profileData = profileResult.value.data?.profile || {};
          const loadedPhone =
            profileResult.value.data?.billing_phone ||
            profileData.phone ||
            user?.phone ||
            "";

          const rawFullName = profileData.full_name || user?.name || user?.full_name || "";
          const tokens = rawFullName.trim().split(/\s+/);
          const initialFirst = profileData.first_name || passedFirst || user?.first_name || tokens[0] || "";
          const initialLast = profileData.last_name || passedLast || user?.last_name || (tokens.length > 1 ? tokens.slice(1).join(" ") : "");

          if (isMounted) {
            setForm((prev) => ({
              first_name: prev.first_name || initialFirst,
              last_name: prev.last_name || initialLast,
              age: profileData.age || prev.age || "",
              phone: loadedPhone || prev.phone || "",
            }));
            setConfirmPhone((prev) => prev || loadedPhone || "");
          }
        }

        if (addressResult.status === "fulfilled") {
          const loadedAddresses = addressResult.value.data?.addresses || [];
          if (isMounted) {
            setAddresses(loadedAddresses);
            if (loadedAddresses.length > 0) {
              setIsEditingAddress(false);
            } else {
              setIsEditingAddress(true);
            }
          }
        }

        // Only redirect to login if session was explicitly invalidated and user did not just register
        if (
          !isFromRegister &&
          profileResult.status === "rejected" &&
          profileResult.reason?.response?.status === 401 &&
          addressResult.status === "rejected" &&
          addressResult.reason?.response?.status === 401
        ) {
          if (handleSessionExpired) {
            handleSessionExpired();
          }
          navigate("/login", {
            replace: true,
            state: { from: location.pathname + location.search },
          });
          return;
        }
      } catch (error) {
        if (isMounted) {
          setMessage({
            type: "error",
            text: error.response?.data?.message || "Unable to load profile data.",
          });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadProfile();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleChange = (e) => {
    let { name, value } = e.target;
    if (name === "phone" || name === "confirm_phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }
    if (name === "confirm_phone") {
      setConfirmPhone(value);
      setErrors((prev) => {
        if (!prev.confirm_phone) return prev;
        const copy = { ...prev };
        delete copy.confirm_phone;
        return copy;
      });
      setMessage({ type: "", text: "" });
      return;
    }
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
    setErrors((prev) => {
      if (!prev[name] && !(name === "phone" && prev.confirm_phone)) return prev;
      const copy = { ...prev };
      delete copy[name];
      if (name === "phone") delete copy.confirm_phone;
      return copy;
    });
    setMessage({ type: "", text: "" });
  };

  const handleAddressChange = (e) => {
    const { name, value } = e.target;
    setAddressForm((prev) => ({
      ...prev,
      [name]: value,
    }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    setMessage({ type: "", text: "" });
  };

  const startEditAddress = (address) => {
    setEditingAddressId(address.id);
    setAddressForm({
      type: address.type || "home",
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "Vasai West",
      state: address.state || "MH",
    });
    setIsEditingAddress(true);
  };

  const startNewAddress = (type = "office") => {
    setEditingAddressId(null);
    setAddressForm({
      type,
      address_line1: "",
      address_line2: "",
      city: "Vasai West",
      state: "MH",
    });
    setIsEditingAddress(true);
  };

  const handleDeleteAddress = async (addressId) => {
    try {
      const response = await axios.delete(
        `${API_URL}/addresses/${addressId}`,
        {
          withCredentials: true,
          headers: { "X-Mumbai-Panel": "customer" },
        }
      );
      const remaining = response.data.addresses || [];
      setAddresses(remaining);
      if (remaining.length === 0) {
        setIsEditingAddress(true);
        setEditingAddressId(null);
      }
      setMessage({
        type: "success",
        text: "Address removed.",
      });
    } catch (error) {
      if (error.response?.status === 401) {
        if (handleSessionExpired) handleSessionExpired();
        navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
        return;
      }
      setMessage({
        type: "error",
        text: error.response?.data?.message || "Unable to delete address.",
      });
    }
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    if (submittingRef.current || saving) return;
    setMessage({ type: "", text: "" });

    // 1. Validate Personal Details
    const cleanFirst = normalizePersonName(form.first_name);
    const cleanLast = normalizePersonName(form.last_name);
    const cleanFullName = `${cleanFirst} ${cleanLast}`;
    const cleanPhone = form.phone.trim();

    const newErrors = {};

    if (!cleanFirst) {
      newErrors.first_name = "Please enter your First Name.";
    } else if (!isValidPersonName(cleanFirst)) {
      newErrors.first_name = "First name can only contain letters, spaces, hyphens, apostrophes, and periods.";
    }

    if (!cleanLast) {
      newErrors.last_name = "Please enter your Last Name.";
    } else if (!isValidPersonName(cleanLast)) {
      newErrors.last_name = "Last name can only contain letters, spaces, hyphens, apostrophes, and periods.";
    }

    if (!form.age || Number(form.age) < 13 || Number(form.age) > 120) {
      newErrors.age = "Please enter a valid age (13 to 120).";
    }

    if (!cleanPhone || !isValidIndianPhone(cleanPhone)) {
      newErrors.phone = "Please enter a valid 10-digit mobile number.";
    }

    if (isFromRegister && !confirmPhone) {
      newErrors.confirm_phone = "Please re-enter your mobile number.";
    } else if (isFromRegister && cleanPhone !== confirmPhone) {
      newErrors.confirm_phone = "Mobile numbers do not match.";
    }

    // 2. Validate Address Details
    const mustSaveAddress = addresses.length === 0 || isEditingAddress;

    if (mustSaveAddress) {
      if (!addressForm.address_line1.trim()) {
        newErrors.address_line1 = "Please enter your street address / flat number.";
      }

      if (!addressForm.city.trim() || !isValidDeliveryRegion(addressForm.city)) {
        newErrors.city =
          "Please select your delivery region (Vasai West, Vasai East, Nallasopara West, or Nallasopara East).";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setMessage({ type: "", text: "" });
      const errorKeys = ["first_name", "last_name", "age", "phone", "confirm_phone", "address_line1", "city"];
      const firstKey = errorKeys.find((k) => newErrors[k]);
      if (firstKey) {
        const inputElem = document.querySelector(`[name="${firstKey}"]`);
        if (inputElem) {
          inputElem.focus();
          inputElem.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return;
    }

    setErrors({});

    try {
      submittingRef.current = true;
      setSaving(true);

      // Save the profile first so server-side phone uniqueness checks run before any address is stored.
      await axios.put(
        `${API_URL}/profile`,
        {
          first_name: cleanFirst,
          last_name: cleanLast,
          full_name: cleanFullName,
          age: Number(form.age),
          phone: cleanPhone,
        },
        {
          withCredentials: true,
          headers: { "X-Mumbai-Panel": "customer" },
        }
      );

      // Save Address using personal name & phone automatically (no duplicate fields required)
      if (mustSaveAddress) {
        const addressPayload = {
          type: addressForm.type || "home",
          first_name: cleanFirst,
          last_name: cleanLast,
          full_name: cleanFullName,
          phone: cleanPhone,
          address_line1: addressForm.address_line1.trim(),
          address_line2: addressForm.address_line2.trim(),
          city: addressForm.city.trim(),
          state: "MH",
        };

        if (editingAddressId) {
          await axios.put(`${API_URL}/addresses/${editingAddressId}`, addressPayload, {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
          });
        } else {
          await axios.post(`${API_URL}/addresses`, addressPayload, {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
          });
        }
      }

      if (refreshUser) {
        await refreshUser();
      }

      setMessage({
        type: "success",
        text: "Account setup completed successfully!",
      });

      setTimeout(() => {
        navigate("/", {
          replace: true,
          state: { message: "Account setup completed successfully" },
        });
      }, 300);
    } catch (error) {
      if (error.response?.status === 401) {
        if (handleSessionExpired) {
          handleSessionExpired();
        }
        navigate("/login", {
          replace: true,
          state: { from: location.pathname + location.search },
        });
        return;
      }

      const serverMsg = error.response?.data?.message || "Unable to save profile.";
      const status = error.response?.status;
      const lower = serverMsg.toLowerCase();

      let targetField = null;
      if (
        status === 409 ||
        lower.includes("phone") ||
        lower.includes("mobile") ||
        lower.includes("number")
      ) {
        targetField = "phone";
      } else if (lower.includes("first name")) {
        targetField = "first_name";
      } else if (lower.includes("last name")) {
        targetField = "last_name";
      } else if (lower.includes("age")) {
        targetField = "age";
      } else if (
        lower.includes("street") ||
        lower.includes("flat") ||
        lower.includes("address")
      ) {
        targetField = "address_line1";
      } else if (lower.includes("city") || lower.includes("region")) {
        targetField = "city";
      }

      if (targetField) {
        setErrors((prev) => ({
          ...prev,
          [targetField]: serverMsg,
        }));
        setMessage({ type: "", text: "" });
        setTimeout(() => {
          const inputElem = document.querySelector(`[name="${targetField}"]`);
          if (inputElem) {
            inputElem.focus();
            inputElem.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 50);
      } else {
        setMessage({
          type: "error",
          text: serverMsg,
        });
      }
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-[#0B1425]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1E3252] border-t-[#42D6E8]" />
      </div>
    );
  }

  const hasHome = addresses.some((a) => a.type === "home");
  const hasOffice = addresses.some((a) => a.type === "office");

  return (
    <div className="min-h-screen bg-[#0B1425] text-[#F1F5F9] px-4 pt-4 pb-24 sm:px-6 sm:pt-6 md:pb-16">
      <div className="mx-auto max-w-xl space-y-4">
        {/* Top Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            aria-label="Back to Home"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#111F36] text-[#F1F5F9] shadow-xs border border-[#1E3252] transition-all hover:border-[#42D6E8]/50 hover:bg-[#162744] hover:text-[#42D6E8] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={18} strokeWidth={2.4} />
          </button>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-[#F1F5F9] sm:text-2xl">
              Account Setup
            </h1>
            <p className="text-xs font-medium text-[#8FA4BE]">
              Complete your details for fast delivery
            </p>
          </div>
        </div>

        {/* Status Toast */}
        {message.text && (
          <div
            className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-bold shadow-xs border animate-in fade-in duration-200 ${
              message.type === "error"
                ? "bg-rose-950/40 text-rose-300 border-rose-900/60"
                : "bg-[#132B45] text-emerald-300 border-emerald-500"
            }`}
          >
            {message.type === "error" ? (
              <AlertCircle size={16} className="shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* Main Card Container */}
          <div className="rounded-[22px] border border-[#1E3252]/80 bg-[#111F36] p-4.5 sm:p-6 shadow-lg space-y-5">
            {/* ──────────────────────────────────────────────────────── */}
            {/* 1. PERSONAL INFORMATION (Name, Age, Phone ONCE)         */}
            {/* ──────────────────────────────────────────────────────── */}
            <div className="space-y-3.5">
              <div className="flex items-center gap-2.5 border-b border-[#1E3252]/60 pb-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                  <User size={16} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-[#F1F5F9]">
                    Personal Information
                  </h2>
                  <p className="text-[11px] font-medium text-[#8FA4BE]">
                    Your name and contact for orders
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {/* First Name & Last Name */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${errors.first_name ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                      First Name <span className={errors.first_name ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                    </label>
                    <div className="relative">
                      <User
                        size={15}
                        className={`absolute left-3 top-1/2 -translate-y-1/2 ${errors.first_name ? "text-rose-400" : "text-[#6E84A3]"}`}
                      />
                      <input
                        type="text"
                        name="first_name"
                        autoComplete="given-name"
                        value={form.first_name}
                        onChange={handleChange}
                        required
                        className={`h-10 w-full rounded-xl border pl-9 pr-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                          errors.first_name
                            ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                            : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                        }`}
                      />
                    </div>
                    {errors.first_name && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                        <AlertCircle size={12} className="shrink-0 text-rose-400" />
                        <span>{errors.first_name}</span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={`mb-1 block text-xs font-bold ${errors.last_name ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                      Last Name <span className={errors.last_name ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                    </label>
                    <div className="relative">
                      <User
                        size={15}
                        className={`absolute left-3 top-1/2 -translate-y-1/2 ${errors.last_name ? "text-rose-400" : "text-[#6E84A3]"}`}
                      />
                      <input
                        type="text"
                        name="last_name"
                        autoComplete="family-name"
                        value={form.last_name}
                        onChange={handleChange}
                        required
                        className={`h-10 w-full rounded-xl border pl-9 pr-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                          errors.last_name
                            ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                            : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                        }`}
                      />
                    </div>
                    {errors.last_name && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                        <AlertCircle size={12} className="shrink-0 text-rose-400" />
                        <span>{errors.last_name}</span>
                      </p>
                    )}
                  </div>
                </div>

                {/* Age & Mobile Number */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${errors.age ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                      Age <span className={errors.age ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                    </label>
                    <div className="relative">
                      <Calendar
                        size={15}
                        className={`absolute left-3 top-1/2 -translate-y-1/2 ${errors.age ? "text-rose-400" : "text-[#6E84A3]"}`}
                      />
                      <input
                        type="number"
                        name="age"
                        value={form.age}
                        onChange={handleChange}
                        min="13"
                        max="120"
                        required
                        className={`h-10 w-full rounded-xl border pl-9 pr-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                          errors.age
                            ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                            : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                        }`}
                      />
                    </div>
                    {errors.age && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                        <AlertCircle size={12} className="shrink-0 text-rose-400" />
                        <span>{errors.age}</span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className={`mb-1 block text-xs font-bold ${errors.phone ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                      Mobile Number <span className={errors.phone ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                    </label>
                    <div className="relative flex items-center w-full">
                      <span
                        className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${
                          errors.phone ? "text-rose-400" : "text-[#6E84A3]"
                        }`}
                      >
                        +91
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        name="phone"
                        value={form.phone}
                        onChange={handleChange}
                        required
                        className={`h-10 w-full rounded-xl border pl-11 pr-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                          errors.phone
                            ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                            : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                        }`}
                      />
                    </div>
                    {errors.phone ? (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                        <AlertCircle size={12} className="shrink-0 text-rose-400" />
                        <span>{errors.phone}</span>
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-[#6E84A3] font-medium">
                        Used for delivery updates & order contact
                      </p>
                    )}
                  </div>

                  {isFromRegister && (
                    <div className="sm:col-span-2">
                      <label className={`mb-1 block text-xs font-bold ${errors.confirm_phone ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                        Confirm Mobile Number <span className={errors.confirm_phone ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                      </label>
                      <div className="relative flex items-center w-full">
                        <span
                          className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${
                            errors.confirm_phone ? "text-rose-400" : "text-[#6E84A3]"
                          }`}
                        >
                          +91
                        </span>
                        <input
                          type="tel"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={10}
                          name="confirm_phone"
                          value={confirmPhone}
                          onChange={handleChange}
                          required
                          aria-invalid={Boolean(errors.confirm_phone)}
                          className={`h-10 w-full rounded-xl border pl-11 pr-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                            errors.confirm_phone
                              ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                              : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                          }`}
                        />
                      </div>
                      {errors.confirm_phone ? (
                        <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                          <AlertCircle size={12} className="shrink-0 text-rose-400" />
                          <span>{errors.confirm_phone}</span>
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-[#6E84A3] font-medium">
                          Re-enter the same number to make sure it’s correct
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ──────────────────────────────────────────────────────── */}
            {/* 2. DELIVERY ADDRESS (Zero duplicate name/phone fields)   */}
            {/* ──────────────────────────────────────────────────────── */}
            <div className="space-y-3.5 pt-2">
              <div className="flex items-center justify-between border-b border-[#1E3252]/60 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                    <MapPin size={16} strokeWidth={2.2} />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-extrabold text-[#F1F5F9]">
                      Delivery Address
                    </h2>
                    <p className="text-[11px] font-medium text-[#8FA4BE]">
                      Where your orders will be delivered
                    </p>
                  </div>
                </div>

                <span className="rounded-full bg-[#132B45] text-[#67E8F9] border border-[#1E3252] px-2.5 py-0.5 text-[11px] font-bold">
                  Required
                </span>
              </div>

              {/* If existing addresses exist and user is not currently editing */}
              {addresses.length > 0 && !isEditingAddress ? (
                <div className="space-y-2.5">
                  {addresses.map((address) => {
                    const isHome = address.type === "home";
                    return (
                      <div
                        key={address.id}
                        className="rounded-xl border border-[#1E3252] bg-[#080F1C] p-3.5 transition hover:border-[#42D6E8]/50"
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#132B45] text-[#42D6E8] shadow-xs border border-[#1E3252]">
                              {isHome ? <Home size={15} /> : <Building2 size={15} />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-xs sm:text-sm font-extrabold text-[#F1F5F9] capitalize">
                                  {address.type} Address
                                </h4>
                                <span className="rounded bg-[#132B45] border border-[#1E3252] px-1.5 py-0.2 text-[9px] font-bold uppercase text-[#67E8F9]">
                                  Saved
                                </span>
                              </div>
                              <p className="text-xs font-medium text-[#8FA4BE] line-clamp-2 mt-0.5">
                                {address.address_line1}
                                {address.address_line2 ? `, ${address.address_line2}` : ""}
                                , {address.city}, Maharashtra
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEditAddress(address)}
                              className="flex h-7 px-2.5 items-center gap-1 rounded-lg bg-[#111F36] border border-[#1E3252] text-xs font-bold text-[#8FA4BE] hover:text-[#42D6E8] hover:border-[#42D6E8]/40 transition cursor-pointer"
                            >
                              <Pencil size={12} />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAddress(address.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#111F36] border border-[#1E3252] text-rose-400 hover:text-white hover:bg-rose-600 hover:border-rose-600 transition cursor-pointer"
                              title="Delete address"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* Add second address toggle if only 1 saved */}
                  <div className="flex gap-2 pt-1">
                    {!hasHome && (
                      <button
                        type="button"
                        onClick={() => startNewAddress("home")}
                        className="flex items-center gap-1.5 text-xs font-bold text-[#42D6E8] hover:underline cursor-pointer"
                      >
                        <Plus size={13} />
                        <span>Add Home Address</span>
                      </button>
                    )}
                    {!hasOffice && (
                      <button
                        type="button"
                        onClick={() => startNewAddress("office")}
                        className="flex items-center gap-1.5 text-xs font-bold text-[#42D6E8] hover:underline cursor-pointer"
                      >
                        <Plus size={13} />
                        <span>Add Office Address</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                /* Inline Address Fields */
                <div className="space-y-3">
                  {/* Address Type Toggle (Home / Office) */}
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-[#8FA4BE]">
                      Address Type
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setAddressForm((prev) => ({ ...prev, type: "home" }))}
                        className={`flex h-9.5 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                          addressForm.type === "home"
                            ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9] ring-2 ring-[#42D6E8]/20"
                            : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:bg-[#162744]"
                        }`}
                      >
                        <Home size={14} />
                        <span>Home</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAddressForm((prev) => ({ ...prev, type: "office" }))}
                        className={`flex h-9.5 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                          addressForm.type === "office"
                            ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9] ring-2 ring-[#42D6E8]/20"
                            : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:bg-[#162744]"
                        }`}
                      >
                        <Building2 size={14} />
                        <span>Office</span>
                      </button>
                    </div>
                  </div>

                  {/* Street Address */}
                  <div>
                    <label className={`mb-1 block text-xs font-bold ${errors.address_line1 ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                      Flat, Building, Street Address <span className={errors.address_line1 ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                    </label>
                    <input
                      type="text"
                      name="address_line1"
                      value={addressForm.address_line1}
                      onChange={handleAddressChange}
                      required
                      className={`h-10 w-full rounded-xl border px-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                        errors.address_line1
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                          : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                      }`}
                    />
                    {errors.address_line1 && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                        <AlertCircle size={12} className="shrink-0 text-rose-400" />
                        <span>{errors.address_line1}</span>
                      </p>
                    )}
                  </div>

                  {/* Landmark / Area */}
                  <div>
                    <label className="mb-1 block text-xs font-bold text-[#8FA4BE]">
                      Landmark / Area <span className="text-[#6E84A3] font-medium">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      name="address_line2"
                      value={addressForm.address_line2}
                      onChange={handleAddressChange}
                      className="h-10 w-full rounded-xl border border-[#1E3252] bg-[#080F1C] px-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                    />
                  </div>

                  {/* Delivery Region Selection (4 Zones) */}
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className={`block text-xs font-bold ${errors.city ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                        Delivery Region <span className={errors.city ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                      </label>
                      <span className="text-[10px] font-semibold text-[#6E84A3]">
                        Local delivery zones
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {DELIVERY_REGIONS.map((region) => {
                        const isSelected = addressForm.city?.toLowerCase() === region.toLowerCase();

                        return (
                          <button
                            key={region}
                            type="button"
                            onClick={() => {
                              setAddressForm((prev) => ({ ...prev, city: region }));
                              if (errors.city) {
                                setErrors((prev) => {
                                  const updated = { ...prev };
                                  delete updated.city;
                                  return updated;
                                });
                              }
                              setMessage({ type: "", text: "" });
                            }}
                            className={`flex h-10 items-center justify-center gap-1 rounded-xl border px-2 text-xs font-bold transition-all cursor-pointer active:scale-95 ${
                              isSelected
                                ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9] shadow-xs ring-2 ring-[#42D6E8]/20"
                                : errors.city
                                ? "border-rose-400 bg-rose-950/20 text-[#8FA4BE]"
                                : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:border-[#42D6E8]/40 hover:bg-[#162744]"
                            }`}
                          >
                            <MapPin size={13} className={isSelected ? "text-[#67E8F9]" : errors.city ? "text-rose-400" : "text-[#6E84A3]"} />
                            <span className="truncate">{region}</span>
                          </button>
                        );
                      })}
                    </div>
                    {errors.city && (
                      <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                        <AlertCircle size={12} className="shrink-0 text-rose-400" />
                        <span>{errors.city}</span>
                      </p>
                    )}
                  </div>

                  {/* State / Store Zone Badge */}
                  <div className="flex items-center justify-between rounded-xl border border-[#1E3252] bg-[#080F1C] px-3 py-2 text-xs font-bold text-[#8FA4BE]">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#F1F5F9]">Maharashtra</span>
                      <span className="text-[11px] font-semibold text-[#6E84A3]">(MH)</span>
                    </div>
                    <span className="rounded bg-[#132B45] border border-[#1E3252] px-2 py-0.5 text-[9px] font-extrabold text-[#67E8F9]">
                      Store Delivery Zone
                    </span>
                  </div>

                  {/* Cancel editing button if editing an existing address */}
                  {addresses.length > 0 && editingAddressId && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setIsEditingAddress(false);
                          setEditingAddressId(null);
                        }}
                        className="text-xs font-bold text-[#8FA4BE] hover:text-[#42D6E8] cursor-pointer"
                      >
                        Cancel Editing
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ──────────────────────────────────────────────────────── */}
          {/* SINGLE PRIMARY SAVE BUTTON                               */}
          {/* ──────────────────────────────────────────────────────── */}
          <div className="space-y-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] px-6 text-sm font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#061220]/30 border-t-[#061220]" />
                  <span>Saving Information...</span>
                </>
              ) : (
                <>
                  <span>Save Information & Continue</span>
                  <ArrowRight size={16} strokeWidth={2.4} />
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-1.5 text-center text-[11px] font-semibold text-[#6E84A3]">
              <ShieldCheck size={14} className="text-[#42D6E8] shrink-0" />
              <span>Your profile details are private & securely encrypted.</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProfileSetup;
