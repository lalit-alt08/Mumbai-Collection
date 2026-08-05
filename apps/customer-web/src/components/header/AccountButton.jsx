import { User } from "lucide-react";
import { goToAccount } from "../../utils/navigation";

function AccountButton() {
  return (
    <button
      onClick={goToAccount}
      className="
        flex
        items-center
        gap-2
        rounded-xl
        border
        border-gray-300
        px-4
        py-3
        text-sm
        font-medium
        transition
        hover:bg-gray-100
      "
    >
      <User size={20} />
      <span className="hidden lg:block">Login</span>
    </button>
  );
}

export default AccountButton;