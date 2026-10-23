import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import API_URL from "../config/api.js";
import {
  User,
  MapPin,
  Home,
  Building2,
  Pencil,
  Trash2,
  Plus,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  ShieldCheck,
  Lock,
  Eye,
  EyeOff,
  Check,
  Loader2,
} from "lucide-react";
import {
  DELIVERY_REGIONS,
  isValidDeliveryRegion,
  isValidIndianPhone,
} from "../data/indianStates.js";
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";
import { validatePassword, getPasswordRuleChecks } from "../utils/passwordValidator.js";
import { useAuth } from "../context/AuthContext";

function ProfileSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const submittingRef = useRef(false);
  const { user, refreshUser, handleSessionExpired } = useAuth();

  const passedFirst = location.state?.first_name || "";
  const passedLast = location.state?.last_name || "";
  const initialName = user?.name || user?.full_name || "";
  const nameTokens = initialName.trim().split(/\s+/);
  const defaultFirst = passedFirst || user?.first_name || nameTokens[0] || "";
  const defaultLast = passedLast || user?.last_name || (nameTokens.length > 1 ? nameTokens.slice(1).join(" ") : "");
  const defaultPhone = user?.phone || user?.billing_phone || "";

  // Personal Information (Name is preserved in state from registration)
  const [form, setForm] = useState({
    first_name: defaultFirst,
    last_name: defaultLast,
    phone: defaultPhone,
  });
  const [confirmPhone, setConfirmPhone] = useState(defaultPhone);
  const [phoneChecking, setPhoneChecking] = useState(false);
  const [phoneAvailable, setPhoneAvailable] = useState(null);
  const phoneCheckTimeoutRef = useRef(null);

  const verifyPhoneAvailability = async (phoneToCheck) => {
    const raw = String(phoneToCheck || "").replace(/\D/g, "");
    if (raw.length !== 10) {
      setPhoneAvailable(null);
      return null;
    }
    if (!/^[6-9]\d{9}$/.test(raw)) {
      setErrors((prev) => ({
        ...prev,
        phone: "Mobile number must start with 6, 7, 8, or 9.",
      }));
      setPhoneAvailable(false);
      return false;
    }

    try {
      setPhoneChecking(true);
      const res = await axios.get(`${API_URL}/profile/check-phone`, {
        params: { phone: raw },
        withCredentials: true,
      });

      if (res.data?.exists) {
        setErrors((prev) => ({
          ...prev,
          phone: "This mobile number is already registered to another account. Please use a different number.",
        }));
        setPhoneAvailable(false);
        return false;
      } else if (res.data?.available) {
        setPhoneAvailable(true);
        setErrors((prev) => {
          if (!prev.phone) return prev;
          const copy = { ...prev };
          delete copy.phone;
          return copy;
        });
        return true;
      } else if (res.data?.message) {
        setErrors((prev) => ({
          ...prev,
          phone: res.data.message,
        }));
        setPhoneAvailable(false);
        return false;
      }
      return true;
    } catch (err) {
      if (err.response?.status === 409 || err.response?.data?.exists) {
        setErrors((prev) => ({
          ...prev,
          phone: "This mobile number is already registered to another account. Please use a different number.",
        }));
        setPhoneAvailable(false);
        return false;
      }
      return true;
    } finally {
      setPhoneChecking(false);
    }
  };

  // Mandatory Password
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordChecks = getPasswordRuleChecks(password);

  // Saved Addresses from server
  const [addresses, setAddresses] = useState([]);

  // Active address entry form
  const [addressForm, setAddressForm] = useState({
    type: "home",
    address_line1: "",
    address_line2: "",
    city: "Vasai West",
    state: "MH",
  });

  // Whether user is currently adding/editing an address
  const [isEditingAddress, setIsEditingAddress] = useState(true);
  const [editingAddressId, setEditingAddressId] = useState(null);

  // Initial loading state
  const [loading, setLoading] = useState(!Boolean(defaultFirst || user?.id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [errors, setErrors] = useState({});

  // Load existing profile & addresses on mount concurrently
  useEffect(() => {
    let isMounted = true;

    const loadProfile = async () => {
      try {
        setLoading(true);

        const [profileResult, addressResult] = await Promise.allSettled([
          axios.get(`${API_URL}/profile`, {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
            timeout: 8000,
          }),
          axios.get(`${API_URL}/addresses`, {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
            timeout: 8000,
          }),
        ]);

        if (profileResult.status === "fulfilled") {
          const profileData = profileResult.value.data?.profile || {};
          const loadedPhone =
            profileResult.value.data?.billing_phone ||
            profileData.phone ||
            user?.phone ||
            "";

          const rawFullName = profileData.full_name || user?.name || user?.full_name || "";
          const tokens = rawFullName.trim().split(/\s+/);
          const initialFirst = profileData.first_name || passedFirst || user?.first_name || tokens[0] || "";
          const initialLast = profileData.last_name || passedLast || user?.last_name || (tokens.length > 1 ? tokens.slice(1).join(" ") : "");

          if (isMounted) {
            setForm((prev) => ({
              first_name: prev.first_name || initialFirst,
              last_name: prev.last_name || initialLast,
              phone: loadedPhone || prev.phone || "",
            }));
            setConfirmPhone((prev) => prev || loadedPhone || "");
          }
        }

        if (addressResult.status === "fulfilled") {
          const loadedAddresses = addressResult.value.data?.addresses || [];
          if (isMounted) {
            setAddresses(loadedAddresses);
            if (loadedAddresses.length > 0) {
              setIsEditingAddress(false);
            } else {
              setIsEditingAddress(true);
            }
          }
        }

        // Only redirect to login if session was explicitly invalidated and user did not just register
        const isFromRegister = Boolean(location.state?.fromRegister || passedFirst);
        if (
          !isFromRegister &&
          profileResult.status === "rejected" &&
          profileResult.reason?.response?.status === 401 &&
          addressResult.status === "rejected" &&
          addressResult.reason?.response?.status === 401
        ) {
          if (handleSessionExpired) {
            handleSessionExpired();
          }
          navigate("/login", {
            replace: true,
            state: { from: location.pathname + location.search },
          });
          return;
        }
      } catch (error) {
        if (isMounted) {
          setMessage({
            type: "error",
            text: error.response?.data?.message || "Unable to load profile data.",
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
    if (name === "phone" || name === "confirm_phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }
    if (name === "confirm_phone") {
      setConfirmPhone(value);
      setErrors((prev) => {
        if (!prev.confirm_phone) return prev;
        const copy = { ...prev };
        delete copy.confirm_phone;
        return copy;
      });
      setMessage({ type: "", text: "" });
      return;
    }
    if (name === "phone") {
      setPhoneAvailable(null);
      if (phoneCheckTimeoutRef.current) {
        clearTimeout(phoneCheckTimeoutRef.current);
      }
      if (value.length === 10 && /^[6-9]\d{9}$/.test(value)) {
        phoneCheckTimeoutRef.current = setTimeout(() => {
          verifyPhoneAvailability(value);
        }, 350);
      }
    }
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
    setErrors((prev) => {
      if (!prev[name] && !(name === "phone" && prev.confirm_phone)) return prev;
      const copy = { ...prev };
      delete copy[name];
      if (name === "phone") delete copy.confirm_phone;
      return copy;
    });
    setMessage({ type: "", text: "" });
  };

  const handleAddressChange = (e) => {
    const { name, value } = e.target;
    setAddressForm((prev) => ({
      ...prev,
      [name]: value,
    }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
    setMessage({ type: "", text: "" });
  };

  const startEditAddress = (address) => {
    setEditingAddressId(address.id);
    setAddressForm({
      type: address.type || "home",
      address_line1: address.address_line1 || "",
      address_line2: address.address_line2 || "",
      city: address.city || "Vasai West",
      state: "MH",
    });
    setIsEditingAddress(true);
  };

  const startNewAddress = (type = "office") => {
    setEditingAddressId(null);
    setAddressForm({
      type,
      address_line1: "",
      address_line2: "",
      city: "Vasai West",
      state: "MH",
    });
    setIsEditingAddress(true);
  };

  const handleDeleteAddress = async (addressId) => {
    try {
      const response = await axios.delete(
        `${API_URL}/addresses/${addressId}`,
        {
          withCredentials: true,
          headers: { "X-Mumbai-Panel": "customer" },
        }
      );
      const remaining = response.data.addresses || [];
      setAddresses(remaining);
      if (remaining.length === 0) {
        setIsEditingAddress(true);
        setEditingAddressId(null);
      }
      setMessage({
        type: "success",
        text: "Address removed.",
      });
    } catch (error) {
      if (error.response?.status === 401) {
        if (handleSessionExpired) handleSessionExpired();
        navigate("/login", { replace: true, state: { from: location.pathname + location.search } });
        return;
      }
      setMessage({
        type: "error",
        text: error.response?.data?.message || "Unable to delete address.",
      });
    }
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    if (submittingRef.current || saving) return;
    setMessage({ type: "", text: "" });

    // Derive names collected during registration / authContext
    const cleanFirst = normalizePersonName(form.first_name || user?.first_name || (user?.name ? user.name.split(" ")[0] : "") || "Customer");
    const cleanLast = normalizePersonName(form.last_name || user?.last_name || (user?.name && user.name.split(" ").length > 1 ? user.name.split(" ").slice(1).join(" ") : "") || "User");
    const cleanFullName = `${cleanFirst} ${cleanLast}`;
    const cleanPhone = form.phone.trim();

    const newErrors = {};

    // 1. Mandatory Password Validation (Entering first as requested)
    if (!password) {
      newErrors.password = "Please create a password for your account.";
    } else {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.isValid) {
        newErrors.password = passwordValidation.message;
      }
    }

    if (!confirmPassword) {
      newErrors.confirm_password = "Please confirm your password.";
    } else if (password && password !== confirmPassword) {
      newErrors.confirm_password = "Passwords do not match.";
    }

    // 2. Mobile Number Validation
    if (!cleanPhone || !isValidIndianPhone(cleanPhone)) {
      newErrors.phone = "Please enter a valid 10-digit mobile number.";
    }

    if (!confirmPhone) {
      newErrors.confirm_phone = "Please re-enter your mobile number.";
    } else if (cleanPhone !== confirmPhone) {
      newErrors.confirm_phone = "Mobile numbers do not match.";
    }

    // 3. Validate Address Details
    const mustSaveAddress = addresses.length === 0 || isEditingAddress;

    if (mustSaveAddress) {
      if (!addressForm.address_line1.trim()) {
        newErrors.address_line1 = "Please enter your street address / flat number.";
      }

      if (!addressForm.city.trim() || !isValidDeliveryRegion(addressForm.city)) {
        newErrors.city =
          "Please select your delivery region (Vasai West, Vasai East, Nallasopara West, or Nallasopara East).";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setMessage({ type: "", text: "" });
      const errorKeys = ["password", "confirm_password", "phone", "confirm_phone", "address_line1", "city"];
      const firstKey = errorKeys.find((k) => newErrors[k]);
      if (firstKey) {
        const inputElem = document.querySelector(`[name="${firstKey}"]`);
        if (inputElem) {
          inputElem.focus();
          inputElem.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return;
    }

    if (phoneAvailable === false) {
      setErrors((prev) => ({
        ...prev,
        phone: "This mobile number is already registered to another account. Please use a different number.",
      }));
      const inputElem = document.querySelector('[name="phone"]');
      if (inputElem) {
        inputElem.focus();
        inputElem.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    if (phoneAvailable === null && cleanPhone.length === 10) {
      const isAvailable = await verifyPhoneAvailability(cleanPhone);
      if (!isAvailable) {
        const inputElem = document.querySelector('[name="phone"]');
        if (inputElem) {
          inputElem.focus();
          inputElem.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        return;
      }
    }

    setErrors({});

    try {
      submittingRef.current = true;
      setSaving(true);

      // Save the profile first so server-side phone uniqueness checks run before any address is stored.
      await axios.put(
        `${API_URL}/profile`,
        {
          first_name: cleanFirst,
          last_name: cleanLast,
          full_name: cleanFullName,
          phone: cleanPhone,
          password,
        },
        {
          withCredentials: true,
          headers: { "X-Mumbai-Panel": "customer" },
        }
      );

      // Save Address using personal name & phone automatically (no duplicate fields required)
      if (mustSaveAddress) {
        const addressPayload = {
          type: addressForm.type || "home",
          first_name: cleanFirst,
          last_name: cleanLast,
          full_name: cleanFullName,
          phone: cleanPhone,
          address_line1: addressForm.address_line1.trim(),
          address_line2: addressForm.address_line2.trim(),
          city: addressForm.city.trim(),
          state: "MH",
        };

        if (editingAddressId) {
          await axios.put(`${API_URL}/addresses/${editingAddressId}`, addressPayload, {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
          });
        } else {
          await axios.post(`${API_URL}/addresses`, addressPayload, {
            withCredentials: true,
            headers: { "X-Mumbai-Panel": "customer" },
          });
        }
      }

      if (refreshUser) {
        await refreshUser();
      }

      setMessage({
        type: "success",
        text: "Account setup completed successfully!",
      });

      setTimeout(() => {
        navigate("/", {
          replace: true,
          state: { message: "Account setup completed successfully" },
        });
      }, 300);
    } catch (error) {
      if (error.response?.status === 401) {
        if (handleSessionExpired) {
          handleSessionExpired();
        }
        navigate("/login", {
          replace: true,
          state: { from: location.pathname + location.search },
        });
        return;
      }

      const serverMsg = error.response?.data?.message || "Unable to save profile.";
      const status = error.response?.status;
      const lower = serverMsg.toLowerCase();

      let targetField = null;
      if (
        status === 409 ||
        lower.includes("phone") ||
        lower.includes("mobile") ||
        lower.includes("number") ||
        lower.includes("already registered") ||
        lower.includes("already exists")
      ) {
        targetField = "phone";
        if (status === 409 || lower.includes("already")) {
          setPhoneAvailable(false);
        }
      } else if (lower.includes("password")) {
        targetField = "password";
      } else if (
        lower.includes("street") ||
        lower.includes("flat") ||
        lower.includes("address")
      ) {
        targetField = "address_line1";
      } else if (lower.includes("city") || lower.includes("region")) {
        targetField = "city";
      }

      if (targetField) {
        setErrors((prev) => ({
          ...prev,
          [targetField]: serverMsg,
        }));
        setMessage({ type: "", text: "" });
        setTimeout(() => {
          const inputElem = document.querySelector(`[name="${targetField}"]`);
          if (inputElem) {
            inputElem.focus();
            inputElem.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, 50);
      } else {
        setMessage({
          type: "error",
          text: serverMsg,
        });
      }
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-[#0B1425]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#1E3252] border-t-[#42D6E8]" />
      </div>
    );
  }

  const hasHome = addresses.some((a) => a.type === "home");
  const hasOffice = addresses.some((a) => a.type === "office");

  return (
    <div className="min-h-screen bg-[#0B1425] text-[#F1F5F9] px-4 pt-3 pb-24 sm:px-6 sm:pt-6 md:pb-16 font-sans">
      <div className="mx-auto max-w-xl space-y-4 sm:space-y-5">
        {/* Top Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            aria-label="Back to Home"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#111F36] text-[#F1F5F9] border border-[#1E3252] transition-all hover:border-[#42D6E8]/60 hover:bg-[#162744] hover:text-[#42D6E8] active:scale-95 cursor-pointer shadow-sm"
          >
            <ArrowLeft size={18} strokeWidth={2.4} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-[#F1F5F9] sm:text-2xl truncate">
              Account Setup
            </h1>
            <p className="text-xs font-medium text-[#8FA4BE] truncate">
              Complete your security & delivery details
            </p>
          </div>
        </div>

        {/* Step Progress Pill */}
        <div className="flex items-center justify-between rounded-xl border border-[#1E3252]/70 bg-[#111F36]/60 px-3.5 py-2 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-[#42D6E8]">
            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#42D6E8] text-[10px] font-black text-[#061220]">
              ✓
            </span>
            Email Verified
          </span>
          <div className="h-0.5 flex-1 mx-3 bg-[#1E3252] rounded-full overflow-hidden">
            <div className="h-full w-full bg-[#42D6E8]" />
          </div>
          <span className="flex items-center gap-1.5 text-[#F1F5F9]">
            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#42D6E8] text-[10px] font-black text-[#061220]">
              2
            </span>
            Account & Delivery Setup
          </span>
        </div>

        {/* Status Toast */}
        {message.text && (
          <div
            className={`flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-xs font-bold shadow-xs border animate-in fade-in duration-200 ${
              message.type === "error"
                ? "bg-rose-950/40 text-rose-300 border-rose-900/60"
                : "bg-[#132B45] text-emerald-300 border-emerald-500"
            }`}
          >
            {message.type === "error" ? (
              <AlertCircle size={16} className="shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {/* ──────────────────────────────────────────────────────── */}
          {/* CARD 1: ACCOUNT SECURITY & CONTACT (PASSWORD FIRST)      */}
          {/* ──────────────────────────────────────────────────────── */}
          <div className="rounded-[20px] border border-[#1E3252]/80 bg-[#111F36] p-4.5 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#1E3252]/60 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#42D6E8]/10 text-[#42D6E8] border border-[#42D6E8]/20">
                  <Lock size={16} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-[#F1F5F9]">
                    Account Security & Contact
                  </h2>
                  <p className="text-[11px] font-medium text-[#8FA4BE]">
                    Set your account password and mobile number
                  </p>
                </div>
              </div>

              <span className="rounded-full bg-[#132B45] text-[#42D6E8] border border-[#1E3E63] px-2.5 py-0.5 text-[10px] font-bold">
                Step 1 of 2
              </span>
            </div>

            {/* A. Password Inputs (Entered first as requested) */}
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Password Field */}
                <div>
                  <label className={`mb-1 block text-xs font-bold ${errors.password ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    Password <span className="text-[#42D6E8]">*</span>
                  </label>
                  <div className="relative">
                    <Lock
                      size={15}
                      className={`absolute left-3 top-1/2 -translate-y-1/2 ${errors.password ? "text-rose-400" : "text-[#6E84A3]"}`}
                    />
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password"
                      autoComplete="new-password"
                      placeholder="Create a strong password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (errors.password) {
                          setErrors((prev) => {
                            const copy = { ...prev };
                            delete copy.password;
                            return copy;
                          });
                        }
                      }}
                      required
                      className={`h-11 w-full rounded-xl border pl-9 pr-10 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                        errors.password
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                          : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6E84A3] hover:text-[#42D6E8] cursor-pointer"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <span>{errors.password}</span>
                    </p>
                  )}
                </div>

                {/* Confirm Password Field */}
                <div>
                  <label className={`mb-1 block text-xs font-bold ${errors.confirm_password ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    Confirm Password <span className="text-[#42D6E8]">*</span>
                  </label>
                  <div className="relative">
                    <Lock
                      size={15}
                      className={`absolute left-3 top-1/2 -translate-y-1/2 ${errors.confirm_password ? "text-rose-400" : "text-[#6E84A3]"}`}
                    />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      name="confirm_password"
                      autoComplete="new-password"
                      placeholder="Re-enter your password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        if (errors.confirm_password) {
                          setErrors((prev) => {
                            const copy = { ...prev };
                            delete copy.confirm_password;
                            return copy;
                          });
                        }
                      }}
                      required
                      className={`h-11 w-full rounded-xl border pl-9 pr-10 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                        errors.confirm_password
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                          : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6E84A3] hover:text-[#42D6E8] cursor-pointer"
                      aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                    >
                      {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {errors.confirm_password && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <span>{errors.confirm_password}</span>
                    </p>
                  )}
                </div>
              </div>

              {/* Password Rules Checklist */}
              <div className="rounded-xl border border-[#1E3252]/60 bg-[#080F1C]/70 p-3 text-[11px] text-[#8FA4BE] space-y-1.5">
                <span className="block font-bold text-[#6E84A3] text-[10px] uppercase tracking-wider">
                  Password Requirements
                </span>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  <span className={`flex items-center gap-1 ${passwordChecks.length ? "text-emerald-400 font-bold" : "text-[#6E84A3]"}`}>
                    <Check size={12} className={passwordChecks.length ? "opacity-100" : "opacity-30"} /> 8+ characters
                  </span>
                  <span className={`flex items-center gap-1 ${passwordChecks.uppercase ? "text-emerald-400 font-bold" : "text-[#6E84A3]"}`}>
                    <Check size={12} className={passwordChecks.uppercase ? "opacity-100" : "opacity-30"} /> Uppercase (A-Z)
                  </span>
                  <span className={`flex items-center gap-1 ${passwordChecks.lowercase ? "text-emerald-400 font-bold" : "text-[#6E84A3]"}`}>
                    <Check size={12} className={passwordChecks.lowercase ? "opacity-100" : "opacity-30"} /> Lowercase (a-z)
                  </span>
                  <span className={`flex items-center gap-1 ${passwordChecks.number ? "text-emerald-400 font-bold" : "text-[#6E84A3]"}`}>
                    <Check size={12} className={passwordChecks.number ? "opacity-100" : "opacity-30"} /> Number (0-9)
                  </span>
                  <span className={`flex items-center gap-1 col-span-2 sm:col-span-2 ${passwordChecks.special ? "text-emerald-400 font-bold" : "text-[#6E84A3]"}`}>
                    <Check size={12} className={passwordChecks.special ? "opacity-100" : "opacity-30"} /> Special symbol (!@#$%^&*)
                  </span>
                </div>
              </div>
            </div>

            {/* B. Divider */}
            <div className="border-t border-[#1E3252]/60 pt-3" />

            {/* C. Mobile Number & Confirm Mobile Number */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#42D6E8]/10 text-[#42D6E8] border border-[#42D6E8]/20">
                  <User size={14} strokeWidth={2.2} />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-extrabold text-[#F1F5F9]">
                    Delivery Contact Mobile
                  </h3>
                  <p className="text-[10px] font-medium text-[#8FA4BE]">
                    Used for order delivery updates & driver contact
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={`mb-1 block text-xs font-bold ${errors.phone ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    Mobile Number <span className="text-[#42D6E8]">*</span>
                  </label>
                  <div className="relative flex items-center w-full">
                    <span
                      className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${
                        errors.phone ? "text-rose-400" : "text-[#6E84A3]"
                      }`}
                    >
                      +91
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      name="phone"
                      value={form.phone}
                      onChange={handleChange}
                      onBlur={() => {
                        if (form.phone.length === 10) {
                          verifyPhoneAvailability(form.phone);
                        }
                      }}
                      required
                      className={`h-11 w-full rounded-xl border pl-11 pr-9 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                        errors.phone
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                          : phoneAvailable === true
                            ? "border-emerald-500/70 bg-[#080F1C] ring-1 ring-emerald-500/30 focus:border-emerald-400"
                            : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                      }`}
                    />
                    {phoneChecking && (
                      <Loader2
                        size={15}
                        className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#42D6E8]"
                      />
                    )}
                    {!phoneChecking && phoneAvailable === true && !errors.phone && (
                      <CheckCircle2
                        size={15}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400"
                      />
                    )}
                  </div>
                  {phoneChecking && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-[#42D6E8]">
                      <Loader2 size={12} className="shrink-0 animate-spin text-[#42D6E8]" />
                      <span>Checking number availability...</span>
                    </p>
                  )}
                  {!phoneChecking && errors.phone && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <span>{errors.phone}</span>
                    </p>
                  )}
                  {!phoneChecking && phoneAvailable === true && !errors.phone && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                      <CheckCircle2 size={12} className="shrink-0 text-emerald-400" />
                      <span>Mobile number is available</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className={`mb-1 block text-xs font-bold ${errors.confirm_phone ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    Confirm Mobile Number <span className="text-[#42D6E8]">*</span>
                  </label>
                  <div className="relative flex items-center w-full">
                    <span
                      className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold transition-colors ${
                        errors.confirm_phone ? "text-rose-400" : "text-[#6E84A3]"
                      }`}
                    >
                      +91
                    </span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={10}
                      name="confirm_phone"
                      value={confirmPhone}
                      onChange={handleChange}
                      required
                      aria-invalid={Boolean(errors.confirm_phone)}
                      className={`h-11 w-full rounded-xl border pl-11 pr-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                        errors.confirm_phone
                          ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                          : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                      }`}
                    />
                  </div>
                  {errors.confirm_phone && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <span>{errors.confirm_phone}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ──────────────────────────────────────────────────────── */}
          {/* CARD 2: DELIVERY ADDRESS                                 */}
          {/* ──────────────────────────────────────────────────────── */}
          <div className="rounded-[20px] border border-[#1E3252]/80 bg-[#111F36] p-4.5 sm:p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#1E3252]/60 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#42D6E8]/10 text-[#42D6E8] border border-[#42D6E8]/20">
                  <MapPin size={16} strokeWidth={2.2} />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-[#F1F5F9]">
                    Delivery Address
                  </h2>
                  <p className="text-[11px] font-medium text-[#8FA4BE]">
                    Where your orders will be delivered
                  </p>
                </div>
              </div>

              <span className="rounded-full bg-[#132B45] text-[#42D6E8] border border-[#1E3E63] px-2.5 py-0.5 text-[10px] font-bold">
                Step 2 of 2
              </span>
            </div>

            {/* If existing addresses exist and user is not currently editing */}
            {addresses.length > 0 && !isEditingAddress ? (
              <div className="space-y-2.5">
                {addresses.map((address) => {
                  const isHome = address.type === "home";
                  return (
                    <div
                      key={address.id}
                      className="rounded-xl border border-[#1E3252] bg-[#080F1C] p-3.5 transition hover:border-[#42D6E8]/50"
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#132B45] text-[#42D6E8] shadow-xs border border-[#1E3252]">
                            {isHome ? <Home size={15} /> : <Building2 size={15} />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <h4 className="text-xs sm:text-sm font-extrabold text-[#F1F5F9] capitalize">
                                {address.type} Address
                              </h4>
                              <span className="rounded bg-[#132B45] border border-[#1E3252] px-1.5 py-0.2 text-[9px] font-bold uppercase text-[#67E8F9]">
                                Saved
                              </span>
                            </div>
                            <p className="text-xs font-medium text-[#8FA4BE] line-clamp-2 mt-0.5">
                              {address.address_line1}
                              {address.address_line2 ? `, ${address.address_line2}` : ""}
                              , {address.city}, Maharashtra
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEditAddress(address)}
                            className="flex h-7 px-2.5 items-center gap-1 rounded-lg bg-[#111F36] border border-[#1E3252] text-xs font-bold text-[#8FA4BE] hover:text-[#42D6E8] hover:border-[#42D6E8]/40 transition cursor-pointer"
                          >
                            <Pencil size={12} />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAddress(address.id)}
                            className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#111F36] border border-[#1E3252] text-rose-400 hover:text-white hover:bg-rose-600 hover:border-rose-600 transition cursor-pointer"
                            title="Delete address"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Add second address toggle if only 1 saved */}
                <div className="flex gap-2 pt-1">
                  {!hasHome && (
                    <button
                      type="button"
                      onClick={() => startNewAddress("home")}
                      className="flex items-center gap-1.5 text-xs font-bold text-[#42D6E8] hover:underline cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>Add Home Address</span>
                    </button>
                  )}
                  {!hasOffice && (
                    <button
                      type="button"
                      onClick={() => startNewAddress("office")}
                      className="flex items-center gap-1.5 text-xs font-bold text-[#42D6E8] hover:underline cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>Add Office Address</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* Inline Address Fields */
              <div className="space-y-3">
                {/* Address Type Toggle (Home / Office) */}
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-[#8FA4BE]">
                    Address Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAddressForm((prev) => ({ ...prev, type: "home" }))}
                      className={`flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        addressForm.type === "home"
                          ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9] ring-2 ring-[#42D6E8]/20 font-extrabold"
                          : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:bg-[#162744]"
                      }`}
                    >
                      <Home size={15} />
                      <span>Home</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAddressForm((prev) => ({ ...prev, type: "office" }))}
                      className={`flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        addressForm.type === "office"
                          ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9] ring-2 ring-[#42D6E8]/20 font-extrabold"
                          : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:bg-[#162744]"
                      }`}
                    >
                      <Building2 size={15} />
                      <span>Office</span>
                    </button>
                  </div>
                </div>

                {/* Street Address */}
                <div>
                  <label className={`mb-1 block text-xs font-bold ${errors.address_line1 ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                    Flat, Building, Street Address <span className="text-[#42D6E8]">*</span>
                  </label>
                  <input
                    type="text"
                    name="address_line1"
                    placeholder="e.g. Flat 302, Building 4, Station Road"
                    value={addressForm.address_line1}
                    onChange={handleAddressChange}
                    required
                    className={`h-11 w-full rounded-xl border px-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition ${
                      errors.address_line1
                        ? "border-rose-500 bg-rose-950/20 ring-1 ring-rose-500 focus:border-rose-400"
                        : "border-[#1E3252] bg-[#080F1C] focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                    }`}
                  />
                  {errors.address_line1 && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <span>{errors.address_line1}</span>
                    </p>
                  )}
                </div>

                {/* Landmark / Area */}
                <div>
                  <label className="mb-1 block text-xs font-bold text-[#8FA4BE]">
                    Landmark / Area <span className="text-[#6E84A3] font-medium">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    name="address_line2"
                    placeholder="e.g. Near Ganpati Mandir, Opposite Bank"
                    value={addressForm.address_line2}
                    onChange={handleAddressChange}
                    className="h-11 w-full rounded-xl border border-[#1E3252] bg-[#080F1C] px-3 text-xs sm:text-sm font-semibold text-[#F1F5F9] outline-none transition focus:border-[#42D6E8] focus:ring-2 focus:ring-[#42D6E8]/20"
                  />
                </div>

                {/* Delivery Region Selection (4 Zones) */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label className={`block text-xs font-bold ${errors.city ? "text-rose-400" : "text-[#8FA4BE]"}`}>
                      Delivery Region <span className="text-[#42D6E8]">*</span>
                    </label>
                    <span className="text-[10px] font-semibold text-[#6E84A3]">
                      Local delivery zones
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {DELIVERY_REGIONS.map((region) => {
                      const isSelected = addressForm.city?.toLowerCase() === region.toLowerCase();

                      return (
                        <button
                          key={region}
                          type="button"
                          onClick={() => {
                            setAddressForm((prev) => ({ ...prev, city: region }));
                            if (errors.city) {
                              setErrors((prev) => {
                                const updated = { ...prev };
                                delete updated.city;
                                return updated;
                              });
                            }
                            setMessage({ type: "", text: "" });
                          }}
                          className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-bold transition-all cursor-pointer active:scale-98 ${
                            isSelected
                              ? "border-[#42D6E8] bg-[#132B45] text-[#67E8F9] shadow-xs ring-2 ring-[#42D6E8]/20 font-extrabold"
                              : errors.city
                              ? "border-rose-400 bg-rose-950/20 text-[#8FA4BE]"
                              : "border-[#1E3252] bg-[#080F1C] text-[#8FA4BE] hover:border-[#42D6E8]/40 hover:bg-[#162744]"
                          }`}
                        >
                          <MapPin size={14} className={isSelected ? "text-[#67E8F9]" : errors.city ? "text-rose-400" : "text-[#6E84A3]"} />
                          <span className="truncate">{region}</span>
                        </button>
                      );
                    })}
                  </div>
                  {errors.city && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-rose-400">
                      <AlertCircle size={12} className="shrink-0 text-rose-400" />
                      <span>{errors.city}</span>
                    </p>
                  )}
                </div>

                {/* State / Store Zone Badge */}
                <div className="flex items-center justify-between rounded-xl border border-[#1E3252] bg-[#080F1C] px-3.5 py-2.5 text-xs font-bold text-[#8FA4BE]">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[#F1F5F9]">Maharashtra</span>
                    <span className="text-[11px] font-semibold text-[#6E84A3]">(MH)</span>
                  </div>
                  <span className="rounded bg-[#132B45] border border-[#1E3252] px-2 py-0.5 text-[9px] font-extrabold text-[#67E8F9]">
                    Store Delivery Zone
                  </span>
                </div>

                {/* Cancel editing button if editing an existing address */}
                {addresses.length > 0 && editingAddressId && (
                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingAddress(false);
                        setEditingAddressId(null);
                      }}
                      className="text-xs font-bold text-[#8FA4BE] hover:text-[#42D6E8] cursor-pointer"
                    >
                      Cancel Editing
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ──────────────────────────────────────────────────────── */}
          {/* PRIMARY SUBMIT CTA                                       */}
          {/* ──────────────────────────────────────────────────────── */}
          <div className="space-y-2.5 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#42D6E8] px-6 text-sm font-black text-[#061220] shadow-lg transition-all hover:bg-[#2CC4D8] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#061220]/30 border-t-[#061220]" />
                  <span>Saving Information...</span>
                </>
              ) : (
                <>
                  <span>Save Information & Continue</span>
                  <ArrowRight size={17} strokeWidth={2.4} />
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-1.5 text-center text-[11px] font-semibold text-[#6E84A3]">
              <ShieldCheck size={14} className="text-[#42D6E8] shrink-0" />
              <span>Your profile details are private & securely encrypted.</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProfileSetup;
