import { useEffect, useState } from "react";
import { Users, Search, Phone, Mail, MapPin, IndianRupee, RotateCcw, Package } from "lucide-react";
import { getCustomers } from "../services/adminApi";

function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchCustomerList = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await getCustomers();
      if (res.success) {
        setCustomers(res.customers || []);
      }
    } catch (err) {
      console.error("Fetch customers error:", err);
      setError("Failed to load customer directory.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomerList();
  }, []);

  const filtered = customers.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900 md:text-3xl">
            Customer Directory & LTV
          </h1>
          <p className="text-xs font-medium text-gray-500 mt-1">
            Customer records, order counts, and lifetime purchase value
          </p>
        </div>

        <button
          onClick={fetchCustomerList}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
        >
          <RotateCcw size={14} /> Refresh
        </button>
      </div>

      {/* Search Bar */}
      <div className="flex rounded-2xl bg-white p-4 shadow-sm border border-gray-100 sm:w-96">
        <div className="relative w-full">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, email, phone..."
            className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-xs font-medium text-gray-800 placeholder-gray-400 focus:border-[#FF8A00] focus:bg-white focus:outline-none transition"
          />
        </div>
      </div>

      {/* Customers Table */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm border border-gray-100">
        {loading ? (
          <div className="p-12 text-center text-xs font-semibold text-gray-500">
            Loading customers...
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs font-semibold text-red-600">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-xs font-medium text-gray-500">
            No customer records found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-extrabold uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="py-3.5 px-4">Customer</th>
                  <th className="py-3.5 px-4">Contact Info</th>
                  <th className="py-3.5 px-4">Location</th>
                  <th className="py-3.5 px-4">Total Orders</th>
                  <th className="py-3.5 px-4">Lifetime Spend (LTV)</th>
                  <th className="py-3.5 px-4">Last Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 font-medium">
                {filtered.map((c) => (
                  <tr key={c.email} className="hover:bg-gray-50/60 transition">
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-[#FF8A00] to-[#FFA726] text-white font-bold text-xs shadow-sm">
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-gray-900">{c.name}</div>
                          <div className="text-[10px] text-gray-400">Customer</div>
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1 text-gray-700">
                          <Mail size={12} className="text-gray-400" /> {c.email}
                        </span>
                        {c.phone && (
                          <a
                            href={`tel:${c.phone}`}
                            className="flex items-center gap-1 text-[#FF8A00] font-bold hover:underline"
                          >
                            <Phone size={12} /> {c.phone}
                          </a>
                        )}
                      </div>
                    </td>

                    <td className="py-4 px-4 text-gray-600">
                      <span className="flex items-center gap-1">
                        <MapPin size={12} className="text-gray-400" /> {c.location}
                      </span>
                    </td>

                    <td className="py-4 px-4">
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-800">
                        <Package size={12} /> {c.ordersCount} order{c.ordersCount !== 1 ? "s" : ""}
                      </span>
                    </td>

                    <td className="py-4 px-4 font-black text-gray-900 text-sm">
                      ₹{c.lifetimeSpent.toLocaleString("en-IN")}
                    </td>

                    <td className="py-4 px-4 text-gray-500 text-[11px]">
                      {new Date(c.lastOrderDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Customers;
