import { Link } from "react-router-dom";
import SearchBar from "./SearchBar";
import DeliveryInfo from "./DeliveryInfo";
import CartButton from "./CartButton";
import Logo from "./Logo";


function Header() {
  return (
    <header className="border-b bg-white shadow-sm">
      <div className="mx-auto flex h-20 max-w-7xl items-center gap-6 px-6">

        <Logo />

        <DeliveryInfo />

        <div className="flex-1">
          <SearchBar />
        </div>
         <CartButton />
      </div>
    </header>
  );
}

export default Header;


