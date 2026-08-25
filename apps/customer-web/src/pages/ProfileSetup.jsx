import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import API_URL from "../config/api.js";
import {
  User,
  Phone,
  MapPin,
  Home,
  Building2,
  Pencil,
  Trash2,
  Plus,
  ArrowRight,
  X,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  ShieldCheck,
  Calendar,
} from "lucide-react";
import {
  DELIVERY_REGIONS,
  DEFAULT_STORE_STATE,
  isValidDeliveryRegion,
  isValidIndianPhone,
} from "../data/indianStates.js";

function ProfileSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const addressSectionRef = useRef(null);

  const [form, setForm] = useState({
    full_name: "",
    age: "",
    phone: "",
  });

  const [addresses, setAddresses] = useState([]);

  const [addressForm, setAddressForm] = useState({
    type: "home",
    full_name: "",
    phone: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "MH",
  });

  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [addressError, setAddressError] = useState("");

  // Load existing profile & addresses on mount
  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        setLoading(true);

        const response = await axios.get(`${API_URL}/profile`, {
          withCredentials: true,
        });

        const profileData = response.data.profile || {};

        if (isMounted) {
          setForm({
            full_name: profileData.full_name || "",
            age: profileData.age || "",
            phone: profileData.phone || "",
          });
        }

        const addressRes = await axios.get(`${API_URL}/addresses`, {
          withCredentials: true,
        });

        if (isMounted) {
          setAddresses(addressRes.data.addresses || []);
        }
      } catch (error) {
        console.error(
          "PROFILE LOAD ERROR:",
          error.response?.data || error.message
        );
        if (isMounted) {
          setMessage({
            type: "error",
            text:
              error.response?.data?.message || "Unable to load profile data.",
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
    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
    setMessage({ type: "", text: "" });
  };

  const handleAddressChange = (e) => {
    let { name, value } = e.target;
    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }
    setAddressForm((prev) => ({
      ...prev,
      [name]: value,
    }));
    setAddressError("");
  };

  const openAddressForm = (type) => {
    setEditingAddressId(null);
    setAddressError("");
    setAddressForm({
      type,
      full_name: form.full_name || "",
      phone: form.phone || "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "MH",
    });
    setShowAddressForm(true);
  };

  const editAddress = (address) => {
    setEditingAddressId(address.id);
    setAddressError("");
    setAddressForm({
      type: address.type,
      full_name: address.full_name || "",
      phone: address.phone || "",
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "",
      state: address.state || "MH",
    });
    setShowAddressForm(true);
  };

  const handleAddressSubmit = async () => {
    setAddressError("");

    if (!addressForm.full_name.trim()) {
      setAddressError("Please enter recipient's full name.");
      return;
    }

    if (!isValidIndianPhone(addressForm.phone)) {
      setAddressError(
        "Please enter a valid 10-digit mobile number for delivery."
      );
      return;
    }

    if (!addressForm.address_line1.trim()) {
      setAddressError("Please enter street address / house number.");
      return;
    }

    if (!addressForm.city.trim() || !isValidDeliveryRegion(addressForm.city)) {
      setAddressError(
        "Please select your delivery region (Vasai West, Vasai East, Nallasopara West, or Nallasopara East)."
      );
      return;
    }

    try {
      let response;
      if (editingAddressId) {
        response = await axios.put(
          `${API_URL}/addresses/${editingAddressId}`,
          addressForm,
          { withCredentials: true }
        );
      } else {
        response = await axios.post(`${API_URL}/addresses`, addressForm, {
          withCredentials: true,
        });
      }

      setAddresses(response.data.addresses || []);
      setShowAddressForm(false);
      setEditingAddressId(null);
      setMessage({
        type: "success",
        text: editingAddressId
          ? "Address updated successfully."
          : "Address added successfully.",
      });
    } catch (error) {
      console.error(
        "ADDRESS SAVE ERROR:",
        error.response?.data || error.message
      );
      setAddressError(
        error.response?.data?.message || "Unable to save address."
      );
    }
  };

  const handleDeleteAddress = async (addressId) => {
    try {
      const response = await axios.delete(
        `${API_URL}/addresses/${addressId}`,
        { withCredentials: true }
      );
      setAddresses(response.data.addresses || []);
      setMessage({
        type: "success",
        text: "Address removed successfully.",
      });
    } catch (error) {
      console.error(
        "ADDRESS DELETE ERROR:",
        error.response?.data || error.message
      );
      setMessage({
        type: "error",
        text: error.response?.data?.message || "Unable to delete address.",
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage({ type: "", text: "" });

    // 1. Personal Details Validation
    if (!form.full_name.trim()) {
      setMessage({
        type: "error",
        text: "Please enter your full name.",
      });
      return;
    }

    if (!form.age || Number(form.age) < 13 || Number(form.age) > 120) {
      setMessage({
        type: "error",
        text: "Please enter a valid age (13 - 120).",
      });
      return;
    }

    if (!isValidIndianPhone(form.phone)) {
      setMessage({
        type: "error",
        text: "Please enter a valid 10-digit mobile number.",
      });
      return;
    }

    // 2. Strict Address Requirement Check
    if (addresses.length === 0) {
      setMessage({
        type: "error",
        text: "Delivery Address Required: Please add at least one Home or Office address to complete your profile.",
      });

      if (addressSectionRef.current) {
        addressSectionRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      return;
    }

    try {
      setSaving(true);

      await axios.put(
        `${API_URL}/profile`,
        {
          full_name: form.full_name,
          age: Number(form.age),
          phone: form.phone,
        },
        { withCredentials: true }
      );

      setMessage({
        type: "success",
        text: "Profile setup completed successfully!",
      });

      setTimeout(() => {
        const destination = location.state?.from || "/";
        navigate(destination, { replace: true });
      }, 500);
    } catch (error) {
      console.error(
        "PROFILE SAVE ERROR:",
        error.response?.data || error.message
      );
      setMessage({
        type: "error",
        text: error.response?.data?.message || "Unable to save profile.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#F8F9FD]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-3 border-[#7C3AED]/20 border-t-[#7C3AED]" />
          <p className="text-xs font-bold text-gray-500">
            Loading profile setup...
          </p>
        </div>
      </div>
    );
  }

  const hasHome = addresses.some((a) => a.type === "home");
  const hasOffice = addresses.some((a) => a.type === "office");

  return (
    <div className="min-h-screen bg-[#F8F9FD] text-[#111827] px-4 pt-3 pb-28 sm:px-6 md:pt-6 md:pb-16">
      <div className="mx-auto max-w-4xl space-y-3.5 sm:space-y-4">
        {/* ────────────────────────────────────────────────────────── */}
        {/* COMPACT TOP BAR                                            */}
        {/* ────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            aria-label="Back to Home"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#1F2937] shadow-xs border border-gray-200 transition-all hover:border-[#7C3AED]/40 hover:bg-[#F5F3FF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={17} strokeWidth={2.4} />
          </button>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-[#111827] sm:text-xl md:text-2xl">
              Account Setup
            </h1>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────── */}
        {/* STATUS / ERROR NOTIFICATION TOAST                          */}
        {/* ────────────────────────────────────────────────────────── */}
        {message.text && (
          <div
            className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-bold shadow-xs border animate-in fade-in duration-200 ${
              message.type === "error"
                ? "bg-red-50 text-red-700 border-red-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
            }`}
          >
            {message.type === "error" ? (
              <AlertCircle size={16} className="shrink-0 text-red-600" />
            ) : (
              <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 sm:space-y-4">
          {/* Main 2-Column Responsive Layout for High Viewport Efficiency */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4 items-start">
            {/* ──────────────────────────────────────────────────────── */}
            {/* 1. PERSONAL INFORMATION CARD                            */}
            {/* ──────────────────────────────────────────────────────── */}
            <section className="rounded-[20px] border border-gray-200/90 bg-white p-4 sm:p-4.5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-3.5">
              <div className="flex items-center gap-2.5 border-b border-gray-100 pb-2.5">
                <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-[#EDE9FE] text-[#6D28D9]">
                  <User size={17} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-[#111827]">
                    Personal Information
                  </h2>
                  <p className="text-[11px] font-medium text-gray-500">
                    Contact details for deliveries
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {/* Full Name */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-700">
                    Full Name <span className="text-[#7C3AED]">*</span>
                  </label>
                  <div className="relative">
                    <User
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                      type="text"
                      name="full_name"
                      value={form.full_name}
                      onChange={handleChange}
                      placeholder="e.g. Rahul Sharma"
                      required
                      className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-9 pr-3 text-xs sm:text-sm font-semibold text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-3 focus:ring-[#7C3AED]/10"
                    />
                  </div>
                </div>

                {/* Age + Mobile Number: Side-by-side on desktop/tablets, stacked on mobile */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Age */}
                  <div>
                    <label className="mb-1 block text-xs font-bold text-gray-700">
                      Age <span className="text-[#7C3AED]">*</span>
                    </label>
                    <div className="relative">
                      <Calendar
                        size={15}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      />
                      <input
                        type="number"
                        name="age"
                        value={form.age}
                        onChange={handleChange}
                        placeholder="e.g. 25"
                        min="13"
                        max="120"
                        required
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-9 pr-3 text-xs sm:text-sm font-semibold text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-3 focus:ring-[#7C3AED]/10"
                      />
                    </div>
                  </div>

                  {/* Mobile Number */}
                  <div>
                    <label className="mb-1 block text-xs font-bold text-gray-700">
                      Mobile Number <span className="text-[#7C3AED]">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-500">
                        +91
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        maxLength={10}
                        name="phone"
                        value={form.phone}
                        onChange={handleChange}
                        placeholder="9876543210"
                        required
                        className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-11 pr-3 text-xs sm:text-sm font-semibold text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-3 focus:ring-[#7C3AED]/10"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* ──────────────────────────────────────────────────────── */}
            {/* 2. DELIVERY ADDRESSES CARD                              */}
            {/* ──────────────────────────────────────────────────────── */}
            <section
              ref={addressSectionRef}
              className={`rounded-[20px] border bg-white p-4 sm:p-4.5 shadow-[0_4px_20px_rgba(0,0,0,0.02)] space-y-3.5 transition-colors ${
                addresses.length === 0 && message.type === "error"
                  ? "border-red-300 ring-2 ring-red-100"
                  : "border-gray-200/90"
              }`}
            >
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg bg-[#EDE9FE] text-[#6D28D9]">
                    <MapPin size={17} strokeWidth={2.2} />
                  </div>
                  <div>
                    <h2 className="text-sm sm:text-base font-extrabold text-[#111827]">
                      Delivery Addresses
                    </h2>
                    <p className="text-[11px] font-medium text-gray-500">
                      Home & Office locations
                    </p>
                  </div>
                </div>

                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    addresses.length > 0
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}
                >
                  {addresses.length > 0
                    ? `${addresses.length}/2 Saved`
                    : "Required"}
                </span>
              </div>

              {/* Saved Address List */}
              {addresses.length > 0 ? (
                <div className="space-y-2">
                  {addresses.map((address) => {
                    const isHome = address.type === "home";
                    return (
                      <div
                        key={address.id}
                        className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 transition hover:border-[#C4B5FD]"
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#7C3AED] shadow-xs border border-purple-100">
                              {isHome ? (
                                <Home size={15} />
                              ) : (
                                <Building2 size={15} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <h4 className="text-xs sm:text-sm font-extrabold text-[#111827] capitalize">
                                  {address.type} Address
                                </h4>
                                <span className="rounded bg-emerald-100/70 px-1.5 py-0.2 text-[9px] font-bold uppercase text-emerald-800">
                                  Saved
                                </span>
                              </div>
                              <p className="text-xs font-bold text-gray-800 mt-0.5 truncate">
                                {address.full_name} • {address.phone}
                              </p>
                              <p className="text-xs font-medium text-gray-600 line-clamp-1 mt-0.5">
                                {address.address_line1}
                                {address.address_line2
                                  ? `, ${address.address_line2}`
                                  : ""}
                                , {address.city}, Maharashtra
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              onClick={() => editAddress(address)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-600 hover:text-[#7C3AED] hover:border-[#7C3AED]/40 transition cursor-pointer"
                              title="Edit address"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAddress(address.id)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-200 transition cursor-pointer"
                              title="Delete address"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-4 py-4 text-center">
                  <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#7C3AED] shadow-sm border border-purple-100">
                    <MapPin size={17} />
                  </div>
                  <h3 className="mt-2 text-xs sm:text-sm font-extrabold text-gray-800">
                    No address saved yet
                  </h3>
                  <p className="mx-auto mt-0.5 max-w-sm text-[11px] sm:text-xs font-semibold text-amber-800">
                    ⚠️ At least one delivery address is required.
                  </p>
                </div>
              )}

              {/* Add Address Action Buttons (Enforcing max 1 Home, 1 Office limit) */}
              <div className="grid grid-cols-2 gap-2.5 pt-0.5">
                {!hasHome && (
                  <button
                    type="button"
                    onClick={() => openAddressForm("home")}
                    className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#7C3AED]/30 bg-[#EDE9FE] text-xs font-extrabold text-[#6D28D9] transition hover:bg-[#DDD6FE] active:scale-95 cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>Add Home</span>
                  </button>
                )}
                {!hasOffice && (
                  <button
                    type="button"
                    onClick={() => openAddressForm("office")}
                    className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white text-xs font-bold text-gray-700 transition hover:border-[#7C3AED]/40 hover:bg-[#F5F3FF] hover:text-[#7C3AED] active:scale-95 cursor-pointer"
                  >
                    <Plus size={14} />
                    <span>Add Office</span>
                  </button>
                )}
              </div>
            </section>
          </div>

          {/* ──────────────────────────────────────────────────────── */}
          {/* INLINE ADDRESS FORM (SLIDE-IN ACCORDION)                 */}
          {/* ──────────────────────────────────────────────────────── */}
          {showAddressForm && (
            <section className="rounded-[20px] border border-[#7C3AED]/35 bg-white p-4 sm:p-4.5 shadow-[0_8px_30px_rgba(124,58,237,0.06)] space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EDE9FE] text-[#6D28D9]">
                    {addressForm.type === "home" ? (
                      <Home size={15} />
                    ) : (
                      <Building2 size={15} />
                    )}
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-extrabold text-[#111827]">
                      {editingAddressId ? "Edit Address" : "Add Delivery Address"}
                    </h3>
                    <p className="text-[11px] font-medium text-gray-500 capitalize">
                      {addressForm.type} address details
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddressForm(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              {addressError && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700 border border-red-200">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{addressError}</span>
                </div>
              )}

              <div className="grid gap-2.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-700">
                    Recipient Name <span className="text-[#7C3AED]">*</span>
                  </label>
                  <input
                    type="text"
                    name="full_name"
                    value={addressForm.full_name}
                    onChange={handleAddressChange}
                    placeholder="Full name"
                    required
                    className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 text-xs sm:text-sm font-semibold outline-none focus:border-[#7C3AED] focus:bg-white focus:ring-3 focus:ring-[#7C3AED]/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-700">
                    Mobile Number <span className="text-[#7C3AED]">*</span>
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-xs font-bold text-gray-400">
                      +91
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      name="phone"
                      value={addressForm.phone}
                      onChange={handleAddressChange}
                      placeholder="9876543210"
                      required
                      className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 pl-10 pr-3 text-xs sm:text-sm font-semibold outline-none focus:border-[#7C3AED] focus:bg-white focus:ring-3 focus:ring-[#7C3AED]/10"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-gray-700">
                    Address Line 1 (Flat, Building, Street){" "}
                    <span className="text-[#7C3AED]">*</span>
                  </label>
                  <input
                    type="text"
                    name="address_line1"
                    value={addressForm.address_line1}
                    onChange={handleAddressChange}
                    placeholder="e.g. Flat 402, Sunshine Heights, Station Road"
                    required
                    className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 text-xs sm:text-sm font-semibold outline-none focus:border-[#7C3AED] focus:bg-white focus:ring-3 focus:ring-[#7C3AED]/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-700">
                    Landmark / Area{" "}
                    <span className="text-gray-400 font-medium">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    name="address_line2"
                    value={addressForm.address_line2}
                    onChange={handleAddressChange}
                    placeholder="Near City Hospital"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50/50 px-3 text-xs sm:text-sm font-semibold outline-none focus:border-[#7C3AED] focus:bg-white focus:ring-3 focus:ring-[#7C3AED]/10"
                  />
                </div>

                {/* DELIVERY REGION (4 OPTIONS WITH SMOOTH SCROLL) */}
                <div className="sm:col-span-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className="block text-xs font-bold text-gray-700">
                      Delivery Region / Area <span className="text-[#7C3AED]">*</span>
                    </label>
                    <span className="text-[10px] font-semibold text-gray-400">
                      Local delivery zones
                    </span>
                  </div>

                  <div className="flex gap-2 overflow-x-auto pb-1 scroll-smooth no-scrollbar grid-cols-2 sm:grid sm:grid-cols-4">
                    {DELIVERY_REGIONS.map((region) => {
                      const isSelected = addressForm.city?.toLowerCase() === region.toLowerCase();

                      return (
                        <button
                          key={region}
                          type="button"
                          onClick={() => {
                            setAddressForm((prev) => ({
                              ...prev,
                              city: region,
                            }));
                            setAddressError("");
                          }}
                          className={`flex shrink-0 items-center justify-center gap-1 rounded-xl border-2 px-3 py-2 text-xs font-bold transition-all duration-200 cursor-pointer active:scale-95 ${
                            isSelected
                              ? "border-[#7C3AED] bg-[#F1ECFF] text-[#7C3AED] shadow-xs ring-2 ring-[#7C3AED]/20"
                              : "border-gray-200 bg-gray-50/70 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                          }`}
                        >
                          <MapPin size={13} className={isSelected ? "text-[#7C3AED]" : "text-gray-400"} />
                          <span className="whitespace-nowrap">{region}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* STATE (PERMANENTLY LOCKED TO MAHARASHTRA) */}
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-gray-700">
                    State
                  </label>
                  <div className="flex h-10 w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-100/90 px-3 text-xs font-bold text-gray-700">
                    <div className="flex items-center gap-1.5">
                      <span>Maharashtra</span>
                      <span className="text-[11px] font-semibold text-gray-400">(MH)</span>
                    </div>
                    <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[9px] font-extrabold text-emerald-800">
                      Store Delivery Zone
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddressForm(false)}
                  className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddressSubmit}
                  className="flex items-center gap-1.5 rounded-xl bg-[#7C3AED] px-4 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-[#6C35E8] active:scale-95 cursor-pointer"
                >
                  <CheckCircle2 size={14} />
                  <span>{editingAddressId ? "Update Address" : "Save Address"}</span>
                </button>
              </div>
            </section>
          )}

          {/* ──────────────────────────────────────────────────────── */}
          {/* PROMINENT COMPACT SAVE BUTTON DIRECTLY BELOW FORM        */}
          {/* ──────────────────────────────────────────────────────── */}
          <div className="space-y-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex h-11 sm:h-12 w-full items-center justify-center gap-2 rounded-xl sm:rounded-2xl bg-[#7C3AED] px-6 text-xs sm:text-sm font-extrabold text-white shadow-[0_6px_22px_rgba(124,58,237,0.28)] transition-all hover:bg-[#6C35E8] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              <span>{saving ? "Saving Information..." : "Save Information & Continue"}</span>
              {!saving && <ArrowRight size={16} strokeWidth={2.4} />}
            </button>

            {/* Security reassurance */}
            <div className="flex items-center justify-center gap-1.5 text-center text-[11px] sm:text-xs font-semibold text-gray-500">
              <ShieldCheck size={14} className="text-emerald-600 shrink-0" />
              <span>Your profile details are private & securely encrypted.</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProfileSetup;