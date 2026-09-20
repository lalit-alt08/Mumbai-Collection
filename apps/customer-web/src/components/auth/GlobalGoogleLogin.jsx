import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { AlertCircle } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { googleLogin as googleLoginService } from "../../services/authService";

/**
 * Detect embedded / in-app browsers (Instagram, Facebook, WhatsApp, TikTok, etc.)
 * where Google OAuth / Google Identity Services (GIS) blocks authentication with disallowed_useragent.
 */
function isEmbeddedWebView() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || navigator.vendor || window.opera || "";
  const isSpecificInApp =
    /Instagram|FBAN|FBAV|FB_IAB|Messenger|WhatsApp|TikTok|musical_ly|Snapchat|Line\/|Twitter|MicroMessenger|Pinterest/i.test(
      ua
    );
  const isAndroidWebView =
    /Android/i.test(ua) && (/\bwv\b/i.test(ua) || /Version\/[0-9.]+/i.test(ua));
  return Boolean(isSpecificInApp || isAndroidWebView);
}

export default function GlobalGoogleLogin() {
  const [portalTarget, setPortalTarget] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, login: loginUser } = useAuth();
  const submittingRef = useRef(false);
  const isWebView = isEmbeddedWebView();

  useEffect(() => {
    let active = true;

    const updateTarget = () => {
      if (!active) return;
      const target = document.getElementById("google-login-portal-target");
      setPortalTarget(target);
    };

    updateTarget();
    window.addEventListener("google-login-ready", updateTarget);

    return () => {
      active = false;
      window.removeEventListener("google-login-ready", updateTarget);
      setPortalTarget(null);
    };
  }, [location.pathname]);

  // If user is already authenticated, suppress Google One Tap overlay and don't render widget
  if (isAuthenticated || user) {
    return null;
  }

  // Only render if portal target exists and is currently attached to the DOM
  if (!portalTarget || !document.body.contains(portalTarget)) {
    return null;
  }

  const handleGoogleLogin = async (credentialResponse) => {
    if (submittingRef.current) return;
    try {
      submittingRef.current = true;
      window.dispatchEvent(new CustomEvent("google-auth-start"));

      const response = await googleLoginService(credentialResponse.credential);
      loginUser(response.user);

      const from = location.state?.from;
      if (from && from !== "/login" && from !== "/register") {
        navigate(from, { replace: true });
      } else if (!response.user?.is_phone_verified) {
        navigate("/profile-setup", { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("google-auth-error", {
          detail: err.response?.data?.message || "Google authentication failed. Please try again.",
        })
      );
    } finally {
      submittingRef.current = false;
      window.dispatchEvent(new CustomEvent("google-auth-end"));
    }
  };

  const portalContent = isWebView ? (
    <div className="w-full max-w-sm rounded-xl border border-amber-200 bg-amber-50/90 p-3.5 text-center text-xs text-amber-900 shadow-sm">
      <div className="flex items-center justify-center gap-1.5 font-semibold text-amber-800 mb-1">
        <AlertCircle size={15} className="text-amber-600 flex-shrink-0" />
        <span>In-App Browser Detected</span>
      </div>
      <p className="leading-relaxed text-amber-700">
        Google sign-in is not supported inside in-app browsers. To sign in with Google, tap <span className="font-semibold">⋮</span> or <span className="font-semibold">⋯</span> and select <span className="font-semibold">Open in Chrome/Safari</span>, or sign in using phone OTP / password.
      </p>
    </div>
  ) : (
    <div className="flex w-full justify-center">
      <GoogleLogin
        onSuccess={handleGoogleLogin}
        onError={() => {
          window.dispatchEvent(
            new CustomEvent("google-auth-error", { detail: "Google login failed. Please try again." })
          );
        }}
        shape="pill"
        theme="outline"
        size="large"
        text="continue_with"
      />
    </div>
  );

  return createPortal(portalContent, portalTarget);
}
