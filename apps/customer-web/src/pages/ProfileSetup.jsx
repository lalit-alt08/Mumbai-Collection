import { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import API_URL from "../config/api.js";
import {
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { ProfileSecurityCard } from "../components/profile/ProfileSecurityCard.jsx";
import { ProfileAddressCard } from "../components/profile/ProfileAddressCard.jsx";
import {
  DELIVERY_REGIONS,
  isValidDeliveryRegion,
  isValidIndianPhone,
} from "../data/indianStates.js";
import { normalizePersonName, isValidPersonName } from "../utils/nameValidator.js";
import { validatePassword, getPasswordRuleChecks } from "../utils/passwordValidator.js";
import { useAuth } from "../context/AuthContext";
import { getSafeInternalPath } from "../utils/navigation.js";

function ProfileSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const submittingRef = useRef(false);
  const { user, refreshUser, handleSessionExpired } = useAuth();
  const needsPassword = user?.is_google_user !== true && user?.has_usable_password === false;

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

  const requiresAddress = addresses.length === 0 || isEditingAddress;

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

        // Only redirect to login if session was explicitly invalidated (both initial requests return 401)
        const bothUnauthorized =
          profileResult.status === "rejected" &&
          profileResult.reason?.response?.status === 401 &&
          addressResult.status === "rejected" &&
          addressResult.reason?.response?.status === 401;

        if (bothUnauthorized) {
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
    if (needsPassword && !password) {
      newErrors.password = "Please create a password for your account.";
    } else if (needsPassword) {
      const passwordValidation = validatePassword(password);
      if (!passwordValidation.isValid) {
        newErrors.password = passwordValidation.message;
      }
    }

    if (needsPassword && !confirmPassword) {
      newErrors.confirm_password = "Please confirm your password.";
    } else if (needsPassword && password && password !== confirmPassword) {
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
    let hasAddressError = false;
    if (requiresAddress) {
      if (!addressForm.address_line1.trim() || addressForm.address_line1.trim().length < 3) {
        newErrors.address_line1 = "Please enter your street address / flat number (minimum 3 characters).";
        hasAddressError = true;
      }

      if (!addressForm.city.trim() || !isValidDeliveryRegion(addressForm.city)) {
        newErrors.city =
          "Please select your delivery region (Vasai West, Vasai East, Nallasopara West, or Nallasopara East).";
        hasAddressError = true;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      if (hasAddressError) {
        setMessage({
          type: "error",
          text: "Add your delivery address to finish account setup.",
        });
      } else {
        setMessage({ type: "", text: "" });
      }
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
          ...(needsPassword ? { password } : {}),
        },
        {
          withCredentials: true,
          headers: { "X-Mumbai-Panel": "customer" },
        }
      );

      // Save Address using personal name & phone automatically (no duplicate fields required)
      if (requiresAddress) {
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
          try {
            await axios.post(`${API_URL}/addresses`, addressPayload, {
              withCredentials: true,
              headers: { "X-Mumbai-Panel": "customer" },
            });
          } catch (addrErr) {
            const isDuplicateType =
              addrErr.response?.status === 400 &&
              (addrErr.response?.data?.code === "ADDRESS_TYPE_EXISTS" ||
                String(addrErr.response?.data?.message || "").toLowerCase().includes("already have a saved"));
            if (isDuplicateType) {
              const fetchRes = await axios.get(`${API_URL}/addresses`, {
                withCredentials: true,
                headers: { "X-Mumbai-Panel": "customer" },
              });
              const currentAddrs = fetchRes.data?.addresses || [];
              const match = currentAddrs.find(
                (a) => (a.type || "").toLowerCase() === (addressPayload.type || "").toLowerCase()
              );
              if (!match?.id) {
                throw addrErr;
              }
              await axios.put(`${API_URL}/addresses/${match.id}`, addressPayload, {
                withCredentials: true,
                headers: { "X-Mumbai-Panel": "customer" },
              });
            } else {
              throw addrErr;
            }
          }
        }
      }

      // 3. Authoritative Completion Check Before Success
      let completeRes;
      try {
        completeRes = await axios.get(`${API_URL}/profile/complete`, {
          withCredentials: true,
          headers: { "X-Mumbai-Panel": "customer" },
          timeout: 8000,
        });
      } catch (checkErr) {
        if (checkErr.response?.status === 401) {
          if (handleSessionExpired) {
            handleSessionExpired();
          }
          navigate("/login", {
            replace: true,
            state: { from: location.pathname + location.search },
          });
          return;
        }

        // Timeout, network error, 502, 503
        setMessage({
          type: "error",
          text: "Your details were saved, but we could not confirm completion. Please retry.",
        });
        return;
      }

      if (!completeRes?.data || completeRes.data.complete !== true) {
        const missing = [];
        if (completeRes?.data?.profile_complete === false) {
          missing.push("profile details");
        }
        if (completeRes?.data?.address_complete === false) {
          missing.push("delivery address");
        }
        const missingText = missing.length > 0 ? ` (${missing.join(" and ")})` : "";
        setMessage({
          type: "error",
          text: `Account setup is not complete yet${missingText}. Please review your details and retry.`,
        });
        return;
      }

      // 4. Session refresh
      if (refreshUser) {
        const refreshResult = await refreshUser();
        if (refreshResult && refreshResult.ok === false && refreshResult.reason === "unauthorized") {
          navigate("/login", {
            replace: true,
            state: { from: location.pathname + location.search },
          });
          return;
        }
      }

      // 5. Navigate immediately to safe destination or home
      const safeReturn = getSafeInternalPath(location.state?.from, "/");
      navigate(safeReturn, {
        replace: true,
        state: { message: "Account setup completed successfully" },
      });
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
      <div className="flex min-h-[50vh] items-center justify-center bg-[#F0F8E8]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-[#22499F]" />
      </div>
    );
  }

  const hasHome = addresses.some((a) => a.type === "home");
  const hasOffice = addresses.some((a) => a.type === "office");

  return (
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] px-4 pt-3 pb-24 sm:px-6 sm:pt-6 md:pb-16 font-sans">
      <div className="mx-auto max-w-xl space-y-4 sm:space-y-5">
        {/* Top Header */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(getSafeInternalPath(location.state?.from, "/"))}
            aria-label="Back to Home"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF] text-[#1E293B] border border-[#E2E8F0] transition-all hover:border-[#22499F]/60 hover:bg-[#FFFFFF] hover:text-[#22499F] active:scale-95 cursor-pointer shadow-sm"
          >
            <ArrowLeft size={18} strokeWidth={2.4} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-extrabold tracking-tight text-[#1E293B] sm:text-2xl truncate">
              Account Setup
            </h1>
            <p className="text-xs font-medium text-[#64748B] truncate">
              Complete your security & delivery details
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate(getSafeInternalPath(location.state?.from, "/"))}
            className="shrink-0 text-xs font-semibold text-[#64748B] hover:text-[#22499F] px-2.5 py-1.5 rounded-lg border border-[#E2E8F0]/60 hover:border-[#22499F]/40 bg-[#FFFFFF]/50 transition cursor-pointer"
          >
            Skip for now
          </button>
        </div>

        {/* Step Progress Pill */}
        <div className="flex items-center justify-between rounded-xl border border-[#E2E8F0]/70 bg-[#FFFFFF]/60 px-3.5 py-2 text-xs font-semibold">
          <span className="flex items-center gap-1.5 text-[#22499F]">
            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#22499F] text-[10px] font-black text-[#FFFFFF]">
              ✓
            </span>
            Email Verified
          </span>
          <div className="h-0.5 flex-1 mx-3 bg-[#E2E8F0] rounded-full overflow-hidden">
            <div className="h-full w-full bg-[#22499F]" />
          </div>
          <span className="flex items-center gap-1.5 text-[#1E293B]">
            <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-[#22499F] text-[10px] font-black text-[#FFFFFF]">
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
                : "bg-[#FFFFFF] text-emerald-300 border-emerald-500"
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
          <ProfileSecurityCard
            needsPassword={needsPassword}
            password={password}
            setPassword={setPassword}
            confirmPassword={confirmPassword}
            setConfirmPassword={setConfirmPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            showConfirmPassword={showConfirmPassword}
            setShowConfirmPassword={setShowConfirmPassword}
            passwordChecks={passwordChecks}
            errors={errors}
            setErrors={setErrors}
            form={form}
            confirmPhone={confirmPhone}
            handleChange={handleChange}
            phoneChecking={phoneChecking}
            phoneAvailable={phoneAvailable}
            verifyPhoneAvailability={verifyPhoneAvailability}
          />

          <ProfileAddressCard
            requiresAddress={requiresAddress}
            addresses={addresses}
            isEditingAddress={isEditingAddress}
            hasHome={hasHome}
            hasOffice={hasOffice}
            startEditAddress={startEditAddress}
            handleDeleteAddress={handleDeleteAddress}
            startNewAddress={startNewAddress}
            addressForm={addressForm}
            setAddressForm={setAddressForm}
            errors={errors}
            setErrors={setErrors}
            handleAddressChange={handleAddressChange}
            DELIVERY_REGIONS={DELIVERY_REGIONS}
            setMessage={setMessage}
            editingAddressId={editingAddressId}
            setIsEditingAddress={setIsEditingAddress}
            setEditingAddressId={setEditingAddressId}
          />

          {/* ──────────────────────────────────────────────────────── */}
          {/* PRIMARY SUBMIT CTA                                       */}
          {/* ──────────────────────────────────────────────────────── */}
          <div className="space-y-2.5 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#22499F] px-6 text-sm font-black text-[#FFFFFF] shadow-lg transition-all hover:bg-[#1B3B82] active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#FFFFFF]/30 border-t-[#FFFFFF]" />
                  <span>Saving Information...</span>
                </>
              ) : (
                <>
                  <span>Save Information & Continue</span>
                  <ArrowRight size={17} strokeWidth={2.4} />
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-1.5 text-center text-[11px] font-semibold text-[#64748B]">
              <ShieldCheck size={14} className="text-[#22499F] shrink-0" />
              <span>Your profile details are private & securely encrypted.</span>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ProfileSetup;
