import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import API_URL from "../config/api.js";
import { isValidIndianPhone } from "../data/indianStates.js";
import { useAuth } from "../context/AuthContext";
import { sendOtp, verifyOtp, parseOtpRateLimitError } from "../services/authService";

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
  AlertTriangle,
  Trash2,
  Shield,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import axios from "axios";
import ConfirmModal from "../components/common/ConfirmModal.jsx";

function Profile() {
  const navigate = useNavigate();
  const { user, deleteAccount, updateUser, refreshUser, handleSessionExpired } = useAuth();
  const [profile, setProfile] = useState(() => {
    try {
      const cached = JSON.parse(localStorage.getItem("user_profile") || "null");
      return cached;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(!profile);
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Change phone modal state
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpSuccess, setOtpSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // Cooldown countdown timer for OTP resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    age: "",
    phone: "",
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

  // Cooldown timer for OTP resend
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

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

      setProfile(profileData);
      setIsPhoneVerified(isVerified && !!verifiedPhone && currentPhone === verifiedPhone);

      try {
        localStorage.setItem("user_profile", JSON.stringify(profileData));
      } catch {}

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
          verified_phone: verifiedPhone,
          is_phone_verified: isVerified && !!verifiedPhone && currentPhone === verifiedPhone,
        });
      }

      setForm({
        first_name: loadedFirst,
        last_name: loadedLast,
        age: profileData.age || "",
        phone: currentPhone,
      });
    } catch (error) {
      if (error.response?.status === 401) {
        if (handleSessionExpired) {
          handleSessionExpired();
        }
        navigate("/login", {
          replace: true,
          state: { from: "/profile" },
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
  // INPUT CHANGE (NAME & AGE ONLY)
  // ==============================

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "phone") return; // Phone is protected and not directly editable

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setError("");
    setSuccess("");
  };

  // ==============================
  // EDIT
  // ==============================

  const handleEdit = () => {
    const rawFullName = profile?.full_name || "";
    const nameParts = rawFullName.trim().split(/\s+/);
    const loadedFirst = profile?.first_name || nameParts[0] || "";
    const loadedLast = profile?.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

    setForm({
      first_name: loadedFirst,
      last_name: loadedLast,
      age: profile?.age || "",
      phone: profile?.phone || "",
    });

    setError("");
    setSuccess("");
    setEditing(true);
  };

  // ==============================
  // CANCEL
  // ==============================

  const handleCancel = () => {
    const rawFullName = profile?.full_name || "";
    const nameParts = rawFullName.trim().split(/\s+/);
    const loadedFirst = profile?.first_name || nameParts[0] || "";
    const loadedLast = profile?.last_name || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : "");

    setForm({
      first_name: loadedFirst,
      last_name: loadedLast,
      age: profile?.age || "",
      phone: profile?.phone || "",
    });

    setError("");
    setSuccess("");
    setEditing(false);
  };

  // ==============================
  // SAVE (NAME & AGE ONLY)
  // ==============================

  const handleSave = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (!form.first_name.trim()) {
      setError("First name is required.");
      return;
    }

    if (!form.last_name.trim()) {
      setError("Last name is required.");
      return;
    }

    if (!form.age) {
      setError("Age is required.");
      return;
    }

    if (
      Number(form.age) < 13 ||
      Number(form.age) > 120
    ) {
      setError("Please enter a valid age (13 - 120).");
      return;
    }

    try {
      setSaving(true);

      const cleanFirst = form.first_name.trim();
      const cleanLast = form.last_name.trim();
      const cleanFullName = `${cleanFirst} ${cleanLast}`;

      const response = await axios.put(
        `${API_URL}/profile`,
        {
          first_name: cleanFirst,
          last_name: cleanLast,
          full_name: cleanFullName,
          age: Number(form.age),
          phone: profile?.phone || form.phone || "",
        },
        {
          withCredentials: true,
        }
      );

      const updatedProfile =
        response.data.profile || {
          ...profile,
          first_name: cleanFirst,
          last_name: cleanLast,
          full_name: cleanFullName,
          age: Number(form.age),
          phone: profile?.phone || form.phone || "",
        };

      setProfile(updatedProfile);
      try {
        localStorage.setItem("user_profile", JSON.stringify(updatedProfile));
      } catch {}
      if (updateUser) {
        updateUser({
          first_name: cleanFirst,
          last_name: cleanLast,
          name: cleanFullName,
          full_name: cleanFullName,
        });
      }

      setForm({
        first_name: cleanFirst,
        last_name: cleanLast,
        age: updatedProfile.age || "",
        phone: updatedProfile.phone || "",
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
          state: { from: "/profile" },
        });
        return;
      }

      setError(
        error.response?.data?.message ||
          "Unable to update profile."
      );
    } finally {
      setSaving(false);
    }
  };

  // ==============================
  // CHANGE PHONE NUMBER OTP FLOW
  // ==============================

  const openPhoneModal = () => {
    setNewPhone("");
    setOtp("");
    setOtpSent(false);
    setOtpLoading(false);
    setOtpError("");
    setOtpSuccess("");
    setShowPhoneModal(true);
  };

  const closePhoneModal = () => {
    if (otpLoading) return;
    setShowPhoneModal(false);
    setNewPhone("");
    setOtp("");
    setOtpSent(false);
    setOtpError("");
    setOtpSuccess("");
  };

  const handleSendPhoneOtp = async () => {
    setOtpError("");
    setOtpSuccess("");

    if (!isValidIndianPhone(newPhone)) {
      setOtpError("Please enter a valid 10-digit Indian mobile number.");
      return;
    }

    const cleanNew = String(newPhone).replace(/\D/g, "");
    const cleanCurrent = String(profile?.phone || user?.phone || "").replace(/\D/g, "");
    if (cleanCurrent && cleanNew === cleanCurrent) {
      setOtpError("New mobile number must be different from your current number.");
      return;
    }

    try {
      setOtpLoading(true);
      const res = await sendOtp(cleanNew, "verify_phone");
      setOtpSent(true);
      setOtpSuccess(res.message || (res.masked_email ? `Verification code sent to ${res.masked_email}` : "Verification code sent to your registered email."));
      setCooldown(60);
    } catch (err) {
      if (err.response?.status === 401) {
        if (handleSessionExpired) handleSessionExpired();
        navigate("/login", { replace: true, state: { from: "/profile" } });
        return;
      }
      const parsed = parseOtpRateLimitError(err);
      if (parsed.isRateLimited) {
        setOtpError(parsed.message);
        setCooldown(parsed.retryAfter);
      } else {
        setOtpError(parsed.message);
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async () => {
    setOtpError("");
    setOtpSuccess("");

    const cleanOtp = String(otp || "").trim();
    if (!cleanOtp || cleanOtp.length !== 6) {
      setOtpError("Please enter the 6-digit verification code.");
      return;
    }

    try {
      setOtpLoading(true);
      const cleanNew = String(newPhone).replace(/\D/g, "");
      const res = await verifyOtp(cleanNew, cleanOtp, "verify_phone");

      if (res.success) {
        const verifiedNum = res.verified_phone || res.phone || cleanNew;
        const updated = {
          ...(profile || {}),
          phone: verifiedNum,
          verified_phone: verifiedNum,
        };

        setProfile(updated);
        setIsPhoneVerified(true);
        setForm((prev) => ({ ...prev, phone: verifiedNum }));

        try {
          localStorage.setItem("user_profile", JSON.stringify(updated));
        } catch {}

        if (updateUser) {
          updateUser({
            phone: verifiedNum,
            verified_phone: verifiedNum,
            is_phone_verified: true,
          });
        }

        if (refreshUser) {
          await refreshUser();
        }

        closePhoneModal();
        setSuccess("Mobile number updated and verified successfully!");
      } else {
        setOtpError(res.message || "Verification failed. Please try again.");
      }
    } catch (err) {
      if (err.response?.status === 401) {
        if (handleSessionExpired) handleSessionExpired();
        navigate("/login", { replace: true, state: { from: "/profile" } });
        return;
      }
      setOtpError(err.response?.data?.message || "Invalid or expired verification code.");
    } finally {
      setOtpLoading(false);
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-gray-500">
          Loading profile...
        </p>
      </div>
    );
  }

  // ==============================
  // ERROR
  // ==============================

  if (error && !editing && !profile) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <div className="rounded-2xl bg-red-50 p-5 text-red-600">
          {error}
        </div>
      </div>
    );
  }

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
              My Profile
            </h1>
            <p className="text-xs text-gray-500 font-medium sm:text-sm">
              Manage your personal information.
            </p>
          </div>
        </div>

        {/* SUCCESS */}
        {success && (
          <div className="mb-5 rounded-2xl bg-green-50 p-4 text-sm font-medium text-green-600">
            {success}
          </div>
        )}

        {/* ERROR */}
        {error && (
          <div className="mb-5 rounded-2xl bg-red-50 p-4 text-sm font-medium text-red-600">
            {error}
          </div>
        )}

        {/* PROFILE CARD */}
        <div className="rounded-3xl bg-white p-6 shadow-sm md:p-8">

          {/* PROFILE HEADER */}
          <div className="mb-8 flex items-center justify-between gap-4">

            <div className="flex items-center gap-4">

              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-[#F1ECFF]">
                <User
                  size={30}
                  className="text-[#7C3AED]"
                />
              </div>

              <div>
                <h2 className="text-xl font-extrabold text-[#1E1E1E]">
                  {getCleanDisplayName(profile?.full_name, profile?.first_name, profile?.last_name, "Your Name")}
                </h2>

                <p className="mt-1 text-sm text-gray-500">
                  Personal Information
                </p>
              </div>

            </div>

            {/* EDIT BUTTON */}
            {!editing && (
              <button
                type="button"
                onClick={handleEdit}
                className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition hover:border-[#7C3AED] hover:bg-[#F1ECFF] hover:text-[#7C3AED]"
              >
                <Pencil size={17} />
                Edit
              </button>
            )}

          </div>

          {/* ========================================= */}
          {/* EDIT MODE */}
          {/* ========================================= */}

          {editing ? (
            <form
              onSubmit={handleSave}
              className="space-y-5"
            >

              {/* FIRST NAME & LAST NAME */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    First Name <span className="text-[#7C3AED]">*</span>
                  </label>

                  <div className="relative">
                    <User
                      size={19}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                    />

                    <input
                      type="text"
                      name="first_name"
                      value={form.first_name}
                      onChange={handleChange}
                      autoComplete="given-name"
                      placeholder="e.g. Rahul"
                      required
                      className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-[#1E1E1E] outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-gray-700">
                    Last Name <span className="text-[#7C3AED]">*</span>
                  </label>

                  <div className="relative">
                    <User
                      size={19}
                      className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                    />

                    <input
                      type="text"
                      name="last_name"
                      value={form.last_name}
                      onChange={handleChange}
                      autoComplete="family-name"
                      placeholder="e.g. Sharma"
                      required
                      className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-[#1E1E1E] outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                    />
                  </div>
                </div>
              </div>

              {/* AGE */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Age
                </label>

                <div className="relative">
                  <Calendar
                    size={19}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    type="number"
                    name="age"
                    value={form.age}
                    onChange={handleChange}
                    min="13"
                    max="120"
                    placeholder="Enter your age"
                    className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-[#1E1E1E] outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  />
                </div>
              </div>

              {/* PHONE (READ-ONLY WITH DEDICATED CHANGE ACTION) */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-sm font-bold text-gray-700">
                    Mobile Number
                  </label>
                  {isPhoneVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                      <CheckCircle2 size={11} /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                      Unverified
                    </span>
                  )}
                </div>

                <div className="relative flex items-center">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-400">
                    +91
                  </span>

                  <input
                    type="tel"
                    value={profile?.phone || form.phone || ""}
                    readOnly
                    disabled
                    className="h-14 w-full cursor-not-allowed rounded-2xl border border-gray-200 bg-gray-100/80 pl-14 pr-32 text-gray-600 outline-none select-none font-semibold text-sm sm:text-base"
                  />

                  <button
                    type="button"
                    onClick={openPhoneModal}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-[#7C3AED] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#6D28D9] active:scale-95 cursor-pointer shadow-xs"
                  >
                    Change Phone
                  </button>
                </div>

                <p className="mt-1.5 text-xs text-gray-500 font-medium">
                  Verified phone numbers are protected and require OTP verification to change.
                </p>
              </div>

              {/* EMAIL */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Email
                </label>

                <div className="relative">
                  <Mail
                    size={19}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    type="text"
                    value={profile?.email || user?.email || "Not available"}
                    disabled
                    className="h-14 w-full cursor-not-allowed rounded-2xl border border-gray-200 bg-gray-100 pl-12 pr-4 text-gray-500 outline-none"
                  />
                </div>

                <p className="mt-2 text-xs text-gray-400">
                  Email cannot be changed from this page.
                </p>
              </div>

              {/* BUTTONS */}
              <div className="flex flex-col gap-3 pt-3 sm:flex-row sm:justify-end">

                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={saving}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl border border-gray-200 px-6 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                >
                  <X size={17} />
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-6 text-sm font-bold text-white transition hover:bg-[#6C35E8] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? (
                    <>
                      <Loader2
                        size={17}
                        className="animate-spin"
                      />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Check size={17} />
                      Save Changes
                    </>
                  )}
                </button>

              </div>

            </form>
          ) : (

            /* ========================================= */
            /* NORMAL VIEW MODE */
            /* ========================================= */

            <div className="grid gap-5 md:grid-cols-2">

              {/* FULL NAME */}
              <div className="rounded-2xl bg-gray-50 p-5">
                <div className="mb-3 flex items-center gap-2 text-gray-400">
                  <User size={18} />

                  <span className="text-xs font-bold uppercase tracking-wide">
                    Full Name
                  </span>
                </div>

                <p className="font-semibold text-[#1E1E1E]">
                  {getCleanDisplayName(profile?.full_name, profile?.first_name, profile?.last_name, "Not provided")}
                </p>
              </div>

              {/* AGE */}
              <div className="rounded-2xl bg-gray-50 p-5">
                <div className="mb-3 flex items-center gap-2 text-gray-400">
                  <Calendar size={18} />

                  <span className="text-xs font-bold uppercase tracking-wide">
                    Age
                  </span>
                </div>

                <p className="font-semibold text-[#1E1E1E]">
                  {profile?.age ||
                    "Not provided"}
                </p>
              </div>

              {/* PHONE */}
              <div className="rounded-2xl bg-gray-50 p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-gray-400">
                    <Phone size={18} />

                    <span className="text-xs font-bold uppercase tracking-wide">
                      Phone Number
                    </span>
                  </div>

                  {isPhoneVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                      <CheckCircle2 size={11} /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 border border-amber-200">
                      Unverified
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-[#1E1E1E]">
                    {profile?.phone ? `+91 ${profile.phone}` : "Not provided"}
                  </p>

                  <button
                    type="button"
                    onClick={openPhoneModal}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#7C3AED]/30 bg-[#F5F3FF] px-3 py-1.5 text-xs font-bold text-[#7C3AED] transition hover:bg-[#EDE9FE] active:scale-95 cursor-pointer"
                  >
                    <RefreshCw size={12} />
                    <span>Change</span>
                  </button>
                </div>
              </div>

              {/* EMAIL */}
              <div className="rounded-2xl bg-gray-50 p-5">
                <div className="mb-3 flex items-center gap-2 text-gray-400">
                  <Mail size={18} />

                  <span className="text-xs font-bold uppercase tracking-wide">
                    Email
                  </span>
                </div>

                <p className="break-all font-semibold text-[#1E1E1E]">
                  {profile?.email || user?.email || "Not available"}
                </p>
              </div>

            </div>
          )}

        </div>

        {/* ACCOUNT PRIVACY: DELETE ACCOUNT */}
        <div className="mt-6 space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Shield size={14} className="text-gray-500" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Account Privacy
            </h3>
          </div>

          <div className="rounded-2xl border border-red-100 bg-red-50/40 p-3.5 sm:p-4 transition hover:bg-red-50/60">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-red-600">
                  <AlertTriangle size={13} />
                  <span>Delete Account</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
                  Permanently delete your account, addresses, and saved data.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="shrink-0 flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 shadow-2xs transition hover:bg-red-600 hover:border-red-600 hover:text-white active:scale-95 cursor-pointer"
              >
                <Trash2 size={13} />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* CHANGE PHONE NUMBER OTP MODAL */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#6D28D9]">
                  <Phone size={19} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-[#111827]">
                    Change Mobile Number
                  </h3>
                  <p className="text-xs text-gray-500 font-medium">
                    Requires email verification code
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={closePhoneModal}
                disabled={otpLoading}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 cursor-pointer disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            {/* Current Phone Reassurance */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-center justify-between text-xs">
              <span className="text-gray-500 font-medium">Current Number:</span>
              <span className="font-bold text-gray-900">
                +91 {profile?.phone || "None"}
              </span>
            </div>

            {/* Error & Success Feedback */}
            {otpError && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700 border border-red-200">
                <AlertCircle size={15} className="shrink-0 text-red-600" />
                <span>{otpError}</span>
              </div>
            )}

            {otpSuccess && (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700 border border-emerald-200">
                <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
                <span>{otpSuccess}</span>
              </div>
            )}

            {/* STEP 1: Enter New Phone */}
            {!otpSent ? (
              <div className="space-y-3.5">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-gray-700">
                    New Mobile Number <span className="text-[#7C3AED]">*</span>
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-sm font-bold text-gray-400">
                      +91
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={newPhone}
                      onChange={(e) => {
                        setNewPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                        setOtpError("");
                      }}
                      placeholder="9876543210"
                      autoFocus
                      className="h-12 w-full rounded-xl border border-gray-200 bg-gray-50/70 pl-12 pr-4 text-sm font-semibold text-gray-900 outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-3 focus:ring-[#7C3AED]/10"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500 font-medium">
                    A 6-digit verification code will be sent to your registered account email to confirm this change.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closePhoneModal}
                    disabled={otpLoading}
                    className="h-11 rounded-xl border border-gray-200 px-4 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSendPhoneOtp}
                    disabled={otpLoading || newPhone.length !== 10 || cooldown > 0}
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-5 text-xs font-bold text-white shadow-xs hover:bg-[#6D28D9] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    {otpLoading ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        <span>Sending OTP...</span>
                      </>
                    ) : cooldown > 0 ? (
                      <span>Wait ({cooldown}s)</span>
                    ) : (
                      <>
                        <span>Send OTP</span>
                        <ArrowRight size={14} />
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              /* STEP 2: Enter OTP Code */
              <div className="space-y-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-gray-700">
                      6-Digit Verification Code <span className="text-[#7C3AED]">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setOtpSent(false);
                        setOtp("");
                        setOtpError("");
                      }}
                      className="text-[11px] font-bold text-[#7C3AED] hover:underline"
                    >
                      Change Number
                    </button>
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => {
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                      setOtpError("");
                    }}
                    placeholder="••••••"
                    autoFocus
                    className="h-12 w-full rounded-xl border border-gray-300 bg-white px-3 text-center text-lg font-extrabold tracking-[0.35em] text-gray-900 outline-none transition focus:border-[#7C3AED] focus:ring-3 focus:ring-[#7C3AED]/20"
                  />
                  <p className="mt-1.5 text-xs text-gray-500 font-medium">
                    Check your registered account email for the 6-digit verification code.
                  </p>
                </div>

                <div className="flex items-center justify-between text-xs pt-0.5">
                  <span className="text-gray-500">Didn't receive the email?</span>
                  {cooldown > 0 ? (
                    <span className="font-semibold text-gray-400">Resend in {cooldown}s</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendPhoneOtp}
                      disabled={otpLoading}
                      className="font-bold text-[#7C3AED] hover:underline cursor-pointer"
                    >
                      Resend Code
                    </button>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closePhoneModal}
                    disabled={otpLoading}
                    className="h-11 rounded-xl border border-gray-200 px-4 text-xs font-bold text-gray-600 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleVerifyPhoneOtp}
                    disabled={otpLoading || otp.length !== 6}
                    className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-5 text-xs font-extrabold text-white shadow-xs hover:bg-[#6D28D9] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    {otpLoading ? (
                      <>
                        <Loader2 size={15} className="animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <Check size={15} />
                        <span>Verify & Save</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

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