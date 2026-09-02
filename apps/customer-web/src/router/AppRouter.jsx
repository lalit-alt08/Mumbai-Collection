import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import Home from "../pages/Home";
import ProtectedRoute from "../components/auth/ProtectedRoute";
import ScrollToTop from "../components/layout/ScrollToTop";

const Cart = lazy(() => import("../pages/Cart"));
const NotFound = lazy(() => import("../pages/NotFound"));
const Checkout = lazy(() => import("../pages/Checkout"));
const ProductDetails = lazy(() => import("../pages/ProductDetails"));
const Category = lazy(() => import("../pages/Category"));
const OrderSuccess = lazy(() => import("../pages/OrderSuccess"));
const Login = lazy(() => import("../pages/Login"));
const Account = lazy(() => import("../pages/Account"));
const Register = lazy(() => import("../pages/Register"));
const ForgotPassword = lazy(() => import("../pages/ForgotPassword"));
const ResetPassword = lazy(() => import("../pages/ResetPassword"));
const ProfileSetup = lazy(() => import("../pages/ProfileSetup"));
const Addresses = lazy(() => import("../pages/Addresses"));
const Profile = lazy(() => import("../pages/Profile"));
const Orders = lazy(() => import("../pages/Orders"));
const Contact = lazy(() => import("../pages/Contact"));
const TrackOrder = lazy(() => import("../pages/TrackOrder"));
const ShippingPolicy = lazy(() => import("../pages/ShippingPolicy"));
const ReturnPolicy = lazy(() => import("../pages/ReturnPolicy"));
const Terms = lazy(() => import("../pages/Terms"));
const PrivacyPolicy = lazy(() => import("../pages/PrivacyPolicy"));
const Categories = lazy(() => import("../pages/Categories"));
const Favorites = lazy(() => import("../pages/Favorites"));

function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={null}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/category" element={<Categories />} />

            {/* Protected Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/profile-setup" element={<ProfileSetup />} />
              <Route path="/account" element={<Account />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/account/orders" element={<Orders />} />
              <Route path="/account/addresses" element={<Addresses />} />
              <Route path="/account/profile" element={<Profile />} />
              <Route path="/account/favorites" element={<Favorites />} />
            </Route>

            <Route path="/product/:id" element={<ProductDetails />} />
            <Route path="/category/:categoryId" element={<Category />} />
            <Route path="/order-success/:id" element={<OrderSuccess />} />

            {/* Customer & Policy Pages */}
            <Route path="/orders/:orderId/track" element={<TrackOrder />} />
            <Route path="/account/orders/:orderId/track" element={<TrackOrder />} />
            <Route path="/track-order/:orderId" element={<TrackOrder />} />
            <Route path="/track-order" element={<TrackOrder />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/support" element={<Contact />} />
            <Route path="/shipping-policy" element={<ShippingPolicy />} />
            <Route path="/return-policy" element={<ReturnPolicy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />

            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default AppRouter;
