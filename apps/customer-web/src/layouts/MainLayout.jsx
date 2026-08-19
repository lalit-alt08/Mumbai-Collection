import { Outlet, useLocation } from "react-router-dom";

import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import FloatingCartBar from "../components/layout/FloatingCartBar";
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
  ];

  const isHeaderHidden = hideHeaderPages.some((p) =>
    path.startsWith(p)
  );

  const isFooterVisible = path === "/";

  const fullWidthPages = ["/account"];

  const isFullWidth = fullWidthPages.some((p) =>
    path.startsWith(p)
  );

  return (
    <div className={`min-h-screen ${path === '/' ? 'bg-[#FFF9F0]' : 'bg-white'}`}>
      <NetworkBanner />
      {!isHeaderHidden && <Header />}

      <main
        className={`w-full ${
          isFullWidth
            ? ""
            : path.startsWith("/product")
              ? ""
              : "mx-auto max-w-7xl px-4 py-8 sm:px-5 md:px-6 lg:px-8"
        }`}
      >
        <Outlet />
      </main>

      {isFooterVisible && <Footer />}

      <FloatingCartBar />
    </div>
  );
}

export default MainLayout;