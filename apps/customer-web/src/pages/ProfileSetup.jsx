import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  User,
  Phone,
  MapPin,
  Home,
  BriefcaseBusiness,
  Pencil,
  Trash2,
  Plus,
  ArrowRight,
  X,
  CheckCircle2,
} from "lucide-react";
import API_URL from "../config/api.js";
import { INDIAN_STATES, isValidIndianPhone, isValidIndianPincode } from "../data/indianStates.js";

function ProfileSetup() {
  const navigate = useNavigate();
  const location = useLocation();

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
    pincode: "",
  });

  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loadProfile = async () => {
      try {
        setLoading(true);

        const response = await axios.get(
          `${API_URL}/profile`,
          {
            withCredentials: true,
          },
        );

        const profileData = response.data.profile || {};

        setForm({
          full_name: profileData.full_name || "",
          age: profileData.age || "",
          phone: profileData.phone || "",
        });

        const addressRes = await axios.get(
          `${API_URL}/addresses`,
          {
            withCredentials: true,
          },
        );

        setAddresses(addressRes.data.addresses || []);
      } catch (error) {
        console.error(
          "❌ PROFILE LOAD ERROR:",
          error.response?.data || error.message,
        );

        setMessage(
          error.response?.data?.message ||
            "Unable to load profile.",
        );
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
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
  };

  const handleAddressChange = (e) => {
    let { name, value } = e.target;

    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    } else if (name === "pincode") {
      value = value.replace(/\D/g, "").slice(0, 6);
    }

    setAddressForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const openAddressForm = (type) => {
    setEditingAddressId(null);

    setAddressForm({
      type,
      full_name: form.full_name || "",
      phone: form.phone || "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "MH",
      pincode: "",
    });

    setShowAddressForm(true);
  };

  const editAddress = (address) => {
    setEditingAddressId(address.id);

    setAddressForm({
      type: address.type,
      full_name: address.full_name || "",
      phone: address.phone || "",
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "",
      state: address.state || "MH",
      pincode: address.pincode || "",
    });

    setShowAddressForm(true);
  };

  const handleAddressSubmit = async () => {
    setMessage("");

    if (!addressForm.full_name.trim()) {
      setMessage("Please enter recipient's full name.");
      return;
    }

    if (!isValidIndianPhone(addressForm.phone)) {
      setMessage("Please enter a valid 10-digit mobile number for delivery.");
      return;
    }

    if (!addressForm.address_line1.trim()) {
      setMessage("Please enter street address / house number.");
      return;
    }

    if (!addressForm.city.trim()) {
      setMessage("Please enter city.");
      return;
    }

    if (!isValidIndianPincode(addressForm.pincode)) {
      setMessage("Please enter a valid 6-digit Indian PIN code (e.g. 401202).");
      return;
    }

    try {
      let response;

      if (editingAddressId) {
        response = await axios.put(
          `${API_URL}/addresses/${editingAddressId}`,
          addressForm,
          {
            withCredentials: true,
          },
        );
      } else {
        response = await axios.post(
          `${API_URL}/addresses`,
          addressForm,
          {
            withCredentials: true,
          },
        );
      }

      setAddresses(response.data.addresses || []);

      setShowAddressForm(false);
      setEditingAddressId(null);

      setMessage(
        editingAddressId
          ? "Address updated successfully."
          : "Address saved successfully.",
      );
    } catch (error) {
      console.error(
        "❌ ADDRESS SAVE/UPDATE ERROR:",
        error.response?.data || error.message,
      );

      setMessage(
        error.response?.data?.message ||
          "Unable to save address.",
      );
    }
  };

  const handleDeleteAddress = async (addressId) => {
    try {
      setMessage("");

      const response = await axios.delete(
        `${API_URL}/addresses/${addressId}`,
        {
          withCredentials: true,
        },
      );

      setAddresses(response.data.addresses || []);

      setMessage("Address deleted successfully.");
    } catch (error) {
      console.error(
        "❌ ADDRESS DELETE ERROR:",
        error.response?.data || error.message,
      );

      setMessage(
        error.response?.data?.message ||
          "Unable to delete address.",
      );
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    setMessage("");

    if (!form.full_name.trim()) {
      setMessage("Please enter your full name.");
      return;
    }

    if (!isValidIndianPhone(form.phone)) {
      setMessage("Please enter a valid 10-digit mobile number (e.g. 9876543210).");
      return;
    }

    try {
      setSaving(true);

      const response = await axios.put(
        `${API_URL}/profile`,
        {
          full_name: form.full_name,
          age: Number(form.age),
          phone: form.phone,
        },
        {
          withCredentials: true,
        },
      );

      setMessage("Profile saved successfully.");

      setTimeout(() => {
        const destination = location.state?.from || "/";
        navigate(destination, { replace: true });
      }, 500);
    } catch (error) {
      console.error(
        "❌ PROFILE SAVE ERROR:",
        error.response?.data || error.message,
      );

      setMessage(
        error.response?.data?.message ||
          "Unable to save profile.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#F7F7FB]">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-[#7C3AED]" />
          <p className="text-sm font-medium text-gray-500">
            Loading your profile...
          </p>
        </div>
      </div>
    );
  }

  const hasHome = addresses.some(
    (address) => address.type === "home",
  );

  const hasOffice = addresses.some(
    (address) => address.type === "office",
  );

  return (
    <div className="min-h-screen bg-[#F7F7FB] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">

        {/* Header */}
        <div className="mb-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#F1ECFF] px-3 py-1.5 text-xs font-bold text-[#7C3AED]">
            <User size={14} />
            ACCOUNT SETUP
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight text-[#1E1E1E] sm:text-4xl">
            Complete your profile
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500 sm:text-base">
            Add your personal details and at least one delivery
            address to make checkout faster and easier.
          </p>
        </div>

        <form onSubmit={handleSubmit}>

          {/* Main Grid */}
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">

            {/* Personal Information */}
            <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)] sm:p-8">
              <div className="mb-7 flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F1ECFF] text-[#7C3AED]">
                  <User size={21} />
                </div>

                <div>
                  <h2 className="text-lg font-extrabold text-[#1E1E1E]">
                    Personal Information
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
                    Tell us a little about yourself.
                  </p>
                </div>
              </div>

              <div className="space-y-5">

                {/* Full Name */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    Full Name
                    <span className="ml-1 text-[#7C3AED]">*</span>
                  </label>

                  <div className="relative">
                    <User
                      size={18}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                    />

                    <input
                      type="text"
                      name="full_name"
                      value={form.full_name}
                      onChange={handleChange}
                      placeholder="Enter your full name"
                      required
                      className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-sm text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                    />
                  </div>
                </div>

                {/* Age + Phone */}
                <div className="grid gap-5 sm:grid-cols-2">

                  <div>
                    <label className="mb-2 block text-sm font-bold text-gray-700">
                      Age
                      <span className="ml-1 text-[#7C3AED]">*</span>
                    </label>

                    <input
                      type="number"
                      name="age"
                      value={form.age}
                      onChange={handleChange}
                      placeholder="Your age"
                      min="13"
                      max="120"
                      required
                      className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 text-sm text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-gray-700">
                      Mobile Number
                      <span className="ml-1 text-[#7C3AED]">*</span>
                    </label>

                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">
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
                        className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-14 pr-4 text-sm text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                      />
                    </div>
                  </div>

                </div>
              </div>
            </section>

            {/* Addresses */}
            <section className="rounded-3xl border border-gray-100 bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.04)] sm:p-8">

              <div className="mb-7 flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F1ECFF] text-[#7C3AED]">
                    <MapPin size={21} />
                  </div>

                  <div>
                    <h2 className="text-lg font-extrabold text-[#1E1E1E]">
                      Delivery Addresses
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                      Add where you'd like your orders delivered.
                    </p>
                  </div>
                </div>
              </div>

              {/* Address Cards */}
              {addresses.length > 0 ? (
                <div className="space-y-4">
                  {addresses.map((address) => {
                    const isHome = address.type === "home";

                    return (
                      <div
                        key={address.id}
                        className="rounded-2xl border border-gray-200 bg-gray-50 p-5 transition hover:border-[#C4B5FD]"
                      >
                        <div className="flex items-start justify-between gap-4">

                          <div className="flex min-w-0 items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#7C3AED] shadow-sm">
                              {isHome ? (
                                <Home size={19} />
                              ) : (
                                <BriefcaseBusiness size={19} />
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-extrabold text-[#1E1E1E]">
                                  {isHome
                                    ? "Home"
                                    : "Office"}
                                </h3>

                                <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-600">
                                  Saved
                                </span>
                              </div>

                              <p className="mt-2 text-sm font-semibold text-gray-700">
                                {address.full_name}
                              </p>

                              <p className="mt-1 text-sm text-gray-500">
                                {address.phone}
                              </p>

                              <p className="mt-2 text-sm leading-6 text-gray-600">
                                {address.address_line1}
                                {address.address_line2 &&
                                  `, ${address.address_line2}`}
                              </p>

                              <p className="text-sm text-gray-600">
                                {address.city},{" "}
                                {address.state} -{" "}
                                {address.pincode}
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                editAddress(address)
                              }
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 transition hover:border-[#C4B5FD] hover:text-[#7C3AED]"
                              title="Edit address"
                            >
                              <Pencil size={16} />
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteAddress(
                                  address.id,
                                )
                              }
                              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-500 transition hover:border-red-200 hover:text-red-500"
                              title="Delete address"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-gray-400 shadow-sm">
                    <MapPin size={21} />
                  </div>

                  <h3 className="mt-4 font-bold text-gray-800">
                    No saved addresses
                  </h3>

                  <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
                    Add a Home or Office address. At least one
                    address is required.
                  </p>
                </div>
              )}

              {/* Add Address Buttons */}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">

                {!hasHome && (
                  <button
                    type="button"
                    onClick={() => openAddressForm("home")}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-[#C4B5FD] bg-[#F1ECFF] text-sm font-bold text-[#7C3AED] transition hover:bg-[#E0D4FC]"
                  >
                    <Plus size={18} />
                    Add Home
                  </button>
                )}

                {!hasOffice && (
                  <button
                    type="button"
                    onClick={() => openAddressForm("office")}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white text-sm font-bold text-gray-700 transition hover:border-[#C4B5FD] hover:text-[#7C3AED]"
                  >
                    <Plus size={18} />
                    Add Office
                  </button>
                )}

              </div>
            </section>
          </div>

          {/* Address Form */}
          {showAddressForm && (
            <section className="mt-6 rounded-3xl border border-[#C4B5FD]/40 bg-white p-6 shadow-[0_8px_30px_rgba(0,0,0,0.05)] sm:p-8">

              <div className="mb-7 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F1ECFF] text-[#7C3AED]">
                    {addressForm.type === "home" ? (
                      <Home size={21} />
                    ) : (
                      <BriefcaseBusiness size={21} />
                    )}
                  </div>

                  <div>
                    <h2 className="text-lg font-extrabold text-[#1E1E1E]">
                      {editingAddressId
                        ? "Edit Address"
                        : "Add Address"}
                    </h2>

                    <p className="mt-1 text-sm text-gray-500">
                      {addressForm.type === "home"
                        ? "Home address"
                        : "Office address"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setShowAddressForm(false)
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
                >
                  <X size={19} />
                </button>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">

                {/* Full Name */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    Full Name
                    <span className="ml-1 text-[#7C3AED]">*</span>
                  </label>

                  <input
                    type="text"
                    name="full_name"
                    value={addressForm.full_name}
                    onChange={handleAddressChange}
                    required
                    className="h-13 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    Mobile Number
                    <span className="ml-1 text-[#7C3AED]">*</span>
                  </label>

                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-sm font-bold text-gray-400">
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
                      className="h-13 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                    />
                  </div>
                </div>

                {/* Address Line 1 */}
                <div className="sm:col-span-2">
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    Address Line 1
                    <span className="ml-1 text-[#7C3AED]">*</span>
                  </label>

                  <input
                    type="text"
                    name="address_line1"
                    value={addressForm.address_line1}
                    onChange={handleAddressChange}
                    placeholder="Flat / House number, building, street"
                    required
                    className="h-13 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  />
                </div>

                {/* Address Line 2 */}
                <div className="sm:col-span-2">
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    Address Line 2
                    <span className="ml-2 text-xs font-medium text-gray-400">
                      Optional
                    </span>
                  </label>

                  <input
                    type="text"
                    name="address_line2"
                    value={addressForm.address_line2}
                    onChange={handleAddressChange}
                    placeholder="Landmark, area name"
                    className="h-13 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  />
                </div>

                {/* City */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    City
                    <span className="ml-1 text-[#7C3AED]">*</span>
                  </label>

                  <input
                    type="text"
                    name="city"
                    value={addressForm.city}
                    onChange={handleAddressChange}
                    placeholder="e.g. Vasai / Mumbai"
                    required
                    className="h-13 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  />
                </div>

                {/* State */}
                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    State
                    <span className="ml-1 text-[#7C3AED]">*</span>
                  </label>

                  <select
                    name="state"
                    value={addressForm.state}
                    onChange={handleAddressChange}
                    required
                    className="h-13 w-full rounded-2xl border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-800 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  >
                    {INDIAN_STATES.map((state) => (
                      <option key={state.code} value={state.code}>
                        {state.name} ({state.code})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Pincode */}
                <div className="sm:max-w-xs">
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    PIN Code
                    <span className="ml-1 text-[#7C3AED]">*</span>
                  </label>

                  <input
                    type="text"
                    name="pincode"
                    value={addressForm.pincode}
                    onChange={handleAddressChange}
                    placeholder="6-digit PIN"
                    maxLength={6}
                    inputMode="numeric"
                    required
                    className="h-13 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  />
                </div>
              </div>

              {/* Address Form Buttons */}
              <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">

                <button
                  type="button"
                  onClick={() =>
                    setShowAddressForm(false)
                  }
                  className="h-12 rounded-2xl border border-gray-200 bg-white px-6 text-sm font-bold text-gray-600 transition hover:bg-gray-50"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleAddressSubmit}
                  className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] px-7 text-sm font-bold text-white shadow-[0_6px_18px_rgba(124,58,237,0.2)] transition hover:bg-[#6C35E8] active:scale-[0.98]"
                >
                  <CheckCircle2 size={17} />
                  {editingAddressId
                    ? "Update Address"
                    : "Save Address"}
                </button>

              </div>
            </section>
          )}

          {/* Bottom Action */}
          <div className="mt-6 rounded-3xl border border-gray-100 bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] sm:flex sm:items-center sm:justify-between sm:p-6">

            <div className="mb-4 flex items-start gap-3 sm:mb-0">
              <CheckCircle2
                size={20}
                className="mt-0.5 shrink-0 text-green-500"
              />

              <div>
                <p className="text-sm font-bold text-gray-800">
                  Your information is secure
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  We'll use these details to make your
                  checkout faster.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] px-7 text-sm font-extrabold text-white shadow-[0_8px_22px_rgba(124,58,237,0.22)] transition hover:bg-[#6C35E8] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving
                ? "Saving..."
                : "Save & Continue"}

              {!saving && <ArrowRight size={18} />}
            </button>
          </div>

        </form>

        {/* Status Message */}
        {message && (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-5 py-4 text-sm font-semibold text-gray-700 shadow-sm">
            <CheckCircle2
              size={18}
              className="shrink-0 text-green-500"
            />
            {message}
          </div>
        )}

      </div>
    </div>
  );
}

export default ProfileSetup;