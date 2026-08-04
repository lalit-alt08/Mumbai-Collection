import { Link } from "react-router-dom";

function Footer() {
  return (
    <footer className="mt-8 border-t bg-white">
      <div className="mx-auto max-w-7xl px-4 py-8">

        <div className="grid grid-cols-2 gap-8">

          {/* Company */}
          <div>
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide md:text-lg">
              Company
            </h2>

            <div className="flex flex-col gap-3 text-xs text-gray-600 md:text-sm">
              <Link to="/" className="hover:text-black transition">
                Home
              </Link>

              <Link to="/contact" className="hover:text-black transition">
                Contact Us
              </Link>

              <Link to="/login" className="hover:text-black transition">
                Login
              </Link>

              <Link to="/track-order" className="hover:text-black transition">
                Track My Order
              </Link>
            </div>
          </div>

          {/* Policies */}
          <div>
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wide md:text-lg">
              Policies
            </h2>

            <div className="flex flex-col gap-3 text-xs text-gray-600 md:text-sm">
              <Link
                to="/shipping-policy"
                className="hover:text-black transition"
              >
                Shipping Policy
              </Link>

              <Link
                to="/return-policy"
                className="hover:text-black transition"
              >
                Return & Refund Policy
              </Link>

              <Link
                to="/terms"
                className="hover:text-black transition"
              >
                Terms & Conditions
              </Link>

              <Link
                to="/privacy-policy"
                className="hover:text-black transition"
              >
                Privacy Policy
              </Link>
            </div>
          </div>

        </div>

        <div className="mt-8 border-t pt-4 text-center text-xs text-gray-500">
          © 2026 Mumbai Collection. All Rights Reserved.
        </div>

      </div>
    </footer>
  );
}

export default Footer;