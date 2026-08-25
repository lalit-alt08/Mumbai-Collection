import { Link } from "react-router-dom";
import logo from "../../assets/Logo.jpg";

function Logo({ className = "h-13 md:h-14 lg:h-[58px] xl:h-[62px] w-auto max-w-full" }) {
  return (
    <Link
      to="/"
      className="flex items-center justify-center"
      aria-label="Mumbai Collection Home"
    >
      <img
        src={logo}
        alt="Mumbai Collection"
        className={`${className} object-contain`}
      />
    </Link>
  );
}

export default Logo;