import { Link } from "react-router-dom";
import { ShieldCheck, Lock, Eye, FileText, Bell, PhoneCall, ArrowLeft } from "lucide-react";

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-[#F7F7FB] px-4 py-8 md:py-12">
      <div className="mx-auto max-w-4xl rounded-[24px] border border-gray-100 bg-white p-6 shadow-sm md:p-12">
        {/* Back Link */}
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-[#7C3AED] transition hover:text-[#6C35E8]"
        >
          <ArrowLeft size={16} /> Back to Home
        </Link>

        {/* Header */}
        <div className="mb-8 border-b border-gray-100 pb-6">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#F1ECFF] px-4 py-1.5 text-xs font-bold text-[#7C3AED]">
            <ShieldCheck size={16} /> Privacy & Data Protection
          </div>
          <h1 className="text-2xl font-extrabold text-[#1E1E1E] md:text-3xl">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-[#666666]">
            Last updated: August 2026 • Mumbai Collection, Vasai, Maharashtra
          </p>
        </div>

        {/* Content Sections */}
        <div className="space-y-8 text-sm leading-relaxed text-[#4A4A4A] md:text-[15px]">
          {/* Section 1 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <FileText size={18} className="text-[#7C3AED]" /> 1. Introduction
            </h2>
            <p>
              Welcome to <strong>Mumbai Collection</strong> ("we", "our", or "us"). We operate retail stores in Vasai, Maharashtra and provide this online e-commerce platform to bring our quality fashion, apparel, accessories, toys, and lifestyle products directly to your doorstep. We respect your privacy and are committed to safeguarding your personal data in accordance with the Information Technology Act, 2000 and the Digital Personal Data Protection (DPDP) guidelines of India.
            </p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <Eye size={18} className="text-[#7C3AED]" /> 2. Information We Collect
            </h2>
            <p className="mb-2">When you browse our store, create an account, or place an order, we may collect:</p>
            <ul className="list-inside list-disc space-y-1.5 pl-2 text-gray-600">
              <li><strong>Contact Information:</strong> Full name, mobile phone number, email address.</li>
              <li><strong>Delivery Information:</strong> Street address, flat/house number, landmark, city, state (e.g. Maharashtra), and 6-digit PIN code.</li>
              <li><strong>Order & Transaction History:</strong> Products purchased, order amounts, chosen payment method (Cash on Delivery / UPI), and fulfillment statuses.</li>
              <li><strong>Technical Data:</strong> IP address, device type, browser information, and session cookies for cart management.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <Lock size={18} className="text-[#7C3AED]" /> 3. How We Use Your Information
            </h2>
            <p className="mb-2">We use your data solely for lawful commercial purposes, including:</p>
            <ul className="list-inside list-disc space-y-1.5 pl-2 text-gray-600">
              <li>Processing, packing, and delivering your online orders via our local Vasai riders and courier partners.</li>
              <li>Sending order confirmations, tracking links, and delivery OTPs via SMS or WhatsApp.</li>
              <li>Managing customer accounts, address books, and profile preferences.</li>
              <li>Preventing fraudulent orders, spam, and unpaid RTO (Return to Origin) delivery losses.</li>
              <li>Providing responsive customer support for inquiries, exchanges, or returns.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <ShieldCheck size={18} className="text-[#7C3AED]" /> 4. Payment & Data Security
            </h2>
            <p>
              We implement industry-standard SSL encryption and secure session tokens to protect your personal details. 
              <strong> We do not store sensitive payment details such as debit/credit card numbers, CVVs, or UPI PINs.</strong> For Cash on Delivery (COD) orders, payment is collected physically upon delivery.
            </p>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <Bell size={18} className="text-[#7C3AED]" /> 5. Cookies & Cart Persistence
            </h2>
            <p>
              Our website uses essential session cookies (e.g., authentication cookies and WooCommerce cart tokens) to remember items in your shopping bag and keep you logged in. You can clear cookies through your browser settings at any time, though some shopping features may require cookies to function correctly.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-[#1E1E1E] md:text-lg">
              <FileText size={18} className="text-[#7C3AED]" /> 6. Sharing with Third Parties
            </h2>
            <p>
              We never sell, rent, or trade your personal information. We only share necessary data with trusted service providers strictly to fulfill your orders (such as local delivery staff in Vasai/Palghar/Mumbai, third-party logistics courier services, and transactional SMS/WhatsApp gateways).
            </p>
          </section>

          {/* Section 7 */}
          <section className="rounded-2xl bg-[#F1ECFF]/70 p-5 border border-[#C4B5FD]/40">
            <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-[#1E1E1E]">
              <PhoneCall size={18} className="text-[#7C3AED]" /> 7. Contact Us & Grievance Redressal
            </h2>
            <p className="text-gray-700">
              If you have any questions regarding this Privacy Policy, wish to update your stored data, or have concerns regarding your account, please reach out to:
            </p>
            <div className="mt-3 text-sm font-medium text-gray-800 space-y-1">
              <p><strong>Store:</strong> Mumbai Collection</p>
              <p><strong>Location:</strong> Vasai, Maharashtra – 401202, India</p>
              <p><strong>Support Email:</strong> support@mumbaicollection.in</p>
              <p><strong>Customer Care:</strong> +91 98765 43210 (Mon–Sat, 10:00 AM – 9:00 PM)</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
