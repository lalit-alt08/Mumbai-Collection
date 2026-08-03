import { Link } from "react-router-dom";
import logo from "../../assets/logo.png";

function Logo() {
  return (
    <Link
      to="/"
      className="flex items-center flex-shrink-0"
    >
      <img
        src={logo}
        alt="Mumbai Collection"
        className="h-14 w-auto sm:h-16 md:h-20"
      />
    </Link>
  );
}

export default Logo;