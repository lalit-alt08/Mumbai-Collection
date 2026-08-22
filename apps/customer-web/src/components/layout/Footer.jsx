import { Link } from "react-router-dom";

function Footer() {
  return (
    <footer className="mt-16 rounded-t-[24px] bg-[#05071A] pt-12 pb-8 shadow-[0_-4px_30px_rgba(0,0,0,0.15)] text-white">
      <div className="mx-auto max-w-7xl px-6 md:px-8">

        <div className="grid grid-cols-2 gap-8 md:gap-12">

          {/* Company */}
          <div>
            <h2 className="mb-5 text-sm font-bold uppercase tracking-widest text-white md:text-base">
              Company
            </h2>

            <div className="flex flex-col gap-3 text-sm text-[#7B8195]">
              <Link to="/" className="hover:text-[#7C3AED] transition-colors">
                Home
              </Link>

              <Link to="/contact" className="hover:text-[#7C3AED] transition-colors">
                Contact Us
              </Link>

              <Link to="/login" className="hover:text-white transition">
                Login
              </Link>

              <Link to="/track-order" className="hover:text-white transition">
                Track My Order
              </Link>
            </div>
          </div>

          {/* Policies */}
          <div>
            <h2 className="mb-5 text-sm font-bold uppercase tracking-widest text-white md:text-base">
              Policies
            </h2>

            <div className="flex flex-col gap-3 text-sm text-[#7B8195]">
              <Link
                to="/shipping-policy"
                className="hover:text-[#7C3AED] transition-colors"
              >
                Shipping Policy
              </Link>

              <Link
                to="/return-policy"
                className="hover:text-[#7C3AED] transition-colors"
              >
                Return & Refund Policy
              </Link>

              <Link
                to="/terms"
                className="hover:text-[#7C3AED] transition-colors"
              >
                Terms & Conditions
              </Link>

              <Link
                to="/privacy-policy"
                className="hover:text-[#7C3AED] transition-colors"
              >
                Privacy Policy
              </Link>
            </div>
          </div>

        </div>

        <div className="mt-12 border-t border-[#181F42] pt-6 text-center text-xs text-[#7B8195]">
          © 2026 Mumbai Collection. All Rights Reserved.
        </div>

      </div>
    </footer>
  );
}

export default Footer;