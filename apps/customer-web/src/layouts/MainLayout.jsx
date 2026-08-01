import { Outlet } from "react-router-dom";
import Header from "../components/layout/Header";

function MainLayout() {
  return (
    <div className="min-h-screen bg-gray-100">
      <Header />

      <main className="mx-auto max-w-7xl p-6">
        <Outlet />
      </main>
    </div>
  );
}

export default MainLayout;