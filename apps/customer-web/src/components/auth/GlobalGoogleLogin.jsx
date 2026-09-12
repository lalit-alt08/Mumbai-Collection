import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "../../context/AuthContext";
import { googleLogin as googleLoginService } from "../../services/authService";

export default function GlobalGoogleLogin() {
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { login: loginUser } = useAuth();
  const submittingRef = useRef(false);

  useEffect(() => {
    const moveButton = () => {
      const target = document.getElementById("google-login-portal-target");
      const container = containerRef.current;
      
      if (target && container) {
        container.style.display = "flex";
        container.style.justifyContent = "center";
        container.style.width = "100%";
        target.appendChild(container);
      } else if (container) {
        container.style.display = "none";
        if (document.body) {
          document.body.appendChild(container);
        }
      }
    };

    moveButton();
    window.addEventListener("google-login-ready", moveButton);
    return () => window.removeEventListener("google-login-ready", moveButton);
  }, [location.pathname]);

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


  return (
    <div ref={containerRef} style={{ display: "none" }}>
      <GoogleLogin
        onSuccess={handleGoogleLogin}
        onError={() => {
          window.dispatchEvent(
            new CustomEvent("google-auth-error", { detail: "Google login failed. Please try again." })
          );
        }}
        useOneTap
        shape="pill"
        theme="outline"
        size="large"
        text="continue_with"
      />
    </div>
  );
}
