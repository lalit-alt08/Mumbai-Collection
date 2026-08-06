import { Outlet, useLocation } from "react-router-dom";
import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import FloatingCartBar from "../components/layout/FloatingCartBar";

function MainLayout() {
  const location = useLocation();
  const path = location.pathname;

  // Pages that use their own dedicated header
  const hideHeaderPages = ["/cart", "/checkout", "/order-success", "/order-failed"];
  const isHeaderHidden = hideHeaderPages.some(p => path.startsWith(p));
  
  // Footer should ONLY be visible on the Home page
  const isFooterVisible = path === "/";

  return (
    <div className="relative min-h-screen bg-[#F6F7F4] text-[#1E1E1E]">
      {!isHeaderHidden && <Header />}

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-5 md:px-6 lg:px-8">
        <Outlet />
      </main>

      {isFooterVisible && <Footer />}
      <FloatingCartBar />
    </div>
  );
}

export default MainLayout;