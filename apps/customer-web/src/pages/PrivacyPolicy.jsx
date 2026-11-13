import { Link } from "react-router-dom";
import { ShieldCheck, Lock, Eye, FileText, Bell, PhoneCall, ArrowLeft } from "lucide-react";

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#F0F8E8] text-[#1E293B] pb-24 lg:pb-16">
      <header className="sticky top-0 z-30 border-b border-[#C9D2DF] bg-[#F0F8E8]/95 px-4 py-3.5 backdrop-blur-md sm:px-6 md:px-8">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link to="/" aria-label="Back to Home" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#BAC7D8] bg-[#FFFFFF] text-[#1E293B] shadow-[0_3px_8px_rgba(30,41,59,0.15)] transition hover:text-[#22499F] active:scale-95">
            <ArrowLeft size={19} />
          </Link>
          <div>
            <h1 className="text-[17px] font-extrabold leading-tight tracking-[-0.01em] text-[#17233A] sm:text-lg">Privacy Policy</h1>
            <p className="text-[12px] font-medium text-[#60718A]">Mumbai Collection • Privacy & data protection</p>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-6 md:pt-6">
      <div className="rounded-[24px] border border-[#C9D2DF] bg-[#FFFFFF] p-6 shadow-[0_8px_20px_rgba(30,41,59,0.15)] md:p-12">
        {/* Back Link */}
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#AFC3E3] bg-[#F5F8FF] px-3.5 py-2 text-sm font-extrabold text-[#22499F] transition hover:bg-[#EAF0FF]"
        >
          <ArrowLeft size={16} /> Back to Home
        </Link>

        {/* Header */}
        <div className="mb-8 border-b border-[#E2E8F0]/60 pb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#AFC3E3] bg-[#F5F8FF] px-4 py-1.5 text-xs font-extrabold text-[#22499F]">
            <ShieldCheck size={16} /> Privacy & Data Protection
          </div>
          <h1 className="text-[28px] font-black tracking-[-0.03em] text-[#17233A] md:text-3xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-[15px] font-medium text-[#60718A]">
            Last updated: August 2026 • Mumbai Collection, Vasai, Maharashtra
          </p>
        </div>

        {/* Content Sections */}
        <div className="policy-reading space-y-8 text-[15px] leading-7 text-[#52647E] md:text-[16px]">
          {/* Section 1 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <FileText size={18} className="text-[#22499F]" /> 1. Introduction
            </h2>
            <p>
              Welcome to <strong className="text-[#1E293B]">Mumbai Collection</strong> ("we", "our", or "us"). We operate retail stores in Vasai, Maharashtra and provide this online e-commerce platform to bring our quality fashion, apparel, accessories, toys, and lifestyle products directly to your doorstep. We respect your privacy and are committed to safeguarding your personal data in accordance with the Information Technology Act, 2000 and the Digital Personal Data Protection (DPDP) guidelines of India.
            </p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <Eye size={18} className="text-[#22499F]" /> 2. Information We Collect
            </h2>
            <p className="mb-2">When you browse our store, create an account, or place an order, we may collect:</p>
            <ul className="list-inside list-disc space-y-1.5 pl-2 text-[#64748B]">
              <li><strong className="text-[#1E293B]">Contact Information:</strong> Full name, mobile phone number, email address.</li>
              <li><strong className="text-[#1E293B]">Delivery Information:</strong> Street address, flat/house number, landmark, city, state (e.g. Maharashtra), and 6-digit PIN code.</li>
              <li><strong className="text-[#1E293B]">Order & Transaction History:</strong> Products purchased, order amounts, chosen payment method, and fulfillment statuses.</li>
              <li><strong className="text-[#1E293B]">Technical Data:</strong> IP address, device type, browser information, and session cookies for cart management.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <Lock size={18} className="text-[#22499F]" /> 3. How We Use Your Information
            </h2>
            <p className="mb-2">We use your data solely for lawful commercial purposes, including:</p>
            <ul className="list-inside list-disc space-y-1.5 pl-2 text-[#64748B]">
              <li>Processing, packing, and delivering your online orders via our local Vasai riders and courier partners.</li>
              <li>Sending order confirmations, tracking links, and delivery OTPs via SMS or WhatsApp.</li>
              <li>Managing customer accounts, address books, and profile preferences.</li>
              <li>Preventing fraudulent orders, spam, and unpaid RTO (Return to Origin) delivery losses.</li>
              <li>Providing responsive customer support for inquiries, exchanges, or returns.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <ShieldCheck size={18} className="text-[#22499F]" /> 4. Payment & Data Security
            </h2>
            <p>
              We implement industry-standard SSL encryption and secure session tokens to protect your personal details. 
              <strong className="text-[#1E293B]"> We do not store sensitive payment details such as debit/credit card numbers, CVVs, or UPI PINs.</strong>
            </p>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <Bell size={18} className="text-[#22499F]" /> 5. Cookies & Cart Persistence
            </h2>
            <p>
              Our website uses essential session cookies (e.g., authentication cookies and WooCommerce cart tokens) to remember items in your shopping bag and keep you logged in. You can clear cookies through your browser settings at any time, though some shopping features may require cookies to function correctly.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E293B] md:text-lg">
              <FileText size={18} className="text-[#22499F]" /> 6. Sharing with Third Parties
            </h2>
            <p>
              We never sell, rent, or trade your personal information. We only share necessary data with trusted service providers strictly to fulfill your orders (such as local delivery staff in Vasai/Palghar/Mumbai, third-party logistics courier services, and transactional SMS/WhatsApp gateways).
            </p>
          </section>

          {/* Section 7 */}
          <section className="rounded-2xl bg-[#F0F8E8] p-5 border border-[#E2E8F0]">
            <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-[#1E293B]">
              <PhoneCall size={18} className="text-[#22499F]" /> 7. Contact Us & Grievance Redressal
            </h2>
            <p className="text-[#64748B]">
              If you have any questions regarding this Privacy Policy, wish to update your stored data, or have concerns regarding your account, please reach out to:
            </p>
            <div className="mt-3 space-y-1 text-sm font-medium text-[#1E293B]">
              <p className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-1.5"><strong>Store:</strong><span>Mumbai Collection</span></p>
              <p className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-1.5"><strong>Location:</strong><span>Vasai, Maharashtra, India</span></p>
              <div className="space-y-1">
                <p className="flex flex-wrap items-baseline gap-x-1.5"><strong>Customer Care:</strong><span className="whitespace-nowrap">+91 87936 01567</span></p>
                <p>Mon–Sat, 10:00 AM – 9:00 PM</p>
              </div>
            </div>
          </section>
        </div>
      </div>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
