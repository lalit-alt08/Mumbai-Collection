import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API_URL from "../config/api.js";
import axios from "axios";
import {
  DELIVERY_REGIONS,
  DEFAULT_STORE_STATE,
  isValidDeliveryRegion,
  isValidIndianPhone,
} from "../data/indianStates.js";
import ConfirmModal from "../components/common/ConfirmModal.jsx";

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
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

const emptyForm = {
  type: "home",
  full_name: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "MH",
};

function Addresses() {
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Custom confirmation modal state
  const [addressToDelete, setAddressToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Status feedback toast/banner
  const [feedback, setFeedback] = useState({ type: "", message: "" });
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
      setFeedback({ type: "", message: "" });

      const response = await axios.get(API, {
        withCredentials: true,
      });

      setAddresses(response.data.addresses || []);
    } catch (error) {
      console.error(
        "ADDRESS LOAD ERROR:",
        error.response?.data || error.message
      );

      setFeedback({
        type: "error",
        message:
          error.response?.data?.message ||
          "Unable to load addresses. Please refresh and try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAddresses();
  }, []);

  // --------------------------------------------------
  // STRICT CAPACITY & TYPE AVAILABILITY
  // --------------------------------------------------

  const hasHome = addresses.some((a) => a.type?.toLowerCase() === "home");
  const hasOffice = addresses.some((a) => a.type?.toLowerCase() === "office");
  const canAddAddress = !hasHome || !hasOffice;

  // Types available for current form mode (Create vs Edit)
  const isHomeAvailable = !editingId
    ? !hasHome
    : !addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "home");

  const isOfficeAvailable = !editingId
    ? !hasOffice
    : !addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "office");

  // --------------------------------------------------
  // FORM HANDLING
  // --------------------------------------------------

  const handleChange = (e) => {
    let { name, value } = e.target;

    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setFormError("");
  };

  const openAddForm = () => {
    if (!canAddAddress) return;

    // Automatically default to the remaining available type
    const defaultType = !hasHome ? "home" : "office";

    setEditingId(null);
    setForm({
      ...emptyForm,
      type: defaultType,
    });
    setFormError("");
    setFeedback({ type: "", message: "" });
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
    });

    setFormError("");
    setFeedback({ type: "", message: "" });
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

    if (!form.type || (form.type !== "home" && form.type !== "office")) {
      setFormError("Please select a valid address type.");
      return;
    }

    // Client-side validation guarding against duplicate type
    if (!editingId && form.type === "home" && hasHome) {
      setFormError("A Home address is already saved. You can only add an Office address.");
      return;
    }

    if (!editingId && form.type === "office" && hasOffice) {
      setFormError("An Office address is already saved. You can only add a Home address.");
      return;
    }

    if (
      editingId &&
      form.type === "home" &&
      addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "home")
    ) {
      setFormError("Another Home address is already saved.");
      return;
    }

    if (
      editingId &&
      form.type === "office" &&
      addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "office")
    ) {
      setFormError("Another Office address is already saved.");
      return;
    }

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

    if (!form.city.trim() || !isValidDeliveryRegion(form.city)) {
      setFormError("Please select your delivery region (Vasai West, Vasai East, Nallasopara West, or Nallasopara East).");
      return;
    }

    try {
      setSaving(true);

      if (editingId) {
        // UPDATE
        await axios.put(
          `${API}/${editingId}`,
          form,
          {
            withCredentials: true,
          }
        );
        setFeedback({
          type: "success",
          message: `${form.type === "home" ? "Home" : "Office"} address updated successfully!`,
        });
      } else {
        // CREATE
        await axios.post(
          API,
          form,
          {
            withCredentials: true,
          }
        );
        setFeedback({
          type: "success",
          message: `${form.type === "home" ? "Home" : "Office"} address saved successfully!`,
        });
      }

      // Auto dismiss success toast after 4s
      setTimeout(() => {
        setFeedback((prev) => (prev.type === "success" ? { type: "", message: "" } : prev));
      }, 4000);

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
  // DELETE ADDRESS (CUSTOM IN-APP MODAL)
  // --------------------------------------------------

  const handlePromptDelete = (address) => {
    setAddressToDelete(address);
  };

  const handleConfirmDelete = async () => {
    if (!addressToDelete || isDeleting) return;

    try {
      setIsDeleting(true);
      setFeedback({ type: "", message: "" });

      await axios.delete(
        `${API}/${addressToDelete.id}`,
        {
          withCredentials: true,
        }
      );

      // Remove immediately from UI
      setAddresses((prev) =>
        prev.filter((address) => address.id !== addressToDelete.id)
      );

      setFeedback({
        type: "success",
        message: `${addressToDelete.type === "home" ? "Home" : "Office"} address deleted successfully.`,
      });

      setAddressToDelete(null);

      // Auto dismiss success feedback
      setTimeout(() => {
        setFeedback((prev) => (prev.type === "success" ? { type: "", message: "" } : prev));
      }, 4000);
    } catch (error) {
      console.error(
        "❌ ADDRESS DELETE ERROR:",
        error.response?.data || error.message
      );

      setFeedback({
        type: "error",
        message:
          error.response?.data?.message ||
          "Unable to delete address. Please try again.",
      });
    } finally {
      setIsDeleting(false);
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
            className="animate-spin text-[#7C3AED]"
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
    <div className="min-h-screen bg-[#F7F7FB] px-4 py-6 sm:px-5 md:px-10 md:py-10 pb-28 sm:pb-16">
      <div className="mx-auto max-w-4xl">

        {/* HEADER */}
        <div className="mb-6 flex items-center gap-3.5 sm:mb-8">
          <button
            onClick={() => {
              if (window.history.state && window.history.state.idx > 0) {
                navigate(-1);
              } else {
                navigate("/account", { replace: true });
              }
            }}
            aria-label="Back to Account"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm border border-gray-200/80 transition hover:bg-[#7C3AED] hover:text-white hover:border-[#7C3AED] cursor-pointer active:scale-95"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-[26px] font-extrabold tracking-tight text-[#1E1E1E] sm:text-[32px]">
              My Addresses
            </h1>
            <p className="text-xs text-gray-500 font-medium sm:text-sm">
              Manage your saved delivery addresses.
            </p>
          </div>
        </div>

        {/* FEEDBACK TOAST / BANNER */}
        {feedback.message && (
          <div
            className={`mb-6 flex items-center justify-between gap-3 rounded-2xl p-4 text-sm font-semibold animate-[slideUp_0.2s_ease-out] ${
              feedback.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200/80"
                : "bg-red-50 text-red-700 border border-red-200/80"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {feedback.type === "success" ? (
                <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle size={18} className="shrink-0 text-red-500" />
              )}
              <span>{feedback.message}</span>
            </div>

            <button
              type="button"
              onClick={() => setFeedback({ type: "", message: "" })}
              className="rounded-lg p-1 text-gray-400 hover:text-gray-600 transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* ADD / EDIT FORM */}
        {showForm && (
          <div className="mb-8 rounded-3xl border border-[#C4B5FD]/40 bg-white p-5 shadow-sm md:p-7 animate-[slideUp_0.25s_ease-out]">

            {/* FORM HEADER */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-extrabold text-[#1E1E1E]">
                  {editingId
                    ? "Edit Address"
                    : `Add ${!hasHome ? "Home" : "Office"} Address`}
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  {editingId
                    ? "Update your saved delivery address details."
                    : "Save your address for 1-click checkout."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeForm}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-500 transition hover:bg-gray-200 cursor-pointer"
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

              {/* ADDRESS TYPE SELECTOR */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Address Type
                </label>

                <div className="grid grid-cols-2 gap-3">
                  {/* HOME OPTION */}
                  {isHomeAvailable ? (
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          type: "home",
                        }))
                      }
                      className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 font-semibold transition cursor-pointer ${
                        form.type === "home"
                          ? "border-[#7C3AED] bg-[#F1ECFF] text-[#7C3AED]"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <Home size={18} />
                      Home
                    </button>
                  ) : (
                    <div className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-400">
                      <Home size={16} />
                      <span>Home (Already Saved)</span>
                    </div>
                  )}

                  {/* OFFICE OPTION */}
                  {isOfficeAvailable ? (
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          type: "office",
                        }))
                      }
                      className={`flex h-12 items-center justify-center gap-2 rounded-xl border-2 font-semibold transition cursor-pointer ${
                        form.type === "office"
                          ? "border-[#7C3AED] bg-[#F1ECFF] text-[#7C3AED]"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <Building2 size={18} />
                      Office
                    </button>
                  ) : (
                    <div className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 text-xs font-semibold text-gray-400">
                      <Building2 size={16} />
                      <span>Office (Already Saved)</span>
                    </div>
                  )}
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
                    className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
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
                      className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
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
                  className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
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
                  className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                />
              </div>

              {/* DELIVERY REGION (4 OPTIONS WITH SMOOTH SCROLL) */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-sm font-bold text-gray-700">
                    Delivery Region / Area <span className="text-[#7C3AED]">*</span>
                  </label>
                  <span className="text-[11px] font-semibold text-gray-400">
                    Local delivery zones
                  </span>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1.5 scroll-smooth no-scrollbar md:grid md:grid-cols-2 lg:grid-cols-4">
                  {DELIVERY_REGIONS.map((region) => {
                    const isSelected = form.city?.toLowerCase() === region.toLowerCase();

                    return (
                      <button
                        key={region}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({
                            ...prev,
                            city: region,
                          }));
                          setFormError("");
                        }}
                        className={`flex shrink-0 items-center justify-center gap-1.5 rounded-xl border-2 px-3.5 py-3 text-xs font-bold transition-all duration-200 cursor-pointer active:scale-95 ${
                          isSelected
                            ? "border-[#7C3AED] bg-[#F1ECFF] text-[#7C3AED] shadow-sm ring-2 ring-[#7C3AED]/20"
                            : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        <MapPin size={14} className={isSelected ? "text-[#7C3AED]" : "text-gray-400"} />
                        <span className="whitespace-nowrap">{region}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* STATE (PERMANENTLY LOCKED TO MAHARASHTRA) */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  State
                </label>

                <div className="flex h-12 w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-100/90 px-4 text-sm font-bold text-gray-700">
                  <div className="flex items-center gap-2">
                    <span>Maharashtra</span>
                    <span className="text-xs font-semibold text-gray-400">(MH)</span>
                  </div>
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-extrabold uppercase text-emerald-700 border border-emerald-200">
                    Store Delivery Zone
                  </span>
                </div>
              </div>

              {/* FORM BUTTONS */}
              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeForm}
                  disabled={saving}
                  className="h-12 rounded-xl border border-gray-200 px-6 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-7 text-sm font-bold text-white shadow-sm transition hover:bg-[#6C35E8] disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer active:scale-95"
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
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F1ECFF]">
              <MapPin
                size={30}
                className="text-[#7C3AED]"
              />
            </div>

            <h2 className="text-xl font-bold text-[#1E1E1E]">
              No saved addresses
            </h2>

            <p className="mt-2 text-gray-500">
              Add your Home or Office address for 1-click checkout.
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
                  className="rounded-3xl bg-white p-5 shadow-sm transition hover:shadow-md md:p-6 border border-gray-100"
                >

                  {/* CARD HEADER */}
                  <div className="mb-5 flex items-start justify-between gap-3">

                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#F1ECFF]">
                        {isHome ? (
                          <Home
                            size={23}
                            className="text-[#7C3AED]"
                          />
                        ) : (
                          <Building2
                            size={23}
                            className="text-[#7C3AED]"
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

                          <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold text-green-600 border border-green-200">
                            SAVED
                          </span>
                        </div>

                        <p className="mt-1 text-xs text-gray-500 font-medium">
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
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:border-[#7C3AED] hover:bg-[#F1ECFF] hover:text-[#7C3AED] cursor-pointer"
                        title="Edit address"
                      >
                        <Pencil size={16} />
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handlePromptDelete(address)
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-gray-500 transition hover:border-red-500 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        title="Delete address"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* ADDRESS INFORMATION */}
                  <div className="border-t border-gray-100 pt-5">

                    <p className="font-bold text-[#1E1E1E]">
                      {address.full_name}
                    </p>

                    <p className="mt-1 text-sm text-gray-500 font-medium">
                      +91 {address.phone}
                    </p>

                    <div className="mt-4 text-[14px] leading-relaxed text-gray-600">
                      <p>
                        {address.address_line1}
                      </p>

                      {address.address_line2 && (
                        <p>
                          {address.address_line2}
                        </p>
                      )}

                      <p className="font-semibold text-gray-800 pt-1">
                        {address.city}, Maharashtra
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ADD ADDRESS BUTTON — BOTTOM (HIDDEN WHEN BOTH HOME & OFFICE EXIST) */}
        {canAddAddress && !showForm && (
          <div className="mt-8 flex justify-center pb-4 sm:pb-6">
            <button
              type="button"
              onClick={openAddForm}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#7C3AED] px-6 py-4 text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(124,58,237,0.2)] transition hover:bg-[#6C35E8] active:scale-[0.98] sm:w-auto sm:min-w-[220px] cursor-pointer"
            >
              <Plus size={19} />
              Add {!hasHome ? "Home" : "Office"} Address
            </button>
          </div>
        )}
      </div>

      {/* CONFIRM DELETE MODAL */}
      <ConfirmModal
        isOpen={Boolean(addressToDelete)}
        onClose={() => {
          if (!isDeleting) setAddressToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title={`Delete ${addressToDelete?.type === "home" ? "Home" : "Office"} address?`}
        message="Are you sure you want to delete this saved address? This action cannot be undone."
        confirmText="Delete Address"
        cancelText="Cancel"
        isLoading={isDeleting}
        variant="danger"
      />
    </div>
  );
}

export default Addresses;