import { useEffect, useState } from "react";
import {
  User,
  Mail,
  Calendar,
  Phone,
  Pencil,
  X,
  Check,
  Loader2,
} from "lucide-react";
import axios from "axios";

function Profile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

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
        "http://localhost:5000/api/profile",
        {
          withCredentials: true,
        }
      );

      console.log("✅ PROFILE LOADED:", response.data);

      const profileData = response.data.profile || {};

      setProfile(profileData);

      setForm({
        full_name: profileData.full_name || "",
        age: profileData.age || "",
        phone: profileData.phone || "",
      });
    } catch (error) {
      console.error(
        "❌ PROFILE LOAD ERROR:",
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
    const { name, value } = e.target;

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

    try {
      setSaving(true);

      const response = await axios.put(
        "http://localhost:5000/api/profile",
        {
          full_name: form.full_name.trim(),
          age: Number(form.age),
          phone: form.phone.trim(),
        },
        {
          withCredentials: true,
        }
      );

      console.log(
        "✅ PROFILE UPDATED:",
        response.data
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
        "❌ PROFILE UPDATE ERROR:",
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
    <div className="min-h-screen bg-[#F8F9F5] px-5 py-8 md:px-10">
      <div className="mx-auto max-w-4xl">

        {/* HEADER */}
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-[#1E1E1E]">
            My Profile
          </h1>

          <p className="mt-2 text-gray-500">
            Manage your personal information.
          </p>
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

              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-orange-50">
                <User
                  size={30}
                  className="text-[#FF8A00]"
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
                className="flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 transition hover:border-[#FF8A00] hover:bg-orange-50 hover:text-[#FF8A00]"
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
                    className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-[#1E1E1E] outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
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
                    className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-[#1E1E1E] outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
                  />
                </div>
              </div>

              {/* PHONE */}
              <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">
                  Phone Number
                </label>

                <div className="relative">
                  <Phone
                    size={19}
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                  />

                  <input
                    type="tel"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    autoComplete="tel"
                    placeholder="Enter your phone number"
                    className="h-14 w-full rounded-2xl border border-gray-200 bg-gray-50 pl-12 pr-4 text-[#1E1E1E] outline-none transition focus:border-[#FF8A00] focus:bg-white focus:ring-4 focus:ring-[#FF8A00]/10"
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
                    value="Not available"
                    disabled
                    className="h-14 w-full cursor-not-allowed rounded-2xl border border-gray-200 bg-gray-100 pl-12 pr-4 text-gray-400 outline-none"
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
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#FF8A00] px-6 text-sm font-bold text-white transition hover:bg-[#FF7300] disabled:cursor-not-allowed disabled:opacity-70"
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
                  Not available
                </p>
              </div>

            </div>
          )}

        </div>
      </div>
    </div>
  );
}

export default Profile;