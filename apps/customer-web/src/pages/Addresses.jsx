import { useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import API_URL from "../config/api.js";
import axios from "axios";
import {
  DELIVERY_REGIONS,
  DEFAULT_STORE_STATE,
  isValidDeliveryRegion,
  isValidIndianPhone,
  normalizeIndianPhone,
} from "../data/indianStates.js";
import ConfirmModal from "../components/common/ConfirmModal.jsx";
import safeStorage from "../utils/safeStorage.js";
import { getSafeInternalPath } from "../utils/navigation.js";

import { useAuth } from "../context/AuthContext";

const API = `${API_URL}/addresses`;
import {
  MapPin,
  Plus,
  X,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { AddressFormCard } from "../components/address/AddressFormCard.jsx";
import { AddressItemCard } from "../components/address/AddressItemCard.jsx";
import { triggerHaptic } from "../utils/haptics";

const emptyForm = {
  type: "home",
  first_name: "",
  last_name: "",
  phone: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "MH",
};

function Addresses() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, handleSessionExpired } = useAuth();
  const [addresses, setAddresses] = useState([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Custom confirmation modal state
  const [addressToDelete, setAddressToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Status feedback toast/banner
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const [form, setForm] = useState(emptyForm);

  const getCleanDisplayName = (fullName, firstName, lastName, fallback = "Saved Address") => {
    const f = (firstName || "").trim();
    const l = (lastName || "").trim();
    if (f || l) {
      if (f && l && f.toLowerCase() === l.toLowerCase()) return f;
      if (f && l) return `${f} ${l}`;
      return f || l || fallback;
    }
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
        return parts[0];
      }
      return fullName.trim();
    }
    return fallback;
  };

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

      const fetchedAddresses = response.data.addresses || [];
      setAddresses(fetchedAddresses);

      const hasHome = fetchedAddresses.some((a) => a.type?.toLowerCase() === "home");
      const hasOffice = fetchedAddresses.some((a) => a.type?.toLowerCase() === "office");
      const canAdd = !hasHome || !hasOffice;

      // Automatically open the form if:
      // A) The user has 0 addresses and came from checkout, OR
      // B) The user was routed with selectNew: true and has capacity to add another address
      const shouldAutoOpen =
        (location.state?.from === "/cart" && fetchedAddresses.length === 0) ||
        (location.state?.selectNew && canAdd);

      if (shouldAutoOpen) {
        const defaultType = !hasHome ? "home" : "office";
        const nameTokens = (user?.name || user?.full_name || "").trim().split(/\s+/);
        const prefillFirst = user?.first_name || nameTokens[0] || "";
        const prefillLast = user?.last_name || (nameTokens.length > 1 ? nameTokens.slice(1).join(" ") : "");
        const prefillPhone = user?.phone || user?.billing_phone || "";
        setForm({
          ...emptyForm,
          type: defaultType,
          first_name: prefillFirst,
          last_name: prefillLast,
          phone: prefillPhone,
        });
        setShowForm(true);
      }
    } catch (error) {
      if (error.response?.status === 401) {
        if (handleSessionExpired) {
          handleSessionExpired();
        }
        navigate("/login", {
          replace: true,
          state: { from: "/addresses" },
        });
        return;
      }
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
      value = normalizeIndianPhone(value);
    }

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }

    setFormError("");
  };

  const openAddForm = () => {
    if (!canAddAddress) return;

    // Automatically default to the remaining available type
    const defaultType = !hasHome ? "home" : "office";
    const nameTokens = (user?.name || user?.full_name || "").trim().split(/\s+/);
    const prefillFirst = user?.first_name || nameTokens[0] || "";
    const prefillLast = user?.last_name || (nameTokens.length > 1 ? nameTokens.slice(1).join(" ") : "");
    const prefillPhone = user?.phone || user?.billing_phone || "";

    setEditingId(null);
    setForm({
      ...emptyForm,
      type: defaultType,
      first_name: prefillFirst,
      last_name: prefillLast,
      phone: prefillPhone,
    });
    setFormError("");
    setFieldErrors({});
    setFeedback({ type: "", message: "" });
    setShowForm(true);
  };

  const openEditForm = (address) => {
    setEditingId(address.id);
    const parts = (address.full_name || "").trim().split(/\s+/);
    const parsedFirst = address.first_name || parts[0] || "";
    const parsedLast = address.last_name || (parts.length > 1 ? parts.slice(1).join(" ") : "");

    setForm({
      type: address.type || "home",
      first_name: parsedFirst,
      last_name: parsedLast,
      phone: address.phone || "",
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "",
      state: address.state || "MH",
    });

    setFormError("");
    setFieldErrors({});
    setFeedback({ type: "", message: "" });
    setShowForm(true);
  };

  const closeForm = () => {
    if (saving) return;

    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setFieldErrors({});
  };

  // --------------------------------------------------
  // ADD / UPDATE ADDRESS
  // --------------------------------------------------

  const handleSubmit = async (e) => {
    e.preventDefault();

    setFormError("");
    const errors = {};

    if (!form.type || (form.type !== "home" && form.type !== "office")) {
      errors.type = "Please select a valid address type.";
    }

    // Client-side validation guarding against duplicate type
    if (!editingId && form.type === "home" && hasHome) {
      errors.type = "A Home address is already saved. You can only add an Office address.";
    } else if (!editingId && form.type === "office" && hasOffice) {
      errors.type = "An Office address is already saved. You can only add a Home address.";
    } else if (
      editingId &&
      form.type === "home" &&
      addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "home")
    ) {
      errors.type = "Another Home address is already saved.";
    } else if (
      editingId &&
      form.type === "office" &&
      addresses.some((a) => a.id !== editingId && a.type?.toLowerCase() === "office")
    ) {
      errors.type = "Another Office address is already saved.";
    }

    if (!form.first_name || !form.first_name.trim()) {
      errors.first_name = "First name is required.";
    }

    if (!form.last_name || !form.last_name.trim()) {
      errors.last_name = "Last name is required.";
    }

    if (!form.phone || !form.phone.trim()) {
      errors.phone = "Mobile number is required.";
    } else if (!isValidIndianPhone(form.phone)) {
      errors.phone = "Please enter a valid 10-digit mobile number.";
    }

    if (!form.address_line1 || !form.address_line1.trim()) {
      errors.address_line1 = "Please enter your street address / house number.";
    }

    if (!form.city || !form.city.trim() || !isValidDeliveryRegion(form.city)) {
      errors.city = "Please select your delivery region.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError("Please fill in the required fields highlighted in red below.");
      return;
    }

    try {
      setSaving(true);

      const cleanFirst = form.first_name.trim();
      const cleanLast = form.last_name.trim();
      const payload = {
        ...form,
        first_name: cleanFirst,
        last_name: cleanLast,
        full_name: `${cleanFirst} ${cleanLast}`,
      };

      if (editingId) {
        // UPDATE
        await axios.put(
          `${API}/${editingId}`,
          payload,
          {
            withCredentials: true,
          }
        );
        const addrIdStr = String(editingId);
        if (user?.id) safeStorage.setItem(`selected_address_id_${user.id}`, addrIdStr);
        setFeedback({
          type: "success",
          message: `${form.type === "home" ? "Home" : "Office"} address updated successfully!`,
        });

        if (location.state?.from) {
          const safeTarget = getSafeInternalPath(location.state.from, "/cart");
          if (window.history.state && window.history.state.idx > 0) {
            navigate(-1);
          } else {
            navigate(safeTarget, {
              replace: true,
              state: { selectedAddressId: addrIdStr },
            });
          }
          return;
        }
      } else {
        // CREATE
        const createRes = await axios.post(
          API,
          payload,
          {
            withCredentials: true,
          }
        );
        const newAddressId = createRes.data?.address?.id ? String(createRes.data.address.id) : null;
        if (newAddressId) {
          if (user?.id) safeStorage.setItem(`selected_address_id_${user.id}`, newAddressId);
        }
        setFeedback({
          type: "success",
          message: `${form.type === "home" ? "Home" : "Office"} address saved successfully!`,
        });

        if (location.state?.from) {
          const safeTarget = getSafeInternalPath(location.state.from, "/cart");
          if (window.history.state && window.history.state.idx > 0) {
            navigate(-1);
          } else {
            navigate(safeTarget, {
              replace: true,
              state: { selectedAddressId: newAddressId },
            });
          }
          return;
        }
      }

      // Auto dismiss success toast after 4s
      setTimeout(() => {
        setFeedback((prev) => (prev.type === "success" ? { type: "", message: "" } : prev));
      }, 4000);

      // Refresh list from backend
      await loadAddresses();
      closeForm();
    } catch (error) {
      const msg = error.response?.data?.message || "Unable to save address.";
      setFormError(msg);
      if (msg.toLowerCase().includes("phone") || msg.toLowerCase().includes("mobile")) {
        setFieldErrors((prev) => ({ ...prev, phone: msg }));
      } else if (msg.toLowerCase().includes("first name")) {
        setFieldErrors((prev) => ({ ...prev, first_name: msg }));
      } else if (msg.toLowerCase().includes("last name")) {
        setFieldErrors((prev) => ({ ...prev, last_name: msg }));
      } else if (msg.toLowerCase().includes("address") || msg.toLowerCase().includes("street")) {
        setFieldErrors((prev) => ({ ...prev, address_line1: msg }));
      } else if (msg.toLowerCase().includes("city") || msg.toLowerCase().includes("region")) {
        setFieldErrors((prev) => ({ ...prev, city: msg }));
      }
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
      <div className="flex min-h-[50vh] items-center justify-center bg-[#F0F8E8]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-[#22499F]" />
      </div>
    );
  }

  // --------------------------------------------------
  // UI
  // --------------------------------------------------

  return (
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] px-4 py-6 sm:px-5 md:px-10 md:py-10 pb-28 sm:pb-16">
      <div className="mx-auto max-w-4xl">

        {/* TOP BAR / NAVIGATION (Pill Design) */}
        <div className="mb-6 flex items-center justify-between gap-2.5 sm:gap-3 md:mb-8">
          {/* Left: Circular Back Button */}
          <button
            onClick={() => {
              triggerHaptic("light");
              if (window.history.state && window.history.state.idx > 0) {
                navigate(-1);
              } else {
                navigate(getSafeInternalPath(location.state?.from, "/account"), { replace: true });
              }
            }}
            aria-label="Back to Account"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-white border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule utilizing available space with full descender clearance */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E2E8F0] px-5 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.3)]">
            <h1 className="text-[19px] sm:text-[20px] font-extrabold text-[#1E293B] tracking-[-0.01em] leading-normal antialiased select-none">
              My Addresses
            </h1>
          </div>

          {/* Right: Circular Action Button */}
          {canAddAddress && !showForm ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                openAddForm();
              }}
              aria-label="Add Address"
              className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#22499F] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 hover:text-white active:scale-95 cursor-pointer"
            >
              <Plus size={22} strokeWidth={2.4} />
            </button>
          ) : showForm ? (
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                closeForm();
              }}
              aria-label="Close Form"
              className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#64748B] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 hover:text-white active:scale-95 cursor-pointer"
            >
              <X size={20} strokeWidth={2.4} />
            </button>
          ) : (
            <div
              aria-hidden="true"
              className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#22499F] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.25)]"
            >
              <MapPin size={21} strokeWidth={2.2} />
            </div>
          )}
        </div>

        {/* FEEDBACK TOAST / BANNER */}
        {feedback.message && (
          <div
            className={`mb-6 flex items-center justify-between gap-3 rounded-2xl p-4 text-sm font-semibold animate-[slideUp_0.2s_ease-out] ${
              feedback.type === "success"
                ? "feedback-toast-success"
                : "address-error-banner"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {feedback.type === "success" ? (
                <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle size={18} className="shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>

            <button
              type="button"
              onClick={() => setFeedback({ type: "", message: "" })}
              className="rounded-lg p-1 text-[#64748B] hover:text-[#1E293B] transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* ADD / EDIT FORM */}
        <AddressFormCard
          showForm={showForm}
          form={form}
          setForm={setForm}
          editingId={editingId}
          formError={formError}
          setFormError={setFormError}
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          isHomeAvailable={isHomeAvailable}
          isOfficeAvailable={isOfficeAvailable}
          handleChange={handleChange}
          handleSubmit={handleSubmit}
          closeForm={closeForm}
          saving={saving}
          triggerHaptic={triggerHaptic}
          DELIVERY_REGIONS={DELIVERY_REGIONS}
        />

        {/* SAVED ADDRESSES */}
        {addresses.length === 0 ? (
          <div className="rounded-3xl border border-[#E2E8F0]/80 bg-[#FFFFFF] p-8 text-center shadow-lg md:p-12">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] text-[#22499F]">
              <MapPin
                size={30}
                className="text-[#22499F]"
              />
            </div>

            <h2 className="text-xl font-bold text-[#1E293B]">
              No saved addresses
            </h2>
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {addresses.map((address) => (
              <AddressItemCard
                key={address.id}
                address={address}
                onEdit={openEditForm}
                onDelete={handlePromptDelete}
                getCleanDisplayName={getCleanDisplayName}
              />
            ))}
          </div>
        )}

        {/* ADD ADDRESS BUTTON — BOTTOM (HIDDEN WHEN BOTH HOME & OFFICE EXIST) */}
        {canAddAddress && !showForm && (
          <div className="mt-8 flex justify-center pb-4 sm:pb-6">
            <button
              type="button"
              onClick={openAddForm}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#22499F] px-6 py-4 text-[15px] font-black text-[#FFFFFF] shadow-lg transition hover:bg-[#1B3B82] active:scale-[0.98] sm:w-auto sm:min-w-[220px] cursor-pointer"
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
