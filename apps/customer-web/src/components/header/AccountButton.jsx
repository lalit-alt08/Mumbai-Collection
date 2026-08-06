import { User } from "lucide-react";

function AccountButton() {
  return (
    <button
      onClick={() =>
        window.location.href = "https://mumbai-collection.local/my-account"
      }
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
        duration-300
        hover:-translate-y-[2px]
        hover:border-[#3E8E2E]
        hover:text-[#3E8E2E]
        hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)]
      "
    >
      <User size={20} />
      <span className="hidden lg:block">Login</span>
    </button>
  );
}

export default AccountButton;