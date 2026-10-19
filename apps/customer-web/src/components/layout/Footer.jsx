import { Link } from "react-router-dom";

function Footer() {
  return (
    <footer className="mt-8 sm:mt-10 md:mt-12 rounded-t-[24px] bg-[#070D18] border-t border-[#162744] pt-8 sm:pt-10 pb-24 sm:pb-12 shadow-[0_-4px_30px_rgba(0,0,0,0.5)] text-white">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 md:px-8">

        <div className="grid grid-cols-2 gap-8 md:gap-12">

          {/* Company */}
          <div>
            <h2 className="mb-5 text-sm font-bold uppercase tracking-widest text-white md:text-base">
              Company
            </h2>

            <div className="flex flex-col gap-3 text-sm text-[#8FA4BE]">
              <Link to="/" className="hover:text-[#42D6E8] transition-colors">
                Home
              </Link>

              <Link to="/contact" className="hover:text-[#42D6E8] transition-colors">
                Contact Us
              </Link>

              <Link to="/login" className="hover:text-white transition">
                Login
              </Link>
            </div>
          </div>

          {/* Policies */}
          <div>
            <h2 className="mb-5 text-sm font-bold uppercase tracking-widest text-white md:text-base">
              Policies
            </h2>

            <div className="flex flex-col gap-3 text-sm text-[#8FA4BE]">
              <Link
                to="/return-policy"
                className="hover:text-[#42D6E8] transition-colors"
              >
                Return & Refund Policy
              </Link>

              <Link
                to="/terms"
                className="hover:text-[#42D6E8] transition-colors"
              >
                Terms & Conditions
              </Link>

              <Link
                to="/privacy-policy"
                className="hover:text-[#42D6E8] transition-colors"
              >
                Privacy Policy
              </Link>
            </div>
          </div>

        </div>

        <div className="mt-12 border-t border-[#162744] pt-6 text-center text-xs text-[#8FA4BE]">
          © 2026 Mumbai Collection. All Rights Reserved.
        </div>

      </div>
    </footer>
  );
}

export default Footer;