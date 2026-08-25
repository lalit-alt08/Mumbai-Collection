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
  AlertTriangle,
  Trash2,
} from "lucide-react";
import axios from "axios";
import ConfirmModal from "../components/common/ConfirmModal.jsx";

function Profile() {
  const navigate = useNavigate();
  const { user, deleteAccount } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete account state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    full_name: "",
    age: "",
    phone: "",
  });

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

      setProfile(profileData);

      setForm({
        full_name: profileData.full_name || "",
        age: profileData.age || "",
        phone: profileData.phone || "",
      });
    } catch (error) {
      console.error(
        " PROFILE LOAD ERROR:",
        error.response?.data || error.message
      );

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
  // INPUT CHANGE
  // ==============================

  const handleChange = (e) => {
    let { name, value } = e.target;

    if (name === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }

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
    setForm({
      full_name: profile?.full_name || "",
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
    setForm({
      full_name: profile?.full_name || "",
      age: profile?.age || "",
      phone: profile?.phone || "",
    });

    setError("");
    setSuccess("");
    setEditing(false);
  };

  // ==============================
  // SAVE
  // ==============================

  const handleSave = async (e) => {
    e.preventDefault();

    setError("");
    setSuccess("");

    if (!form.full_name.trim()) {
      setError("Full name is required.");
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
      setError("Please enter a valid age.");
      return;
    }

    if (!form.phone.trim()) {
      setError("Phone number is required.");
      return;
    }

    if (!isValidIndianPhone(form.phone)) {
      setError("Please enter a valid 10-digit Indian mobile number (e.g. 9876543210).");
      return;
    }

    try {
      setSaving(true);

      const response = await axios.put(
        `${API_URL}/profile`,
        {
          full_name: form.full_name.trim(),
          age: Number(form.age),
          phone: form.phone.trim(),
        },
        {
          withCredentials: true,
        }
      );

      const updatedProfile =
        response.data.profile || {
          ...profile,
          full_name: form.full_name.trim(),
          age: Number(form.age),
          phone: form.phone.trim(),
        };

      setProfile(updatedProfile);

      setForm({
        full_name: updatedProfile.full_name || "",
        age: updatedProfile.age || "",
        phone: updatedProfile.phone || "",
      });

      setEditing(false);
      setSuccess("Profile updated successfully.");
    } catch (error) {
      console.error(
        "PROFILE UPDATE ERROR:",
        error.response?.data || error.message
      );

      setError(
        error.response?.data?.message ||
          "Unable to update profile."
      );
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
      console.error("❌ DELETE ACCOUNT ERROR:", err.response?.data || err.message);

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
                  {profile?.full_name || "Your Name"}
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

              {/* FULL NAME */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Full Name
                </label>

                <div className="relative">
                  <User
                    size={19}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    type="text"
                    name="full_name"
                    value={form.full_name}
                    onChange={handleChange}
                    autoComplete="name"
                    placeholder="Enter your full name"
                    className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-[#1E1E1E] outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  />
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

              {/* PHONE */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Mobile Number
                </label>

                <div className="relative flex items-center">
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
                    autoComplete="tel"
                    placeholder="9876543210"
                    className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-14 pr-4 text-[#1E1E1E] outline-none transition focus:border-[#7C3AED] focus:bg-white focus:ring-4 focus:ring-[#7C3AED]/10"
                  />
                </div>
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
                  {profile?.full_name ||
                    "Not provided"}
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
                <div className="mb-3 flex items-center gap-2 text-gray-400">
                  <Phone size={18} />

                  <span className="text-xs font-bold uppercase tracking-wide">
                    Phone Number
                  </span>
                </div>

                <p className="font-semibold text-[#1E1E1E]">
                  {profile?.phone ||
                    "Not provided"}
                </p>
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

        {/* DANGER ZONE: DELETE ACCOUNT */}
        <div className="mt-8 rounded-3xl border border-red-200/80 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-red-600">
                <AlertTriangle size={15} />
                <span>Danger Zone</span>
              </div>
              <h3 className="mt-1 text-lg font-black text-gray-900 sm:text-xl">
                Delete Account Permanently
              </h3>
              <p className="mt-1 text-xs text-gray-500 sm:text-sm leading-relaxed max-w-lg">
                Permanently delete your Mumbai Collection customer account, saved addresses, and favorites. This action cannot be undone.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl border-2 border-red-200 bg-red-50 px-5 text-sm font-extrabold text-red-600 shadow-sm transition hover:bg-red-600 hover:border-red-600 hover:text-white active:scale-[0.98] cursor-pointer"
            >
              <Trash2 size={17} />
              <span>Delete Account</span>
            </button>
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