import { useState } from "react";
import { useGoogleLogin } from "@react-oauth/google";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import { googleLogin } from "../../services/authService";
import { useAuth } from "../../context/AuthContext";
import { getSafeInternalPath } from "../../utils/navigation.js";

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
  const [linked, setLinked] = useState(false);

  const handleLoginSuccess = async (codeResponse) => {
    try {
      setLoading(true);
      setInternalError("");

      const payload = { code: codeResponse.code };
      if (mode === "link") {
        payload.intent = "link";
      }

      const res = await googleLogin(payload);

      if (mode === "link") {
        if (!res?.success || !res?.user) throw new Error("Google linking was not confirmed.");
        loginUser(res.user);
        setLinked(true);
        return;
      }

      if (res?.user) {
        loginUser(res.user);
      }

      const safeReturn = getSafeInternalPath(location.state?.from, "/");
      navigate(safeReturn, { replace: true });
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
      {linked && <p role="status" className="text-sm text-emerald-400">Google account linked successfully.</p>}
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
        className="flex h-[46px] sm:h-[50px] md:h-[52px] w-full items-center justify-center gap-2.5 rounded-xl sm:rounded-2xl border border-[#E2E8F0] bg-[#F0F8E8] px-4 text-[14px] sm:text-[15px] font-bold text-[#1E293B] shadow-sm transition-all hover:border-[#22499F]/60 hover:bg-[#FFFFFF] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin text-[#22499F]" />
            <span className="text-[#64748B] text-xs sm:text-sm">Connecting to Google...</span>
          </>
        ) : (
          <>
            <GoogleIcon className="h-4.5 w-4.5 sm:h-5 sm:w-5 shrink-0" />
            <span>
              {mode === "link" ? "Link Google account" : mode === "signup" ? "Sign up with Google" : "Sign in with Google"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
