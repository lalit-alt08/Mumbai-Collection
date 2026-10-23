import { useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { Loader2, AlertCircle } from "lucide-react";
import { googleLogin } from "../../services/authService";
import { useAuth } from "../../context/AuthContext";
import API_URL from "../../config/api.js";

function GoogleIcon({ className = "h-5 w-5 shrink-0" }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

export default function GoogleAuthButton({ mode = "signup", onError }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { login: loginUser } = useAuth();

  const [loading, setLoading] = useState(false);
  const [internalError, setInternalError] = useState("");

  const handleLoginSuccess = async (codeResponse) => {
    try {
      setLoading(true);
      setInternalError("");

      const res = await googleLogin({ code: codeResponse.code });

      if (res?.user) {
        loginUser(res.user);
      }

      // If user was newly registered via Google SSO
      if (res?.is_new_user) {
        const rawName = res.user?.name || "";
        const parts = rawName.trim().split(/\s+/);
        const firstName = res.user?.first_name || parts[0] || "";
        const lastName =
          res.user?.last_name ||
          (parts.length > 1 ? parts.slice(1).join(" ") : "");

        navigate("/profile-setup", {
          replace: true,
          state: {
            first_name: firstName,
            last_name: lastName,
            fromRegister: true,
          },
        });
        return;
      }

      // For existing customers, check if profile & delivery address are complete
      try {
        const checkRes = await axios.get(`${API_URL}/profile/complete`, {
          withCredentials: true,
          headers: { "X-Mumbai-Panel": "customer" },
          timeout: 6000,
        });

        if (checkRes.data?.complete === true) {
          const from = location.state?.from;
          navigate(from || "/", { replace: true });
        } else {
          navigate("/profile-setup", {
            replace: true,
            state: {
              first_name: res.user?.first_name || "",
              last_name: res.user?.last_name || "",
              fromRegister: false,
            },
          });
        }
      } catch {
        navigate("/profile-setup", { replace: true });
      }
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        "Unable to authenticate with Google. Please try again.";
      setInternalError(msg);
      if (onError) onError(msg);
    } finally {
      setLoading(false);
    }
  };

  const login = useGoogleLogin({
    flow: "auth-code",
    scope: "openid email profile",
    onSuccess: handleLoginSuccess,
    onError: (err) => {
      const msg =
        err?.error_description ||
        "Google authentication was cancelled or failed.";
      setInternalError(msg);
      if (onError) onError(msg);
      setLoading(false);
    },
  });

  return (
    <div className="w-full space-y-3">
      {internalError && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-950/20 px-3.5 py-2.5 text-xs font-semibold text-rose-400">
          <AlertCircle size={15} className="shrink-0" />
          <span>{internalError}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setInternalError("");
          login();
        }}
        disabled={loading}
        className="flex h-[46px] sm:h-[50px] md:h-[52px] w-full items-center justify-center gap-2.5 rounded-xl sm:rounded-2xl border border-[#1E3252] bg-[#080F1C] px-4 text-[14px] sm:text-[15px] font-bold text-[#F1F5F9] shadow-sm transition-all hover:border-[#42D6E8]/60 hover:bg-[#0D1C33] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin text-[#42D6E8]" />
            <span className="text-[#8FA4BE] text-xs sm:text-sm">Connecting to Google...</span>
          </>
        ) : (
          <>
            <GoogleIcon className="h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0" />
            <span>
              {mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
