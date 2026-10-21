import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API_URL from "../config/api.js";
import { isValidIndianPhone } from "../data/indianStates.js";
import { useAuth } from "../context/AuthContext";

import {
  User,
  Mail,
  Calendar,
  Phone,
  Pencil,
  X,
  Check,
  Loader2,
  ArrowLeft,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Shield,
} from "lucide-react";
import axios from "axios";
import safeStorage from "../utils/safeStorage.js";
import ConfirmModal from "../components/common/ConfirmModal.jsx";
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";

function Profile() {
  const navigate = useNavigate();
  const { user, deleteAccount, updateUser, handleSessionExpired } = useAuth();
  const [profile, setProfile] = useState(() => {
    return safeStorage.getJSON("user_profile", null);
  });
  const [loading, setLoading] = useState(!profile);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    age: "",
    phone: "",
    secondary_phone: "",
  });

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
  // LOAD PROFILE
  // ==============================

  const loadProfile = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await axios.get(
       `${API_URL}/profile`,
        {
          withCredentials: true,
        }
      );

      const profileData = response.data.profile || {};
      const isVerified = response.data.is_phone_verified === true;
      const verifiedPhone = response.data.verified_phone || user?.verified_phone || "";
      const currentPhone = profileData.phone || response.data.billing_phone || user?.phone || "";
      const secondaryPhone = profileData.secondary_phone || response.data.secondary_phone || user?.secondary_phone || "";

      const mergedProfile = {
        ...profileData,
        phone: currentPhone,
        secondary_phone: secondaryPhone,
      };

      setProfile(mergedProfile);
      safeStorage.setJSON("user_profile", mergedProfile);

      const rawFullName = profileData.full_name || user?.name || user?.full_name || "";
      const nameParts = rawFullName.trim().split(/\s+/);
      const loadedFirst = profileData.first_name || user?.first_name || nameParts[0] || "";
      const loadedLast = profileData.last_name || user?.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

      if (updateUser && (rawFullName || loadedFirst)) {
        updateUser({
          first_name: loadedFirst,
          last_name: loadedLast,
          name: rawFullName || `${loadedFirst} ${loadedLast}`.trim(),
          full_name: rawFullName || `${loadedFirst} ${loadedLast}`.trim(),
          phone: currentPhone,
          secondary_phone: secondaryPhone,
          verified_phone: verifiedPhone,
          is_phone_verified: isVerified && !!verifiedPhone && currentPhone === verifiedPhone,
        });
      }

      setForm({
        first_name: loadedFirst,
        last_name: loadedLast,
        age: profileData.age || "",
        phone: currentPhone,
        secondary_phone: secondaryPhone,
      });
    } catch (error) {
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
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  // ==============================
  // INPUT CHANGE (NAME, AGE & SECONDARY PHONE)
  // ==============================

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Primary phone is locked once set; allow editing only if user has no phone yet
    if (name === "phone" && (profile?.phone || user?.phone)) return;

    let nextValue = value;
    if (name === "phone" || name === "secondary_phone") {
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
      age: profile?.age || "",
      phone: profile?.phone || user?.phone || "",
      secondary_phone: profile?.secondary_phone || user?.secondary_phone || "",
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
      age: profile?.age || "",
      phone: profile?.phone || user?.phone || "",
      secondary_phone: profile?.secondary_phone || user?.secondary_phone || "",
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

    if (!form.age) {
      newFieldErrors.age = "Age is required.";
    } else if (Number(form.age) < 13 || Number(form.age) > 120) {
      newFieldErrors.age = "Please enter a valid age (13 - 120).";
    }

    // Validate primary phone only if user is setting it for the first time
    if (!profile?.phone && (!form.phone || !isValidIndianPhone(form.phone))) {
      newFieldErrors.phone = "Please enter a valid 10-digit primary Indian mobile number.";
    }

    // Validate secondary phone if provided
    const cleanSecondary = form.secondary_phone ? form.secondary_phone.replace(/\D/g, "").slice(0, 10) : "";
    const effectivePrimary = (profile?.phone || form.phone || "").replace(/\D/g, "").slice(0, 10);

    if (form.secondary_phone && cleanSecondary.length > 0) {
      if (!isValidIndianPhone(cleanSecondary)) {
        newFieldErrors.secondary_phone = "Please enter a valid 10-digit alternative mobile number.";
      } else if (cleanSecondary === effectivePrimary) {
        newFieldErrors.secondary_phone = "Alternative mobile number cannot be the same as your primary mobile number.";
      }
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
          age: Number(form.age),
          phone: cleanPhone,
          secondary_phone: cleanSecondary,
        },
        {
          withCredentials: true,
        }
      );

      const returnedProfile = response.data?.profile || {};
      const finalSecondary =
        returnedProfile.secondary_phone !== undefined && returnedProfile.secondary_phone !== null
          ? returnedProfile.secondary_phone
          : (response.data?.secondary_phone !== undefined && response.data?.secondary_phone !== null
            ? response.data.secondary_phone
            : cleanSecondary);

      const updatedProfile = {
        ...profile,
        ...returnedProfile,
        first_name: cleanFirst,
        last_name: cleanLast,
        full_name: cleanFullName,
        age: Number(form.age),
        phone: cleanPhone,
        secondary_phone: finalSecondary,
      };

      setProfile(updatedProfile);
      safeStorage.setJSON("user_profile", updatedProfile);
      if (updateUser) {
        updateUser({
          first_name: cleanFirst,
          last_name: cleanLast,
          name: cleanFullName,
          full_name: cleanFullName,
          phone: cleanPhone,
          secondary_phone: finalSecondary,
        });
      }

      setForm({
        first_name: cleanFirst,
        last_name: cleanLast,
        age: updatedProfile.age || "",
        phone: updatedProfile.phone || "",
        secondary_phone: finalSecondary || "",
      });

      setEditing(false);
      setSuccess("Profile updated successfully.");
    } catch (error) {
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
        (lower.includes("phone") && !lower.includes("secondary") && !lower.includes("alternative")) ||
        (lower.includes("mobile") && !lower.includes("secondary") && !lower.includes("alternative"))
      ) {
        targetField = "phone";
      } else if (lower.includes("secondary") || lower.includes("alternative")) {
        targetField = "secondary_phone";
      } else if (lower.includes("first name")) {
        targetField = "first_name";
      } else if (lower.includes("last name")) {
        targetField = "last_name";
      } else if (lower.includes("age")) {
        targetField = "age";
      }

      if (targetField) {
        setFieldErrors({ [targetField]: serverMsg });
        setError("");
        setTimeout(() => {
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
      setSaving(false);
    }
  };

  // ==============================
  // DELETE ACCOUNT
  // ==============================

  const handleDeleteAccount = async () => {
    if (isDeleting) return;

    try {
      setIsDeleting(true);
      setError("");

      await deleteAccount();
      setShowDeleteModal(false);

      navigate("/", {
        replace: true,
        state: {
          accountDeleted: true,
          message: "Your account has been permanently deleted.",
        },
      });
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Failed to delete account. Please try again or contact support."
      );
      setShowDeleteModal(false);
    } finally {
      setIsDeleting(false);
    }
  };

  // ==============================
  // LOADING
  // ==============================

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1E3252] border-t-[#42D6E8]" />
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
    <div className="min-h-screen bg-[#0B1425] text-[#F1F5F9] px-4 py-4 sm:px-5 sm:py-6 pb-24 sm:pb-16">
      <div className="mx-auto max-w-xl">

        {/* HEADER */}
        <div className="mb-4 flex items-center gap-3">
          <button
            onClick={() => {
              if (window.history.state && window.history.state.idx > 0) {
                navigate(-1);
              } else {
                navigate("/account", { replace: true });
              }
            }}
            aria-label="Back to Account"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#111F36] text-[#F1F5F9] shadow-xs border border-[#1E3252] transition hover:bg-[#42D6E8] hover:text-[#061220] hover:border-[#42D6E8] cursor-pointer active:scale-95"
          >
            <ArrowLeft size={17} />
          </button>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight text-[#F1F5F9] sm:text-2xl">
              My Profile
            </h1>
            <p className="text-xs text-[#8FA4BE] font-medium">
              Manage your personal information
            </p>
          </div>
        </div>

        {/* SUCCESS */}
        {success && (
          <div className="mb-4 rounded-xl border border-emerald-500 bg-[#132B45] p-3 text-xs font-semibold text-emerald-300">
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
        <div className="overflow-hidden rounded-[22px] border border-[#1E3252]/80 bg-[#111F36] shadow-lg">

          {/* PROFILE HERO HEADER */}
          <div className="flex items-center justify-between gap-3.5 p-4 sm:p-5 border-b border-[#1E3252]/60">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-13 w-13 sm:h-14 sm:w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#42D6E8] to-[#2CC4D8] text-[#061220] font-black text-lg sm:text-xl shadow-sm ring-1 ring-[#1E3252]">
                {avatarInitials}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-extrabold text-[#F1F5F9] truncate">
                  {displayName}
                </h2>
                <p className="text-xs sm:text-sm text-[#8FA4BE] truncate mt-0.5">
                  {editing ? "Editing Information" : "Personal Information"}
                </p>
              </div>
            </div>

            {!editing && (
              <button
                type="button"
                onClick={handleEdit}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#132B45] border border-[#1E3252] px-4 py-2 text-xs sm:text-sm font-bold text-[#67E8F9] shadow-xs transition hover:bg-[#42D6E8] hover:text-[#061220] active:scale-95 cursor-pointer"
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
                  <label className={`mb-1.5 block text-xs font-bold ${fieldErrors.first_name ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    First Name <span className={fieldErrors.first_name ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                  </label>
                  <div className="relative">
                    <User
                      size={15}
                      className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${fieldErrors.first_name ? "text-rose-400" : "text-[#6E84A3]"}`}
                    />
                    <input
                      type="text"
                      name="first_name"
                      value={form.first_name}
                      onChange={handleChange}
                      autoComplete="given-name"
                      placeholder="e.g. Rahul"
                      required
                      className={`h-11 w-full rounded-xl border pl-10 pr-3.5 text-sm text-[#F1F5F9] outline-none transition ${
                        fieldErrors.first_name
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                          : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
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
                  <label className={`mb-1.5 block text-xs font-bold ${fieldErrors.last_name ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    Last Name <span className={fieldErrors.last_name ? "text-rose-400" : "text-[#42D6E8]"}>*</span>
                  </label>
                  <div className="relative">
                    <User
                      size={15}
                      className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${fieldErrors.last_name ? "text-rose-400" : "text-[#6E84A3]"}`}
                    />
                    <input
                      type="text"
                      name="last_name"
                      value={form.last_name}
                      onChange={handleChange}
                      autoComplete="family-name"
                      placeholder="e.g. Sharma"
                      required
                      className={`h-11 w-full rounded-xl border pl-10 pr-3.5 text-sm text-[#F1F5F9] outline-none transition ${
                        fieldErrors.last_name
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                          : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
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

              {/* AGE */}
              <div>
                <label className={`mb-1.5 block text-xs font-bold ${fieldErrors.age ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                  Age
                </label>
                <div className="relative">
                  <Calendar
                    size={15}
                    className={`absolute left-3.5 top-1/2 -translate-y-1/2 ${fieldErrors.age ? "text-rose-400" : "text-[#6E84A3]"}`}
                  />
                  <input
                    type="number"
                    name="age"
                    value={form.age}
                    onChange={handleChange}
                    min="13"
                    max="120"
                    placeholder="Enter your age"
                    className={`h-11 w-full rounded-xl border pl-10 pr-3.5 text-sm text-[#F1F5F9] outline-none transition ${
                      fieldErrors.age
                        ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20"
                        : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                    }`}
                  />
                </div>
                {fieldErrors.age && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                    <AlertCircle size={12} className="shrink-0 text-rose-400" />
                    <span>{fieldErrors.age}</span>
                  </p>
                )}
              </div>

              {/* PRIMARY PHONE */}
              <div>
                <label className={`mb-1.5 block text-xs font-bold ${fieldErrors.phone ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                  Primary Mobile
                </label>
                <div className="relative flex items-center">
                  <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold ${fieldErrors.phone ? "text-rose-400" : "text-[#6E84A3]"}`}>
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    name="phone"
                    value={profile?.phone || user?.phone || form.phone}
                    onChange={handleChange}
                    disabled={Boolean(profile?.phone || user?.phone)}
                    className={`h-11 w-full rounded-xl border pl-11 pr-3.5 outline-none transition font-semibold text-sm ${
                      fieldErrors.phone
                        ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20 text-[#F1F5F9]"
                        : (profile?.phone || user?.phone)
                        ? "cursor-not-allowed border-[#1E3252] bg-[#080F1C]/50 text-[#6E84A3]"
                        : "border-[#1E3252] bg-[#080F1C] text-[#F1F5F9] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                    }`}
                  />
                </div>
                {fieldErrors.phone ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                    <AlertCircle size={12} className="shrink-0 text-rose-400" />
                    <span>{fieldErrors.phone}</span>
                  </p>
                ) : (profile?.phone || user?.phone) ? (
                  <p className="mt-1 text-[11px] text-[#6E84A3]">
                    Primary mobile cannot be changed from this page.
                  </p>
                ) : null}
              </div>

              {/* SECONDARY MOBILE */}
              <div>
                <label className={`mb-1.5 block text-xs font-bold ${fieldErrors.secondary_phone ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                  Secondary Mobile
                </label>
                <div className="relative flex items-center">
                  <span className={`absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-bold ${fieldErrors.secondary_phone ? "text-rose-400" : "text-[#6E84A3]"}`}>
                    +91
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={15}
                    name="secondary_phone"
                    value={form.secondary_phone}
                    onChange={handleChange}
                    placeholder="Enter secondary mobile"
                    className={`h-11 w-full rounded-xl border pl-11 pr-3.5 text-sm outline-none transition font-semibold ${
                      fieldErrors.secondary_phone
                        ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/20 text-[#F1F5F9]"
                        : "border-[#1E3252] bg-[#080F1C] text-[#F1F5F9] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                    }`}
                  />
                </div>
                {fieldErrors.secondary_phone ? (
                  <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                    <AlertCircle size={12} className="shrink-0 text-rose-400" />
                    <span>{fieldErrors.secondary_phone}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-[#6E84A3]">
                    Used by our delivery team if your primary mobile is unreachable.
                  </p>
                )}
              </div>

              {/* EMAIL */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-[#8FA4BE]">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    size={15}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6E84A3]"
                  />
                  <input
                    type="text"
                    value={profile?.email || user?.email || "Not available"}
                    disabled
                    className="h-11 w-full cursor-not-allowed rounded-xl border border-[#1E3252] bg-[#080F1C]/50 pl-10 pr-3.5 text-sm text-[#6E84A3] outline-none"
                  />
                </div>
                <p className="mt-1 text-[11px] text-[#6E84A3]">
                  Email cannot be changed from this page.
                </p>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[#1E3252] bg-[#080F1C] px-4 text-xs font-bold text-[#8FA4BE] transition hover:bg-[#162744] hover:text-[#F1F5F9] disabled:opacity-50 cursor-pointer"
                >
                  <X size={15} />
                  <span>Cancel</span>
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#42D6E8] px-5 text-xs font-black text-[#061220] transition hover:bg-[#2CC4D8] active:scale-95 disabled:cursor-not-allowed disabled:opacity-70 cursor-pointer shadow-xs"
                >
                  {saving ? (
                    <>
                      <Loader2
                        size={15}
                        className="animate-spin text-[#061220]"
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
            <div className="divide-y divide-[#1E3252]/60">

              {/* FULL NAME */}
              <div className="flex items-center justify-between gap-3 px-4.5 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-[#13243F]/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                    <User size={17} />
                  </div>
                  <span className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-[#8FA4BE]">
                    Full Name
                  </span>
                </div>
                <span className="text-right text-[15px] sm:text-base font-semibold text-[#F1F5F9] truncate max-w-[58%]">
                  {displayName}
                </span>
              </div>

              {/* AGE */}
              <div className="flex items-center justify-between gap-3 px-4.5 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-[#13243F]/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                    <Calendar size={17} />
                  </div>
                  <span className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-[#8FA4BE]">
                    Age
                  </span>
                </div>
                <span className={`text-right text-[15px] sm:text-base font-semibold ${profile?.age ? "text-[#F1F5F9]" : "text-[#6E84A3]"}`}>
                  {profile?.age || "Not provided"}
                </span>
              </div>

              {/* PRIMARY MOBILE */}
              <div className="flex items-center justify-between gap-3 px-4.5 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-[#13243F]/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                    <Phone size={17} />
                  </div>
                  <span className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-[#8FA4BE] whitespace-nowrap">
                    Primary Mobile
                  </span>
                </div>
                <span className={`text-right text-[15px] sm:text-base font-semibold font-mono whitespace-nowrap ${(profile?.phone || user?.phone) ? "text-[#F1F5F9]" : "text-[#6E84A3]"}`}>
                  {(profile?.phone || user?.phone)
                    ? formatPhoneNumber(profile?.phone || user?.phone)
                    : "Not provided"}
                </span>
              </div>

              {/* SECONDARY MOBILE */}
              <div className="flex items-center justify-between gap-3 px-4.5 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-[#13243F]/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                    <Phone size={17} />
                  </div>
                  <span className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-[#8FA4BE] whitespace-nowrap">
                    Secondary Mobile
                  </span>
                </div>
                <span className={`text-right text-[15px] sm:text-base font-semibold font-mono whitespace-nowrap ${(profile?.secondary_phone || user?.secondary_phone) ? "text-[#F1F5F9]" : "text-[#6E84A3]"}`}>
                  {(profile?.secondary_phone || user?.secondary_phone)
                    ? formatPhoneNumber(profile?.secondary_phone || user?.secondary_phone)
                    : "Not provided"}
                </span>
              </div>

              {/* EMAIL */}
              <div className="flex items-center justify-between gap-3 px-4.5 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-[#13243F]/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#132B45] text-[#42D6E8] border border-[#1E3252]">
                    <Mail size={17} />
                  </div>
                  <span className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-[#8FA4BE]">
                    Email
                  </span>
                </div>
                <span className="text-right text-sm sm:text-[15px] font-semibold text-[#F1F5F9] break-all max-w-[58%] sm:max-w-none">
                  {profile?.email || user?.email || "Not available"}
                </span>
              </div>

            </div>
          )}

        </div>

        {/* ACCOUNT PRIVACY: DELETE ACCOUNT */}
        <div className="mt-5 space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Shield size={14} className="text-[#6E84A3]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#6E84A3]">
              Account Privacy
            </h3>
          </div>

          <div className="rounded-[18px] border border-rose-900/60 bg-rose-950/25 p-4 transition hover:bg-rose-950/35">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-bold text-rose-400">
                  <AlertTriangle size={14} />
                  <span>Delete Account</span>
                </div>
                <p className="mt-0.5 text-xs leading-snug text-[#8FA4BE]">
                  Permanently delete your account, addresses, and saved data.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="shrink-0 flex items-center gap-1.5 rounded-xl border border-rose-900/60 bg-[#111F36] px-3.5 py-2 text-xs sm:text-sm font-bold text-rose-400 shadow-2xs transition hover:bg-rose-600 hover:border-rose-600 hover:text-white active:scale-95 cursor-pointer"
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
          if (!isDeleting) setShowDeleteModal(false);
        }}
        onConfirm={handleDeleteAccount}
        title="Delete Account Permanently?"
        message="Are you sure you want to permanently delete your Mumbai Collection account? All your profile data, saved addresses, and favorites will be permanently erased and you will be logged out immediately."
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
