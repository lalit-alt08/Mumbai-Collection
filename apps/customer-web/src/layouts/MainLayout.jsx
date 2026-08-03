import { Outlet } from "react-router-dom";
import Header from "../components/layout/Header";

function MainLayout() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Header />

      <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-5 md:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

export default MainLayout;