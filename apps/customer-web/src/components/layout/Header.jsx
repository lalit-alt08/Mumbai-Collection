import SearchBar from "./SearchBar";
import DeliveryInfo from "./DeliveryInfo";
import CartButton from "./CartButton";
import Logo from "./Logo";
import AccountButton from "../header/AccountButton";

function Header() {
  return (
    <header className="border-b bg-white shadow-sm">
      <div className="mx-auto max-w-7xl px-3 py-3 md:px-6">
        {/* Mobile */}
        <div className="flex items-center justify-between md:hidden">
          <Logo />

          <div className="flex items-center gap-2">
            <AccountButton />
            <CartButton />
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

          <CartButton />
        </div>
      </div>
    </header>
  );
}

export default Header;
