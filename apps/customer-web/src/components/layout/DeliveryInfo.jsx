import { MapPin, ChevronDown } from "lucide-react";

function DeliveryInfo() {
  return (
    <button className="flex min-w-fit items-center gap-2 rounded-xl px-3 py-2 transition hover:bg-gray-100">
      <MapPin className="text-green-600" size={20} />

      <div className="text-left">
        <p className="text-xs text-gray-500">
          Deliver to
        </p>

        <p className="flex items-center gap-1 text-sm font-semibold">
          Vasai East
          <ChevronDown size={16} />
        </p>
      </div>
    </button>
  );
}

export default DeliveryInfo;