import { Link } from "react-router-dom";
import logo from "../../assets/logo.png"; 

function Logo() {
  return (
    <Link to="/" className="flex items-center">
      <img
        src={logo}
        alt="Mumbai Collection"
        className="h-20 w-auto object-contain"
      />
    </Link>
  );
}

export default Logo;