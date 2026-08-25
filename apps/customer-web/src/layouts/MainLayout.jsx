import { Outlet, useLocation } from "react-router-dom";

import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import FloatingCartBar from "../components/layout/FloatingCartBar";
import BottomNav from "../components/layout/BottomNav";
import NetworkBanner from "../components/common/NetworkBanner";

function MainLayout() {
  const location = useLocation();
  const path = location.pathname;

  const hideHeaderPages = [
    "/cart",
    "/checkout",
    "/order-success",
    "/order-failed",
    "/product",
    "/account",
    "/track-order",
    "/orders",
    "/categories",
    "/category",
    "/profile-setup",
    "/favorites",
    "/contact",
    "/support",
  ];

  const isHeaderHidden = hideHeaderPages.some((p) =>
    path.startsWith(p)
  );

  const isFooterVisible = path === "/";

  const fullWidthPages = [
    "/account",
    "/track-order",
    "/orders",
    "/product",
    "/categories",
    "/category",
    "/profile-setup",
    "/favorites",
    "/contact",
    "/support",
  ];

  const isFullWidth = fullWidthPages.some((p) =>
    path.startsWith(p)
  );

  return (
    <div className="min-h-screen bg-[#F8F9FD]">
      <NetworkBanner />
      {!isHeaderHidden && <Header />}

      <main
        className={`w-full ${
          isFullWidth
            ? ""
            : path.startsWith("/product")
              ? ""
              : path === "/"
                ? "mx-auto max-w-7xl px-3.5 pt-2.5 sm:px-5 sm:pt-3.5 md:px-6 md:pt-5 lg:px-8"
                : "mx-auto max-w-7xl px-4 py-6 sm:px-5 md:px-6 lg:px-8 pb-20 lg:pb-8"
        }`}
      >
        <Outlet />
      </main>

      {isFooterVisible && <Footer />}

      <FloatingCartBar />
      <BottomNav />
    </div>
  );
}

export default MainLayout;