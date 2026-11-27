import { useState, useRef, useEffect } from "react";
import { GoogleOAuthProvider, useGoogleLogin, useGoogleOAuth } from "@react-oauth/google";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2, AlertCircle } from "lucide-react";
import { googleLogin, confirmAuthenticatedUser } from "../../services/authService";
import { useAuth } from "../../context/AuthContext";
import { useCart } from "../../context/CartContext";
import { executePostAuthNavigation } from "../../utils/postAuthRedirect.js";

const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "477688999568-t4mnenlkrvhs6qd90sffptr6ht00v2u8.apps.googleusercontent.com";

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

function GoogleAuthButtonInner({
  mode = "signup",
  onError,
  disabled = false,
  onBusyChange,
  scriptError = false,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { scriptLoadedSuccessfully } = useGoogleOAuth();
  const { login: loginUser, reconcileSupersededAuth, handleSessionExpired, getAuthEpoch } = useAuth();
  const { cart, waitForAuthenticatedCart } = useCart();

  const isMountedRef = useRef(true);
  const authAttemptRef = useRef(0);
  const pendingPopupAttemptRef = useRef(null);
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      authAttemptRef.current += 1;
      pendingPopupAttemptRef.current = null;
      onBusyChangeRef.current?.(false);
    };
  }, []);

  const [loading, setLoading] = useState(false);
  const [internalError, setInternalError] = useState("");
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    if (scriptLoadedSuccessfully && internalError.startsWith("Google Sign-In is still initializing")) {
      setInternalError("");
    }
  }, [scriptLoadedSuccessfully, internalError]);

  const handleLoginSuccess = async (codeResponse) => {
    const pendingAttempt = pendingPopupAttemptRef.current;
    pendingPopupAttemptRef.current = null;
    const attemptId = pendingAttempt?.attemptId ?? ++authAttemptRef.current;
    const preAuthEpoch =
      pendingAttempt && "preAuthEpoch" in pendingAttempt
        ? pendingAttempt.preAuthEpoch
        : (typeof getAuthEpoch === "function" ? getAuthEpoch() : null);
    const isPreAuthActive = () =>
      isMountedRef.current &&
      authAttemptRef.current === attemptId &&
      (preAuthEpoch === null || getAuthEpoch() === preAuthEpoch);

    // Reject callbacks from popups opened before unmount, logout, or account switch
    if (!isPreAuthActive()) {
      onBusyChangeRef.current?.(false);
      if (isMountedRef.current) setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setInternalError("");

      const payload = { code: codeResponse.code };
      if (mode === "link") {
        payload.intent = "link";
      }

      const res = await googleLogin(payload);
      if (!isPreAuthActive()) {
        // The server may have updated the browser session cookie; re-sync or revoke if logged out.
        void reconcileSupersededAuth();
        return;
      }

      const confirmedUser = await confirmAuthenticatedUser(res?.user);
      if (!isPreAuthActive()) {
        void reconcileSupersededAuth();
        return;
      }

      if (mode === "link") {
        if (!res?.success || !res?.user) throw new Error("Google linking was not confirmed.");
        loginUser(confirmedUser);
        setLinked(true);
        return;
      }

      const hasCartItems = Boolean(cart?.items?.length > 0);
      loginUser(confirmedUser);
      const expectedEpoch = typeof getAuthEpoch === "function" ? getAuthEpoch() : null;

      await executePostAuthNavigation({
        from: location.state?.from,
        hasCartItems,
        user: confirmedUser,
        isNewUser: Boolean(res?.is_new_user),
        waitForAuthenticatedCart: res?.is_new_user ? null : waitForAuthenticatedCart,
        isAttemptActive: () =>
          isMountedRef.current &&
          authAttemptRef.current === attemptId &&
          (expectedEpoch === null || getAuthEpoch() === expectedEpoch),
        handleSessionExpired,
        navigate,
        onUnauthorized: (msg) => {
          setInternalError(msg);
          if (onError) onError(msg);
        },
      });
    } catch (err) {
      if (!isPreAuthActive()) return;
      const msg =
        err.response?.data?.message ||
        "Unable to authenticate with Google. Please try again.";
      setInternalError(msg);
      if (onError) onError(msg);
    } finally {
      onBusyChange?.(false);
      if (isMountedRef.current && authAttemptRef.current === attemptId) {
        setLoading(false);
      }
    }
  };

  const login = useGoogleLogin({
    flow: "auth-code",
    scope: "openid email profile",
    onSuccess: handleLoginSuccess,
    onError: (err) => {
      pendingPopupAttemptRef.current = null;
      const msg =
        err?.error_description ||
        "Google authentication was cancelled or failed.";
      if (isMountedRef.current) {
        setInternalError(msg);
        setLoading(false);
      }
      if (onError) onError(msg);
      onBusyChangeRef.current?.(false);
    },
    onNonOAuthError: () => {
      pendingPopupAttemptRef.current = null;
      if (isMountedRef.current) setLoading(false);
      onBusyChangeRef.current?.(false);
    },
  });

  return (
    <div className="w-full space-y-3">
      {linked && <p role="status" className="text-sm text-emerald-400">Google account linked successfully.</p>}
      {internalError && (
        <div className="auth-error-banner flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold">
          <AlertCircle size={15} className="shrink-0" aria-hidden="true" />
          <span>{internalError}</span>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          if (disabled || loading) return;
          if (!scriptLoadedSuccessfully) {
            if (scriptError) {
              const msg = "Unable to load Google Sign-In. Please check your connection and try again.";
              setInternalError(msg);
              if (onError) onError(msg);
            } else {
              setInternalError("Google Sign-In is still initializing. Please tap again in a second.");
            }
            return;
          }
          const attemptId = ++authAttemptRef.current;
          const preAuthEpoch = typeof getAuthEpoch === "function" ? getAuthEpoch() : null;
          pendingPopupAttemptRef.current = { attemptId, preAuthEpoch };
          setInternalError("");
          setLoading(true);
          onBusyChange?.(true);
          login();
        }}
        disabled={loading || disabled}
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

export default function GoogleAuthButton(props) {
  const [scriptError, setScriptError] = useState(false);

  return (
    <GoogleOAuthProvider
      clientId={GOOGLE_CLIENT_ID}
      onScriptLoadSuccess={() => setScriptError(false)}
      onScriptLoadError={() => setScriptError(true)}
    >
      <GoogleAuthButtonInner {...props} scriptError={scriptError} />
    </GoogleOAuthProvider>
  );
}
