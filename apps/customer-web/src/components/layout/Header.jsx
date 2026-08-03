import SearchBar from "./SearchBar";
import DeliveryInfo from "./DeliveryInfo";
import CartButton from "./CartButton";
import Logo from "./Logo";

function Header() {
  return (
    <header className="border-b bg-white shadow-sm">
  <div className="mx-auto max-w-7xl px-3 py-3 md:px-6">

    {/* Mobile */}
    <div className="flex items-center justify-between md:hidden">
      <Logo />
      <CartButton />
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

      <CartButton />
    </div>

  </div>
</header>
  );
}

export default Header;