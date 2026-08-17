import { BrowserRouter, Routes, Route } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import Home from "../pages/Home";
import Cart from "../pages/Cart";
import NotFound from "../pages/NotFound";
import Checkout from "../pages/Checkout";
import ProductDetails from "../pages/ProductDetails";
import Category from "../pages/Category";
import OrderSuccess from "../pages/OrderSuccess";
import Login from "../pages/Login";
import Account from "../pages/Account";
import Register from "../pages/Register";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import ForgotPassword from "../pages/ForgotPassword";
import ResetPassword from "../pages/ResetPassword";
import ProfileSetup from "../pages/ProfileSetup";
import Addresses from "../pages/Addresses";
import Profile from "../pages/Profile";

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/cart" element={<Cart />} />

          {/* Protected Checkout */}
          <Route element={<ProtectedRoute />}>
            <Route path="/checkout" element={<Checkout />} />
            <Route path="/profile-setup" element={<ProfileSetup />} />
            <Route path="/account" element={<Account />} />
            <Route path="/account/addresses" element={<Addresses />} />
            <Route path="/account/profile" element={<Profile />} />
          </Route>

          <Route path="/product/:id" element={<ProductDetails />} />
          <Route path="/category/:categoryId" element={<Category />} />
          <Route path="/order-success/:id" element={<OrderSuccess />} />

          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRouter;
