import { BrowserRouter, Routes, Route } from "react-router-dom";
import MainLayout from "../layouts/MainLayout";
import Home from "../pages/Home";
import Product from "../pages/Product";
import Cart from "../pages/Cart";
import NotFound from "../pages/NotFound";
import Checkout from "../pages/Checkout";

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/product/:id" element={<Product />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<Checkout />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default AppRouter;