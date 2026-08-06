import { Link } from "react-router-dom";

function Footer() {
  return (
    <footer className="mt-16 bg-white pt-12 pb-8 shadow-[0_-4px_24px_rgba(0,0,0,0.02)]">
      <div className="mx-auto max-w-7xl px-6 md:px-8">

        <div className="grid grid-cols-2 gap-8 md:gap-12">

          {/* Company */}
          <div>
            <h2 className="mb-5 text-sm font-bold uppercase tracking-widest text-[#1E1E1E] md:text-base">
              Company
            </h2>

            <div className="flex flex-col gap-3 text-sm text-[#666666]">
              <Link to="/" className="hover:text-[#3E8E2E] transition-colors">
                Home
              </Link>

              <Link to="/contact" className="hover:text-[#3E8E2E] transition-colors">
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
            <h2 className="mb-5 text-sm font-bold uppercase tracking-widest text-[#1E1E1E] md:text-base">
              Policies
            </h2>

            <div className="flex flex-col gap-3 text-sm text-[#666666]">
              <Link
                to="/shipping-policy"
                className="hover:text-[#3E8E2E] transition-colors"
              >
                Shipping Policy
              </Link>

              <Link
                to="/return-policy"
                className="hover:text-[#3E8E2E] transition-colors"
              >
                Return & Refund Policy
              </Link>

              <Link
                to="/terms"
                className="hover:text-[#3E8E2E] transition-colors"
              >
                Terms & Conditions
              </Link>

              <Link
                to="/privacy-policy"
                className="hover:text-[#3E8E2E] transition-colors"
              >
                Privacy Policy
              </Link>
            </div>
          </div>

        </div>

        <div className="mt-12 border-t border-[#E8E8E8] pt-6 text-center text-xs text-[#666666]">
          © 2026 Mumbai Collection. All Rights Reserved.
        </div>

      </div>
    </footer>
  );
}

export default Footer;