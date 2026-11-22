import { Outlet, useLocation } from "react-router-dom";

import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import FloatingCartBar from "../components/layout/FloatingCartBar";
import BottomNav from "../components/layout/BottomNav";
import NetworkBanner from "../components/common/NetworkBanner";
import InstallPrompt from "../components/common/InstallPrompt";

function MainLayout() {
  const location = useLocation();
  const path = location.pathname;

  const hideHeaderPages = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/cart",
    "/checkout",
    "/order-success",
    "/order-failed",
    "/track-order",
    "/product",
    "/account",
    "/orders",
    "/categories",
    "/category",
    "/profile-setup",
    "/favorites",
    "/recently-viewed",
    "/contact",
    "/support",
    "/return-policy",
    "/shipping-policy",
    "/terms",
    "/privacy-policy",
  ];

  const isHeaderHidden = hideHeaderPages.some((p) =>
    path.startsWith(p)
  );

  const isFooterVisible = path === "/";

  const fullWidthPages = [
    "/order-success",
    "/track-order",
    "/account",
    "/orders",
    "/product",
    "/categories",
    "/category",
    "/search",
    "/profile-setup",
    "/favorites",
    "/recently-viewed",
    "/contact",
    "/support",
    "/return-policy",
    "/shipping-policy",
    "/terms",
    "/privacy-policy",
  ];

  const isFullWidth = fullWidthPages.some((p) =>
    path.startsWith(p)
  );

  const authPages = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/profile-setup",
  ];
  const isAuthPage = authPages.some((p) => path.startsWith(p));

  const authCardPages = [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
  ];
  const isAuthCardPage = authCardPages.some((p) => path.startsWith(p));

  const isHomePage = path === "/";

  return (
    <div
      className={`min-h-screen flex flex-col text-[#1E293B] transition-colors duration-200 ${
        isHomePage
          ? "bg-[#F0F8E8] "
          : "bg-[#F0F8E8]"
      }`}
    >
      <NetworkBanner />
      {!isHeaderHidden && <Header />}

      <main
        className={`w-full flex-1 ${
          isFullWidth
            ? ""
            : path.startsWith("/product")
              ? ""
              : path === "/"
                ? "mx-auto max-w-7xl px-3.5 pt-2.5 sm:px-5 sm:pt-3.5 md:px-6 md:pt-5 lg:px-8"
                : isAuthCardPage
                  ? "mx-auto max-w-7xl px-4 sm:px-5 md:px-6 lg:px-8 flex flex-col flex-1 pb-8"
                : isAuthPage
                  ? "mx-auto max-w-7xl px-4 py-6 sm:px-5 md:px-6 lg:px-8 pb-8"
                  : "mx-auto max-w-7xl px-4 py-6 sm:px-5 md:px-6 lg:px-8 pb-20 lg:pb-8"
        }`}
        style={
          isHeaderHidden && !isAuthCardPage
            ? { paddingTop: "var(--safe-area-top, env(safe-area-inset-top, 0px))" }
            : isAuthCardPage
              ? {
                  paddingTop: "max(1rem, var(--safe-area-top, env(safe-area-inset-top, 0px)))",
                  paddingBottom: "max(2rem, env(safe-area-inset-bottom, 0px))",
                }
              : undefined
        }
      >
        <Outlet />
      </main>

      {isFooterVisible && <Footer />}

      <FloatingCartBar />
      <InstallPrompt />
      <BottomNav />
    </div>
  );
}

export default MainLayout;
