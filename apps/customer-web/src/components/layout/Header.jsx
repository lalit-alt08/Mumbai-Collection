import SearchBar from "./SearchBar";
import DeliveryInfo from "./DeliveryInfo";
import Logo from "./Logo";
import AccountButton from "../header/AccountButton";

function Header() {
  return (
    <header className="sticky top-0 z-50 bg-white/95 shadow-[0_4px_30px_rgba(0,0,0,0.03)] backdrop-blur-xl transition-all">
      <div className="mx-auto max-w-7xl px-4 py-3 md:px-8 md:py-4">
        {/* Mobile */}
        <div className="flex items-center justify-between md:hidden">
          <Logo />

          <div className="flex items-center gap-2">
            <AccountButton />
          </div>
        </div>

        <div className="mt-3 md:hidden">
          <SearchBar />
        </div>

        <div className="mt-3 md:hidden">
          <DeliveryInfo />
        </div>

        {/* Desktop */}
        <div className="hidden md:flex md:items-center md:gap-6">
          <Logo />
          <DeliveryInfo />

          <div className="flex-1">
            <SearchBar />
          </div>

          <AccountButton />
        </div>
      </div>
    </header>
  );
}

export default Header;
