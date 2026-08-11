import { User } from "lucide-react";
import { Link } from "react-router-dom";

function AccountButton() {
  return (
    <Link
      to="/account"
      className="
        flex
        items-center
        gap-2
        rounded-full
        border
        border-[#E8E8E8]
        bg-white
        px-5
        py-2.5
        text-sm
        font-medium
        text-[#1E1E1E]
        transition-all
        hover:border-[#3E8E2E]
        hover:text-[#3E8E2E]
      "
    >
      <User size={18} />
      <span>Account</span>
    </Link>
  );
}

export default AccountButton;