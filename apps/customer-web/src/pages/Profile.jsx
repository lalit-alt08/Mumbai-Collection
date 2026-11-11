import { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import API_URL from "../config/api.js";
import { isValidIndianPhone } from "../data/indianStates.js";
import { useAuth } from "../context/AuthContext";

import {
  User,
  Mail,
  Phone,
  Pencil,
  X,
  Check,
  Loader2,
  ArrowLeft,
  ChevronLeft,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Shield,
} from "lucide-react";
import axios from "axios";
import safeStorage, { safeSessionStorage } from "../utils/safeStorage.js";
import ConfirmModal from "../components/common/ConfirmModal.jsx";
import { triggerHaptic } from '../utils/haptics';
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";
import { sendPasswordResetOtp, verifyPasswordResetOtp } from "../services/authService.js";

function Profile() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, deleteAccount, updateUser, handleSessionExpired } = useAuth();
  const [profileState, setProfileState] = useState(() => {
    safeStorage.removeItem("user_profile");
    if (!user?.id) return { data: null, userId: null };
    const cached = safeSessionStorage.getJSON(`user_profile_${user.id}`, null);
    return { data: cached || null, userId: user.id };
  });

  const profile = profileState.userId === user?.id ? profileState.data : null;
  const [loading, setLoading] = useState(!profile);
  const requestGenRef = useRef(0);
  const phoneInputRef = useRef(null);
  const focusAttemptedRef = useRef(false);

  const [editing, setEditing] = useState(() => Boolean(location.state?.edit));
  const [saving, setSaving] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteCodeSent, setDeleteCodeSent] = useState(false);
  const [deleteCodeSending, setDeleteCodeSending] = useState(false);
  const [deleteResendSeconds, setDeleteResendSeconds] = useState(0);
  const passwordlessGoogle = user?.is_google_user === true && user?.has_usable_password === false;

  useEffect(() => {
    if (deleteResendSeconds <= 0) return;
    const interval = setInterval(() => {
      setDeleteResendSeconds((sec) => (sec > 0 ? sec - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [deleteResendSeconds]);

  const sendDeleteCode = async () => {
    if (deleteCodeSending || isDeleting || deleteResendSeconds > 0) return;
    setDeleteCodeSending(true);
    setDeleteError("");
    try {
      await sendPasswordResetOtp(user.email);
      setDeleteCodeSent(true);
      setDeleteResendSeconds(60);
      setDeletePassword("");
    } catch (err) {
      setDeleteError(err.response?.data?.message || "Unable to send the confirmation code.");
    } finally {
      setDeleteCodeSending(false);
    }
  };

  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState("");
  const [phoneAvailability, setPhoneAvailability] = useState("idle");

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    phone: "",
  });

  useEffect(() => {
    const phone = String(form.phone || "").replace(/\D/g, "").slice(-10);
    const current = String(profile?.phone || user?.phone || "").replace(/\D/g, "").slice(-10);
    if (!editing || !isValidIndianPhone(phone) || phone === current) {
      setPhoneAvailability("idle");
      return;
    }
    const controller = new AbortController();
    setPhoneAvailability("checking");
    const timer = setTimeout(async () => {
      try {
        const response = await axios.get(`${API_URL}/profile/check-phone`, {
          params: { phone }, withCredentials: true, signal: controller.signal, timeout: 10000,
        });
        if (!controller.signal.aborted) {
          setPhoneAvailability(response.data?.success === true && response.data?.available === true ? "available" : response.data?.exists === true ? "taken" : "unavailable");
        }
      } catch {
        if (!controller.signal.aborted) setPhoneAvailability("unavailable");
      }
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [editing, form.phone, profile?.phone, user?.phone, user?.id]);

  const getCleanDisplayName = (fullName, firstName, lastName, fallback = "Your Name") => {
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

  // ==============================
  // LOAD PROFILE & IDENTITY LIFECYCLE
  // ==============================

  useEffect(() => {
    // Increment generation token so stale in-flight responses are strictly dropped
    const currentGen = ++requestGenRef.current;
    const controller = new AbortController();

    // Reset editing and error states on identity switch, but honor location.state?.edit
    const shouldEdit = Boolean(location.state?.edit);
    setEditing(shouldEdit);
    setSaving(false);
    setError("");
    setDeleteError("");
    focusAttemptedRef.current = false;

    if (!user?.id) {
      setProfileState({ data: null, userId: null });
      setForm({ first_name: "", last_name: "", phone: "" });
      setLoading(false);
      return;
    }

    const currentUserId = user.id;
    const scopedKey = `user_profile_${currentUserId}`;
    const cached = safeSessionStorage.getJSON(scopedKey, null);
    setProfileState({ data: cached || null, userId: currentUserId });

    const rawFullName = cached?.full_name || user?.name || user?.full_name || "";
    const nameParts = rawFullName.trim().split(/\s+/);
    const initialFirst = cached?.first_name || user?.first_name || nameParts[0] || "";
    const initialLast = cached?.last_name || user?.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");
    const initialPhone = cached?.phone || user?.phone || "";
    setForm({
      first_name: initialFirst,
      last_name: initialLast,
      phone: initialPhone,
    });
    setLoading(!cached);

    const isActive = () => currentGen === requestGenRef.current && !controller.signal.aborted;

    const loadProfile = async () => {
      try {
        const response = await axios.get(
          `${API_URL}/profile`,
          {
            withCredentials: true,
            signal: controller.signal,
          }
        );

        if (!isActive()) return;

        const profileData = response.data.profile || {};
        const isVerified = response.data.is_phone_verified === true;
        const verifiedPhone = response.data.verified_phone || user?.verified_phone || "";
        const currentPhone = profileData.phone || response.data.billing_phone || user?.phone || "";

        const mergedProfile = {
          ...profileData,
          phone: currentPhone,
        };

        setProfileState({ data: mergedProfile, userId: currentUserId });
        safeSessionStorage.setJSON(`user_profile_${currentUserId}`, mergedProfile);

        const fullName = profileData.full_name || user?.name || user?.full_name || "";
        const parts = fullName.trim().split(/\s+/);
        const loadedFirst = profileData.first_name || user?.first_name || parts[0] || "";
        const loadedLast = profileData.last_name || user?.last_name || (parts.length > 1 ? parts.slice(1).join(" ") : "");

        if (updateUser && (fullName || loadedFirst)) {
          updateUser({
            first_name: loadedFirst,
            last_name: loadedLast,
            name: fullName || `${loadedFirst} ${loadedLast}`.trim(),
            full_name: fullName || `${loadedFirst} ${loadedLast}`.trim(),
            phone: currentPhone,
            verified_phone: verifiedPhone,
            is_phone_verified: isVerified && !!verifiedPhone && currentPhone === verifiedPhone,
          });
        }

        setForm({
          first_name: loadedFirst,
          last_name: loadedLast,
          phone: currentPhone,
        });
      } catch (error) {
        if (!isActive() || controller.signal.aborted) return;
        if (error.response?.status === 401) {
          if (handleSessionExpired) {
            handleSessionExpired();
          }
          navigate("/login", {
            replace: true,
            state: { from: "/account/profile" },
          });
          return;
        }
        setError(
          error.response?.data?.message ||
            "Unable to load profile."
        );
      } finally {
        if (isActive()) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      requestGenRef.current += 1;
      controller.abort();
    };
  }, [user?.id]);

  // Focus the targeted phone input through a ref once the edit form mounts
  useEffect(() => {
    if (
      !loading &&
      editing &&
      location.state?.focusField === "phone" &&
      !focusAttemptedRef.current
    ) {
      if (phoneInputRef.current && !phoneInputRef.current.disabled) {
        phoneInputRef.current.focus();
        focusAttemptedRef.current = true;
      }
    }
  }, [loading, editing, location.state?.focusField]);

  // ==============================
  // INPUT CHANGE (NAME & PHONE)
  // ==============================

  const handleChange = (e) => {
    const { name, value } = e.target;
    let nextValue = value;
    if (name === "phone") {
      let digits = value.replace(/\D/g, "");
      if (digits.length === 12 && digits.startsWith("91")) {
        digits = digits.slice(2);
      } else if (digits.length === 11 && digits.startsWith("0")) {
        digits = digits.slice(1);
      }
      nextValue = digits.slice(0, 10);
    }

    setForm((prev) => ({
      ...prev,
      [name]: nextValue,
    }));

    if (fieldErrors[name]) {
      setFieldErrors((prev) => {
        const copy = { ...prev };
        delete copy[name];
        return copy;
      });
    }

    setError("");
    setSuccess("");
  };

  // ==============================
  // EDIT
  // ==============================

  const handleEdit = () => {
    const rawFullName = profile?.full_name || user?.name || user?.full_name || "";
    const nameParts = rawFullName.trim().split(/\s+/);
    const loadedFirst = profile?.first_name || user?.first_name || nameParts[0] || "";
    const loadedLast = profile?.last_name || user?.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

    setForm({
      first_name: loadedFirst,
      last_name: loadedLast,
      phone: profile?.phone || user?.phone || "",
    });

    setError("");
    setFieldErrors({});
    setSuccess("");
    setEditing(true);
  };

  // ==============================
  // CANCEL
  // ==============================

  const handleCancel = () => {
    const rawFullName = profile?.full_name || user?.name || user?.full_name || "";
    const nameParts = rawFullName.trim().split(/\s+/);
    const loadedFirst = profile?.first_name || user?.first_name || nameParts[0] || "";
    const loadedLast = profile?.last_name || user?.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

    setForm({
      first_name: loadedFirst,
      last_name: loadedLast,
      phone: profile?.phone || user?.phone || "",
    });

    setError("");
    setFieldErrors({});
    setSuccess("");
    setEditing(false);
  };

  // ==============================
  // SAVE
  // ==============================

  const handleSave = async (e) => {
    e.preventDefault();

    setError("");
    setFieldErrors({});
    setSuccess("");

    const newFieldErrors = {};
    const cleanFirst = normalizePersonName(form.first_name);
    const cleanLast = normalizePersonName(form.last_name);

    if (!cleanFirst) {
      newFieldErrors.first_name = "First name is required.";
    } else if (!isValidPersonName(cleanFirst)) {
      newFieldErrors.first_name = "First name can only contain letters, spaces, hyphens, apostrophes, and periods.";
    }

    if (!cleanLast) {
      newFieldErrors.last_name = "Last name is required.";
    } else if (!isValidPersonName(cleanLast)) {
      newFieldErrors.last_name = "Last name can only contain letters, spaces, hyphens, apostrophes, and periods.";
    }

    const effectivePrimary = String(form.phone || "").replace(/\D/g, "").slice(-10);
    if (!isValidIndianPhone(effectivePrimary)) {
      newFieldErrors.phone = "Please enter a valid 10-digit primary Indian mobile number.";
    } else if (phoneAvailability === "taken") {
      newFieldErrors.phone = "This mobile number is already registered to another account.";
    } else if (phoneAvailability === "checking") {
      newFieldErrors.phone = "Please wait while we check this number.";
    }

    if (Object.keys(newFieldErrors).length > 0) {
      setFieldErrors(newFieldErrors);
      setError("");
      const firstField = Object.keys(newFieldErrors)[0];
      const elem = document.querySelector(`[name="${firstField}"]`);
      if (elem) {
        elem.focus();
        elem.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    const saveGen = requestGenRef.current;
    const saveUserId = user?.id;
    const isSaveActive = () => saveGen === requestGenRef.current && user?.id === saveUserId;

    try {
      setSaving(true);

      const cleanFirst = form.first_name.trim();
      const cleanLast = form.last_name.trim();
      const cleanFullName = `${cleanFirst} ${cleanLast}`;
      const cleanPhone = effectivePrimary;

      const response = await axios.put(
        `${API_URL}/profile`,
        {
          first_name: cleanFirst,
          last_name: cleanLast,
          full_name: cleanFullName,
          phone: cleanPhone,
        },
        {
          withCredentials: true,
        }
      );

      if (!isSaveActive()) return;

      const returnedProfile = response.data?.profile || {};

      const updatedProfile = {
        ...profile,
        ...returnedProfile,
        first_name: cleanFirst,
        last_name: cleanLast,
        full_name: cleanFullName,
        phone: cleanPhone,
      };

      setProfileState({ data: updatedProfile, userId: saveUserId });
      if (saveUserId) {
        safeSessionStorage.setJSON(`user_profile_${saveUserId}`, updatedProfile);
      }
      if (updateUser) {
        updateUser({
          first_name: cleanFirst,
          last_name: cleanLast,
          name: cleanFullName,
          full_name: cleanFullName,
          phone: cleanPhone,
          is_phone_verified: response.data?.is_phone_verified === true,
          verified_phone: response.data?.verified_phone || "",
        });
      }

      setForm({
        first_name: cleanFirst,
        last_name: cleanLast,
        phone: updatedProfile.phone || "",
      });

      setEditing(false);
      setSuccess("Profile updated successfully.");
    } catch (error) {
      if (!isSaveActive()) return;

      if (error.response?.status === 401) {
        if (handleSessionExpired) {
          handleSessionExpired();
        }
        navigate("/login", {
          replace: true,
          state: { from: "/account/profile" },
        });
        return;
      }

      const serverMsg = error.response?.data?.message || "Unable to update profile.";
      const status = error.response?.status;
      const lower = serverMsg.toLowerCase();

      let targetField = null;
      if (
        status === 409 ||
        lower.includes("primary") ||
        lower.includes("mobile number is already") ||
        lower.includes("phone number is already") ||
        lower.includes("phone") ||
        lower.includes("mobile")
      ) {
        targetField = "phone";
      } else if (lower.includes("first name")) {
        targetField = "first_name";
      } else if (lower.includes("last name")) {
        targetField = "last_name";
      }

      if (targetField) {
        setFieldErrors({ [targetField]: serverMsg });
        setError("");
        setTimeout(() => {
          if (!isSaveActive()) return;
          const elem = document.querySelector(`[name="${targetField}"]`);
          if (elem) {
            elem.focus();
            elem.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 50);
      } else {
        setFieldErrors({});
        setError(serverMsg);
      }
    } finally {
      if (isSaveActive()) {
        setSaving(false);
      }
    }
  };

  // ==============================
  // DELETE ACCOUNT
  // ==============================

  const handleDeleteAccount = async () => {
    if (isDeleting) return;
    if (!deletePassword) {
      setDeleteError(passwordlessGoogle ? "Enter the email confirmation code." : "Enter your current password to confirm account deletion.");
      return;
    }

    const deleteGen = requestGenRef.current;
    const deleteUserId = user?.id;
    const isDeleteActive = () => deleteGen === requestGenRef.current && user?.id === deleteUserId;

    try {
      setIsDeleting(true);
      setError("");
      setDeleteError("");

      if (passwordlessGoogle) {
        const proof = await verifyPasswordResetOtp(user.email, deletePassword);
        if (!isDeleteActive()) return;
        await deleteAccount({ reset_token: proof.reset_token });
      } else {
        await deleteAccount(deletePassword);
      }
      if (!isDeleteActive()) return;
      setShowDeleteModal(false);
      setDeletePassword("");

      navigate("/", {
        replace: true,
        state: {
          accountDeleted: true,
          message: "Your account has been permanently deleted.",
        },
      });
    } catch (err) {
      if (!isDeleteActive()) return;
      setDeleteError(
        err.response?.data?.message ||
          "Failed to delete account. Please try again or contact support."
      );
    } finally {
      if (isDeleteActive()) {
        setIsDeleting(false);
      }
    }
  };

  // ==============================
  // LOADING
  // ==============================

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-[#22499F]" />
      </div>
    );
  }

  // ==============================
  // ERROR
  // ==============================

  if (error && !editing && !profile) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="rounded-2xl border border-rose-900/60 bg-rose-950/40 p-5 text-rose-300">
          {error}
        </div>
      </div>
    );
  }

  const displayName = getCleanDisplayName(profile?.full_name, profile?.first_name, profile?.last_name, "Your Name");
  const avatarInitials =
    displayName
      .split(" ")
      .map((w) => {
        const letter = Array.from(w).find((ch) => /[\p{L}\p{M}]/u.test(ch));
        return letter || "";
      })
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "U";

  return (
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] px-4 py-4 sm:px-5 sm:py-6 pb-24 sm:pb-16">
      <div className="mx-auto max-w-xl">

                {/* HEADER (Pill Design) */}
        <div className="mb-4 sm:mb-6 flex items-center justify-between gap-2.5 sm:gap-3">
          {/* Left: Circular Back Button */}
          <button
            onClick={() => {
              triggerHaptic("light");
              if (window.history.state && window.history.state.idx > 0) {
                navigate(-1);
              } else {
                navigate("/account", { replace: true });
              }
            }}
            aria-label="Back to Account"
            className="flex h-12 w-12 sm:h-[52px] sm:w-[52px] shrink-0 items-center justify-center rounded-full bg-[#FFFFFF]/90 backdrop-blur-md text-[#1E293B] border border-[#E2E8F0] shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.06)] transition-all hover:bg-[#FFFFFF] hover:border-[#22499F]/40 hover:text-[#22499F] active:scale-95 cursor-pointer"
          >
            <ChevronLeft size={23} strokeWidth={2.5} />
          </button>

          {/* Center: Capsule utilizing available space with clear typography */}
          <div className="flex-1 min-w-0 flex items-center justify-center rounded-full bg-[#FFFFFF]/95 backdrop-blur-md border border-[#E2E8F0] px-5 sm:px-7 py-2.5 sm:py-3 min-h-[48px] sm:min-h-[52px] shadow-[inset_0_1px_1px_rgba(255,255,255,0.12),0_2px_10px_rgba(0,0,0,0.06)]">
            <h1 className="text-[19px] sm:text-[20px] font-extrabold text-[#1E293B] tracking-[-0.01em] leading-normal antialiased select-none">
              My Profile
            </h1>
          </div>

          {/* Right Spacer for optical balance */}
          <div className="w-12 sm:w-[52px] shrink-0" aria-hidden="true" />
        </div>

{/* SUCCESS */}
        {success && (
          <div className="mb-4 rounded-xl border border-emerald-500 bg-[#FFFFFF] p-3 text-xs font-semibold text-emerald-300">
            {success}
          </div>
        )}

        {/* ERROR */}
        {error && (
          <div className="mb-4 rounded-xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs font-semibold text-rose-300">
            {error}
          </div>
        )}

        {/* UNIFIED PROFILE CARD */}
        <div className="overflow-hidden rounded-[22px] border border-[#E2E8F0]/80 bg-[#FFFFFF] shadow-lg">

          {/* PROFILE HERO HEADER */}
          <div className="flex items-center justify-between gap-3.5 p-4 sm:p-5 border-b border-[#E2E8F0]/60">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="account-avatar flex h-13 w-13 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#22499F] to-[#1B3B82] text-[#FFFFFF] font-black text-lg sm:text-xl shadow-sm ring-1 ring-[#E2E8F0]">
                {avatarInitials}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-extrabold text-[#1E293B] truncate">
                  {displayName}
                </h2>
                <p className="text-xs sm:text-sm text-[#64748B] truncate mt-0.5">
                  {editing ? "Editing Information" : "Personal Information"}
                </p>
              </div>
            </div>

            {!editing && (
              <button
                type="button"
                onClick={handleEdit}
                className="account-edit flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-[#FFFFFF] border border-[#E2E8F0] px-4 py-2 text-xs sm:text-sm font-bold text-[#22499F] shadow-xs transition hover:bg-[#22499F] hover:text-[#FFFFFF] active:scale-95 cursor-pointer"
              >
                <Pencil size={14} />
                <span>Edit</span>
              </button>
            )}
          </div>

          {/* ========================================= */}
          {/* EDIT MODE */}
          {/* ========================================= */}
          {editing ? (
            <form onSubmit={handleSave} className="p-4 sm:p-5 space-y-3.5">

              {/* FIRST NAME & LAST NAME */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={`mb-1.5 block text-xs font-bold ${fieldErrors.first_name ? "text-rose-400" : "text-[#64748B]"}`}>
                    First Name <span className={fieldErrors.first_name ? "text-rose-400" : "text-[#22499F]"}>*</span>
                  </label>
                  <div className="relative">
                    <User
                      size={15}
                      className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${fieldErrors.first_name ? "text-rose-400" : "text-[#64748B]"}`}
                    />
                    <input
                      type="text"
                      name="first_name"
                      value={form.first_name}
                      onChange={handleChange}
                      autoComplete="given-name"
                      placeholder="e.g. Rahul"
                      required
                      className={`h-11 w-full rounded-xl border pl-10 pr-3.5 text-sm text-[#1E293B] outline-none transition ${
                        fieldErrors.first_name
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                          : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                      }`}
                    />
                  </div>
                  {fieldErrors.first_name && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <span>{fieldErrors.first_name}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className={`mb-1.5 block text-xs font-bold ${fieldErrors.last_name ? "text-rose-400" : "text-[#64748B]"}`}>
                    Last Name <span className={fieldErrors.last_name ? "text-rose-400" : "text-[#22499F]"}>*</span>
                  </label>
                  <div className="relative">
                    <User
                      size={15}
                      className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${fieldErrors.last_name ? "text-rose-400" : "text-[#64748B]"}`}
                    />
                    <input
                      type="text"
                      name="last_name"
                      value={form.last_name}
                      onChange={handleChange}
                      autoComplete="family-name"
                      placeholder="e.g. Sharma"
                      required
                      className={`h-11 w-full rounded-xl border pl-10 pr-3.5 text-sm text-[#1E293B] outline-none transition ${
                        fieldErrors.last_name
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                          : "border-[#E2E8F0] bg-[#F0F8E8] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                      }`}
                    />
                  </div>
                  {fieldErrors.last_name && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <span>{fieldErrors.last_name}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* PRIMARY PHONE */}
              <div>
                <label className={`mb-1.5 block text-xs font-bold ${fieldErrors.phone ? "text-rose-400" : "text-[#64748B]"}`}>
                  Primary Mobile
                </label>
                <div className="relative flex items-center">
                  <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold ${fieldErrors.phone ? "text-rose-400" : "text-[#64748B]"}`}>
                    +91
                  </span>
                  <input
                    ref={(el) => {
                      phoneInputRef.current = el;
                      if (
                        el &&
                        !el.disabled &&
                        editing &&
                        location.state?.focusField === "phone" &&
                        !focusAttemptedRef.current
                      ) {
                        el.focus();
                        focusAttemptedRef.current = true;
                      }
                    }}
                    type="tel"
                    inputMode="numeric"
                    name="phone"
                    value={String(form.phone || "").replace(/\D/g, "").slice(-10)}
                    onChange={handleChange}
                    maxLength={10}
                    disabled={saving}
                    className={`h-11 w-full rounded-xl border pl-11 pr-3.5 outline-none transition font-semibold text-sm ${
                      fieldErrors.phone
                        ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20 text-[#1E293B]"
                        : "border-[#E2E8F0] bg-[#F0F8E8] text-[#1E293B] focus:border-[#22499F] focus:ring-2 focus:ring-[#22499F]/20"
                    }`}
                  />
                </div>
                {fieldErrors.phone ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                    <AlertCircle size={12} className="shrink-0 text-rose-400" />
                    <span>{fieldErrors.phone}</span>
                  </p>
                ) : phoneAvailability !== "idle" ? (
                  <p role="status" aria-live="polite" className={`mt-1 flex items-center gap-1 text-[11px] ${phoneAvailability === "taken" ? "text-rose-400" : "text-[#64748B]"}`}>
                    {phoneAvailability === "checking" && <Loader2 size={12} className="animate-spin" />}
                    {phoneAvailability === "checking" ? "Checking availability…" : phoneAvailability === "available" ? "Number available" : phoneAvailability === "taken" ? "This number is already registered to another account." : "Couldn’t check availability. We’ll check when you save."}
                  </p>
                ) : null}
              </div>

              {/* EMAIL */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-[#64748B]">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#64748B]"
                  />
                  <input
                    type="text"
                    value={profile?.email || user?.email || "Not available"}
                    disabled
                    className="h-11 w-full cursor-not-allowed rounded-xl border border-[#E2E8F0] bg-[#F0F8E8]/50 pl-10 pr-3.5 text-sm text-[#64748B] outline-none"
                  />
                </div>
                <p className="mt-1 text-[11px] text-[#64748B]">
                  Email cannot be changed from this page.
                </p>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#E2E8F0] bg-[#F0F8E8] px-4 text-xs font-bold text-[#64748B] transition hover:bg-[#FFFFFF] hover:text-[#1E293B] disabled:opacity-50 cursor-pointer"
                >
                  <X size={15} />
                  <span>Cancel</span>
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#22499F] px-5 text-xs font-black text-[#FFFFFF] transition hover:bg-[#1B3B82] active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer shadow-xs"
                >
                  {saving ? (
                    <>
                      <Loader2
                        size={15}
                        className="animate-spin text-[#FFFFFF]"
                      />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check size={15} />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>

            </form>
          ) : (
            /* ========================================= */
            /* COMPACT UNIFIED VIEW MODE */
            /* ========================================= */
            <div className="divide-y divide-[#E2E8F0]/60">

              {/* FULL NAME */}
              <div className="flex items-center justify-between gap-3 px-4.5 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-[#FFFFFF]/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
                    <User size={17} />
                  </div>
                  <span className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-[#64748B]">
                    Full Name
                  </span>
                </div>
                <span className="text-right text-[15px] sm:text-base font-semibold text-[#1E293B] truncate max-w-[58%]">
                  {displayName}
                </span>
              </div>

              {/* PRIMARY MOBILE */}
              <div className="flex items-center justify-between gap-3 px-4.5 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-[#FFFFFF]/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
                    <Phone size={17} />
                  </div>
                  <span className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-[#64748B] whitespace-nowrap">
                    Primary Mobile
                  </span>
                </div>
                <span className={`text-right text-[15px] sm:text-base font-semibold font-mono whitespace-nowrap ${(profile?.phone || user?.phone) ? "text-[#1E293B]" : "text-[#64748B]"}`}>
                  {(profile?.phone || user?.phone)
                    ? formatPhoneNumber(profile?.phone || user?.phone)
                    : "Not provided"}
                </span>
              </div>

              {/* EMAIL */}
              <div className="flex items-center justify-between gap-3 px-4.5 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-[#FFFFFF]/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#22499F] border border-[#E2E8F0]">
                    <Mail size={17} />
                  </div>
                  <span className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-[#64748B]">
                    Email
                  </span>
                </div>
                <span className="text-right text-sm sm:text-[15px] font-semibold text-[#1E293B] break-all max-w-[58%] sm:max-w-none">
                  {profile?.email || user?.email || "Not available"}
                </span>
              </div>

            </div>
          )}

        </div>

        {/* ACCOUNT PRIVACY: DELETE ACCOUNT */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Shield size={14} className="text-[#64748B]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">
              Account Privacy
            </h3>
          </div>

          <div className="account-delete rounded-[18px] border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="account-delete-title flex items-center gap-1.5 text-sm font-bold">
                  <AlertTriangle size={14} />
                  <span>Delete Account</span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-[#64748B]">
                  Permanently delete your account, addresses, and saved data.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="account-delete-button shrink-0 flex min-h-11 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs sm:text-sm font-bold transition active:scale-95 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>



      {/* DELETE ACCOUNT CONFIRMATION MODAL */}
      <ConfirmModal
        isOpen={showDeleteModal}
        onClose={() => {
          if (!isDeleting) {
            setShowDeleteModal(false);
            setDeletePassword("");
            setDeleteError("");
            setDeleteCodeSent(false);
            setDeleteResendSeconds(0);
          }
        }}
        onConfirm={handleDeleteAccount}
        title="Delete Account Permanently?"
        message={
          <div className="block text-left">
            <p className="text-center text-[13.5px] sm:text-[14.5px] font-medium text-[#CBD5E1] leading-relaxed">
              This permanently erases your profile, saved addresses, and favorites.{" "}
              <span className="text-[#94A3B8]">
                {passwordlessGoogle
                  ? "Click Send Code to receive a 6-digit confirmation code on your account email."
                  : "Enter your current password to continue."}
              </span>
            </p>
            <div className="mt-5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[12.5px] sm:text-xs font-bold uppercase tracking-wider text-[#475569]">
                  {passwordlessGoogle ? "Email confirmation code" : "Current Password"}
                </label>
                {passwordlessGoogle && deleteCodeSent && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#22499F]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#22499F] animate-pulse" />
                    Code sent to email
                  </span>
                )}
              </div>
              {passwordlessGoogle ? (
                <div className="mt-2.5 flex items-center gap-2.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="Enter 6-digit code"
                    value={deletePassword}
                    onChange={(event) => {
                      setDeletePassword(event.target.value.replace(/\D/g, "").slice(0, 6));
                      setDeleteError("");
                    }}
                    autoComplete="one-time-code"
                    disabled={isDeleting}
                    className="h-12 sm:h-[50px] flex-1 rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] px-4 text-base font-bold tracking-widest text-[#1E293B] placeholder:text-sm placeholder:font-normal placeholder:tracking-normal placeholder:text-[#64748B] outline-none transition focus:border-[#22499F] focus:ring-1 focus:ring-[#22499F]/30 disabled:opacity-60"
                  />
                  <button
                    type="button"
                    disabled={deleteCodeSending || isDeleting || deleteResendSeconds > 0}
                    onClick={sendDeleteCode}
                    className="h-12 sm:h-[50px] shrink-0 flex items-center justify-center gap-2 rounded-2xl border border-[#22499F]/40 bg-[#FFFFFF] px-4 sm:px-5 text-[13px] sm:text-sm font-black text-[#22499F] shadow-xs hover:bg-[#22499F] hover:text-[#FFFFFF] active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer whitespace-nowrap"
                  >
                    {deleteCodeSending ? (
                      <>
                        <Loader2 size={14} className="animate-spin shrink-0" />
                        <span>Sending...</span>
                      </>
                    ) : deleteResendSeconds > 0 ? (
                      `Resend (${deleteResendSeconds}s)`
                    ) : deleteCodeSent ? (
                      "Resend Code"
                    ) : (
                      "Send Code"
                    )}
                  </button>
                </div>
              ) : (
                <input
                  type="password"
                  placeholder="Enter your current password"
                  value={deletePassword}
                  onChange={(event) => {
                    setDeletePassword(event.target.value);
                    setDeleteError("");
                  }}
                  autoComplete="current-password"
                  disabled={isDeleting}
                  className="mt-2.5 h-12 sm:h-[50px] w-full rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] px-4 text-sm sm:text-base text-[#1E293B] placeholder:text-sm placeholder:text-[#64748B] outline-none transition focus:border-[#22499F] focus:ring-1 focus:ring-[#22499F]/30 disabled:opacity-60"
                />
              )}
            </div>
            {deleteError && (
              <span role="alert" className="mt-2.5 block text-xs sm:text-[13px] font-semibold text-rose-400">
                {deleteError}
              </span>
            )}
          </div>
        }
        confirmText="Yes, Delete Account"
        cancelText="Keep Account"
        isLoading={isDeleting}
        variant="danger"
        icon={AlertTriangle}
      />
    </div>
  );
}

export default Profile;
