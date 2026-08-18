import { useState } from "react";
import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Clock, MessageSquare, Send, CheckCircle2, ArrowLeft } from "lucide-react";

function Contact() {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", message: "" });

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[#FFF9F0] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl rounded-[24px] border border-gray-100 bg-white p-6 shadow-sm md:p-12">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#FF8A00] transition hover:text-[#FF7300]"
        >
          <ArrowLeft size={16} /> Back to Home
        </Link>

        <div className="mb-8 border-b border-gray-100 pb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-orange-50 px-4 py-1.5 text-xs font-bold text-[#FF8A00]">
            <MessageSquare size={16} /> We are here to help
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1E1E] md:text-3xl">
            Contact Us & Customer Support
          </h1>
          <p className="mt-2 text-sm text-[#666666]">
            Get in touch with the Mumbai Collection team in Vasai
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          {/* Store & Contact Info */}
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF8A00]">
                <MapPin size={22} />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#1E1E1E]">Store Address</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Mumbai Collection Retail Store<br />
                  Vasai, Maharashtra – 401202, India
                </p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF8A00]">
                <Phone size={22} />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#1E1E1E]">Phone & WhatsApp</h2>
                <p className="mt-1 text-sm text-gray-600">+91 98765 43210</p>
                <p className="text-xs text-gray-400">Available on WhatsApp for instant order help</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF8A00]">
                <Mail size={22} />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#1E1E1E]">Email Support</h2>
                <p className="mt-1 text-sm text-gray-600">support@mumbaicollection.in</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-[#FF8A00]">
                <Clock size={22} />
              </div>
              <div>
                <h2 className="text-base font-bold text-[#1E1E1E]">Store Timings</h2>
                <p className="mt-1 text-sm text-gray-600">Monday – Sunday: 10:00 AM – 9:30 PM</p>
              </div>
            </div>
          </div>

          {/* Quick Message Form */}
          <div className="rounded-2xl border border-gray-100 bg-[#F9FAF8] p-6">
            <h2 className="mb-4 text-base font-bold text-[#1E1E1E]">Send us a Message</h2>

            {submitted ? (
              <div className="rounded-xl bg-orange-50 p-6 text-center">
                <CheckCircle2 size={40} className="mx-auto mb-2 text-[#FF8A00]" />
                <h3 className="font-bold text-[#1E1E1E]">Message Sent!</h3>
                <p className="mt-1 text-xs text-gray-600">
                  Thank you! Our support team will get back to you shortly.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-gray-700">Your Name *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Enter your name"
                    className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3.5 text-sm outline-none transition focus:border-[#FF8A00] focus:ring-2 focus:ring-[#FF8A00]/10"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-gray-700">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
                    placeholder="10-digit mobile number"
                    className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3.5 text-sm outline-none transition focus:border-[#FF8A00] focus:ring-2 focus:ring-[#FF8A00]/10"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-gray-700">Message / Query *</label>
                  <textarea
                    rows={3}
                    required
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="How can we assist you?"
                    className="w-full rounded-xl border border-gray-200 bg-white p-3 text-sm outline-none transition focus:border-[#FF8A00] focus:ring-2 focus:ring-[#FF8A00]/10"
                  />
                </div>

                <button
                  type="submit"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#FF8A00] text-sm font-bold text-white shadow-sm transition hover:bg-[#FF7300] active:scale-95"
                >
                  <Send size={16} /> Send Message
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Contact;
