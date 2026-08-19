import { useEffect, useState } from "react";
import API_URL from "../config/api.js";
import axios from "axios";
import { INDIAN_STATES, isValidIndianPhone, isValidIndianPincode } from "../data/indianStates.js";

const API = `${API_URL}/addresses`;
import {
  MapPin,
  Pencil,
  Trash2,
  Plus,
  Home,
  Building2,
  X,
  Loader2,
} from "lucide-react";

const emptyForm = {
  type: "home",
  full_name: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "MH",
  pincode: "",
};

function Addresses() {
  const [addresses, setAddresses] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [form, setForm] = useState(emptyForm);

  // --------------------------------------------------
  // LOAD ADDRESSES
  // --------------------------------------------------

  const loadAddresses = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await axios.get(API, {
        withCredentials: true,
      });

      setAddresses(response.data.addresses || []);
    } catch (error) {
      console.error(
        "ADDRESS LOAD ERROR:",
        error.response?.data || error.message
      );

      setError(
        error.response?.data?.message ||
          "Unable to load addresses."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAddresses();
  }, []);

  // --------------------------------------------------
  // FORM HANDLING
  // --------------------------------------------------

  const handleChange = (e) => {
    let { name, value } = e.target;

    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    } else if (name === "pincode") {
      value = value.replace(/\D/g, "").slice(0, 6);
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setFormError("");
  };

  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setShowForm(true);
  };

  const openEditForm = (address) => {
    setEditingId(address.id);

    setForm({
      type: address.type || "home",
      full_name: address.full_name || "",
      phone: address.phone || "",
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "",
      state: address.state || "MH",
      pincode: address.pincode || "",
    });

    setFormError("");
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
  };

  // --------------------------------------------------
  // ADD / UPDATE ADDRESS
  // --------------------------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault();

    setFormError("");

    if (!form.full_name.trim()) {
      setFormError("Please enter your full name.");
      return;
    }

    if (!isValidIndianPhone(form.phone)) {
      setFormError("Please enter a valid 10-digit Indian mobile number (e.g. 9876543210).");
      return;
    }

    if (!form.address_line1.trim()) {
      setFormError("Please enter your street address / house number.");
      return;
    }

    if (!form.city.trim()) {
      setFormError("Please enter your city.");
      return;
    }

    if (!form.state.trim()) {
      setFormError("Please select your state.");
      return;
    }

    if (!isValidIndianPincode(form.pincode)) {
      setFormError("Please enter a valid 6-digit Indian PIN code (e.g. 401202).");
      return;
    }

    try {
      setSaving(true);

      let response;

      if (editingId) {
        // UPDATE
        response = await axios.put(
          `${API}/${editingId}`,
          form,
          {
            withCredentials: true,
          }
        );
      } else {
        // CREATE
        response = await axios.post(
          API,
          form,
          {
            withCredentials: true,
          }
        );

      }

      // Refresh list from backend
      await loadAddresses();

      closeForm();
    } catch (error) {
      console.error(
        "❌ ADDRESS SAVE/UPDATE ERROR:",
        error.response?.data || error.message
      );

      setFormError(
        error.response?.data?.message ||
          "Unable to save address."
      );
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------
  // DELETE ADDRESS
  // --------------------------------------------------

  const handleDelete = async (id) => {
    const confirmed = window.confirm(
      "Are you sure you want to delete this address?"
    );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingId(id);
      setError("");

      const response = await axios.delete(
        `${API}/${id}`,
        {
          withCredentials: true,
        }
      );

      console.log(
        "✅ ADDRESS DELETED:",
        response.data
      );

      // Remove immediately from UI
      setAddresses((prev) =>
        prev.filter((address) => address.id !== id)
      );
    } catch (error) {
      console.error(
        "❌ ADDRESS DELETE ERROR:",
        error.response?.data || error.message
      );

      setError(
        error.response?.data?.message ||
          "Unable to delete address."
      );
    } finally {
      setDeletingId(null);
    }
  };

  // --------------------------------------------------
  // LOADING
  // --------------------------------------------------

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-[#F8F9F5]">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2
            size={20}
            className="animate-spin"
          />
          Loading addresses...
        </div>
      </div>
    );
  }

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="min-h-screen bg-[#F8F9F5] px-4 py-6 sm:px-5 md:px-10 md:py-10">
      <div className="mx-auto max-w-4xl">

        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-[30px] font-extrabold tracking-tight text-[#1E1E1E] md:text-[36px]">
            My Addresses
          </h1>

          <p className="mt-2 text-[15px] text-gray-500 md:text-[16px]">
            Manage your saved delivery addresses.
          </p>
        </div>

        {/* ERROR */}
        {error && (
          <div className="mb-6 rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-600">
            {error}
          </div>
        )}

        {/* ADD / EDIT FORM */}
        {showForm && (
          <div className="mb-8 rounded-3xl border border-[#FFD9B3] bg-white p-5 shadow-sm md:p-7">

            {/* FORM HEADER */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-[#1E1E1E]">
                  {editingId
                    ? "Edit Address"
                    : "Add New Address"}
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  {editingId
                    ? "Update your saved delivery address."
                    : "Add an address for faster checkout."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeForm}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200"
              >
                <X size={19} />
              </button>
            </div>

            {/* FORM ERROR */}
            {formError && (
              <div className="mb-5 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-600">
                {formError}
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="space-y-5"
            >

              {/* ADDRESS TYPE */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Address Type
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        type: "home",
                      }))
                    }
                    className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 font-semibold transition ${
                      form.type === "home"
                        ? "border-[#FF8A00] bg-orange-50 text-[#FF8A00]"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    <Home size={18} />
                    Home
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        type: "office",
                      }))
                    }
                    className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 font-semibold transition ${
                      form.type === "office"
                        ? "border-[#FF8A00] bg-orange-50 text-[#FF8A00]"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    <Building2 size={18} />
                    Office
                  </button>
                </div>
              </div>

              {/* NAME + PHONE */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    Full Name *
                  </label>

                  <input
                    name="full_name"
                    value={form.full_name}
                    onChange={handleChange}
                    placeholder="e.g. Rahul Sharma"
                    required
                    className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    Mobile Number *
                  </label>

                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-sm font-bold text-gray-500">
                      +91
                    </span>
                    <input
                      name="phone"
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={form.phone}
                      onChange={handleChange}
                      placeholder="9876543210"
                      required
                      className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-sm outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
                    />
                  </div>
                </div>
              </div>

              {/* ADDRESS LINE 1 */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Address Line 1 *
                </label>

                <input
                  name="address_line1"
                  value={form.address_line1}
                  onChange={handleChange}
                  placeholder="Flat / House no., building, street"
                  required
                  className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
                />
              </div>

              {/* ADDRESS LINE 2 */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Address Line 2
                  <span className="ml-1 font-normal text-gray-400">
                    (Optional)
                  </span>
                </label>

                <input
                  name="address_line2"
                  value={form.address_line2}
                  onChange={handleChange}
                  placeholder="Landmark, area name"
                  className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
                />
              </div>

              {/* CITY STATE PINCODE */}
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    City *
                  </label>

                  <input
                    name="city"
                    value={form.city}
                    onChange={handleChange}
                    placeholder="e.g. Vasai / Mumbai"
                    required
                    className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    State *
                  </label>

                  <select
                    name="state"
                    value={form.state}
                    onChange={handleChange}
                    required
                    className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-medium text-gray-800 outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
                  >
                    {INDIAN_STATES.map((state) => (
                      <option key={state.code} value={state.code}>
                        {state.name} ({state.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    PIN Code *
                  </label>

                  <input
                    name="pincode"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={form.pincode}
                    onChange={handleChange}
                    placeholder="6-digit PIN"
                    required
                    className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
                  />
                </div>
              </div>

              {/* FORM BUTTONS */}
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="h-12 rounded-xl border border-gray-200 px-6 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#FF8A00] px-7 text-sm font-bold text-white shadow-sm transition hover:bg-[#FF7300] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving && (
                    <Loader2
                      size={17}
                      className="animate-spin"
                    />
                  )}

                  {saving
                    ? "Saving..."
                    : editingId
                    ? "Update Address"
                    : "Save Address"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* SAVED ADDRESSES */}
        {addresses.length === 0 ? (
          <div className="rounded-3xl bg-white p-8 text-center shadow-sm md:p-12">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50">
              <MapPin
                size={30}
                className="text-[#FF8A00]"
              />
            </div>

            <h2 className="text-xl font-bold text-[#1E1E1E]">
              No saved addresses
            </h2>

            <p className="mt-2 text-gray-500">
              Add an address to make checkout faster.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {addresses.map((address) => {
              const isHome =
                address.type === "home";

              return (
                <div
                  key={address.id}
                  className="rounded-3xl bg-white p-5 shadow-sm transition hover:shadow-md md:p-6"
                >

                  {/* CARD HEADER */}
                  <div className="mb-5 flex items-start justify-between gap-3">

                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-orange-50">
                        {isHome ? (
                          <Home
                            size={23}
                            className="text-[#FF8A00]"
                          />
                        ) : (
                          <Building2
                            size={23}
                            className="text-[#FF8A00]"
                          />
                        )}
                      </div>

                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-extrabold text-[#1E1E1E]">
                            {isHome
                              ? "Home"
                              : "Office"}
                          </h2>

                          <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold text-green-600">
                            SAVED
                          </span>
                        </div>

                        <p className="mt-1 text-sm text-gray-500">
                          Delivery address
                        </p>
                      </div>
                    </div>

                    {/* ACTION BUTTONS */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          openEditForm(address)
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:border-[#FF8A00] hover:bg-orange-50 hover:text-[#FF8A00]"
                        title="Edit address"
                      >
                        <Pencil size={17} />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleDelete(address.id)
                        }
                        disabled={
                          deletingId === address.id
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:border-red-500 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                        title="Delete address"
                      >
                        {deletingId ===
                        address.id ? (
                          <Loader2
                            size={17}
                            className="animate-spin"
                          />
                        ) : (
                          <Trash2 size={17} />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* ADDRESS INFORMATION */}
                  <div className="border-t border-gray-100 pt-5">

                    <p className="font-bold text-[#1E1E1E]">
                      {address.full_name}
                    </p>

                    <p className="mt-1 text-gray-500">
                      {address.phone}
                    </p>

                    <div className="mt-4 text-[15px] leading-6 text-gray-600">
                      <p>
                        {address.address_line1}
                      </p>

                      {address.address_line2 && (
                        <p>
                          {address.address_line2}
                        </p>
                      )}

                      <p>
                        {address.city},{" "}
                        {address.state} -{" "}
                        {address.pincode}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ADD ADDRESS BUTTON — BOTTOM */}
        {!showForm && (
          <div className="mt-8 flex justify-center pb-8">
            <button
              type="button"
              onClick={openAddForm}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#FF8A00] px-6 py-4 text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(255,138,0,0.2)] transition hover:bg-[#FF7300] active:scale-[0.98] sm:w-auto sm:min-w-[220px]"
            >
              <Plus size={19} />
              Add Address
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default Addresses;