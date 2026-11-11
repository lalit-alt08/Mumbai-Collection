import { Link } from "react-router-dom";

function Footer() {
  return (
    <footer className="mt-8 sm:mt-10 md:mt-12 rounded-t-[24px] bg-[#FFFFFF] border border-[#E2E8F0] pt-8 sm:pt-10 pb-24 sm:pb-12 text-[#1E293B]">
      <div className="mx-auto max-w-7xl px-5 sm:px-6 md:px-8">

        <div className="grid grid-cols-2 gap-8 md:gap-12">

          {/* Company */}
          <div>
            <h2 className="mb-5 text-base font-extrabold uppercase tracking-wider text-[#1E293B]">
              Company
            </h2>

            <div className="flex flex-col gap-3 text-base font-semibold leading-relaxed text-[#475569]">
              <Link to="/" className="hover:text-[#22499F] transition-colors">
                Home
              </Link>

              <Link to="/contact" className="hover:text-[#22499F] transition-colors">
                Contact Us
              </Link>
            </div>
          </div>

          {/* Policies */}
          <div>
            <h2 className="mb-5 text-base font-extrabold uppercase tracking-wider text-[#1E293B]">
              Policies
            </h2>

            <div className="flex flex-col gap-3 text-base font-semibold leading-relaxed text-[#475569]">
              <Link
                to="/return-policy"
                className="hover:text-[#22499F] transition-colors"
              >
                Return & Refund Policy
              </Link>

              <Link
                to="/terms"
                className="hover:text-[#22499F] transition-colors"
              >
                Terms & Conditions
              </Link>

              <Link
                to="/privacy-policy"
                className="hover:text-[#22499F] transition-colors"
              >
                Privacy Policy
              </Link>
            </div>
          </div>

        </div>

        <div className="mt-5 border-t border-[#E2E8F0] pt-3 text-center text-sm font-semibold text-[#475569]">
          © 2026 Mumbai Collection. All Rights Reserved.
        </div>

      </div>
    </footer>
  );
}

export default Footer;
