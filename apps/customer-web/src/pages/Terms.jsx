import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, Mail, Phone, MapPin } from "lucide-react";

function Terms() {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#1E1E1E] pb-24 lg:pb-16">
      {/* ================= STICKY APP-BAR ================= */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-100 bg-white/95 px-4 py-3 backdrop-blur-md sm:px-6 md:px-8">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            aria-label="Go back"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-gray-700 transition hover:bg-gray-200 active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-base font-bold text-[#1E1E1E] sm:text-lg leading-tight">
              Terms & Conditions
            </h1>
            <p className="text-[11px] font-medium text-gray-500">
              Mumbai Collection • Legal & Terms of Use
            </p>
          </div>
        </div>
      </header>

      {/* ================= CONTENT CONTAINER ================= */}
      <div className="mx-auto max-w-4xl px-4 pt-4 sm:px-6 md:pt-6">
        <div className="rounded-[24px] border border-gray-100 bg-white p-6 shadow-xs sm:p-8 md:p-10 space-y-6">
          {/* Header Introduction */}
          <div className="border-b border-gray-100 pb-6 space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#F1ECFF] px-3.5 py-1 text-xs font-bold text-[#7C3AED]">
              <FileText size={14} /> Legal Agreement
            </div>
            <h1 className="text-2xl font-extrabold text-[#1E1E1E] sm:text-3xl tracking-tight">
              Terms & Conditions
            </h1>
            <p className="text-xs font-semibold text-gray-500">
              Last Updated: September 2026
            </p>
            <p className="pt-2 text-xs sm:text-sm leading-relaxed text-gray-600">
              Welcome to <strong>Mumbai Collection</strong>. These Terms & Conditions govern your access to and use of our website and your purchase of products through our platform. By using our website or placing an order, you agree to these Terms & Conditions.
            </p>
          </div>

          {/* 24 Sections */}
          <div className="space-y-6 text-xs sm:text-sm leading-relaxed text-gray-700">
            {/* 1 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                1. About Mumbai Collection
              </h2>
              <p>
                Mumbai Collection is an online retail platform offering products for purchase through its website. These Terms apply to all visitors, registered customers, and purchasers using our website.
              </p>
            </section>

            {/* 2 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                2. Eligibility
              </h2>
              <p>
                You must provide accurate and complete information when creating an account or placing an order. You are responsible for ensuring that the information provided, including your name, mobile number, email address, and delivery address, is correct.
              </p>
            </section>

            {/* 3 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                3. Products and Product Information
              </h2>
              <p>
                We make reasonable efforts to ensure that product descriptions, images, specifications, prices, and availability displayed on the website are accurate.
              </p>
              <p>
                Actual product colours, appearance, packaging, or minor details may vary slightly from images displayed on the website due to photography, lighting, screen settings, manufacturer changes, or packaging updates.
              </p>
              <p>
                We reserve the right to correct errors, update product information, or change product availability at any time.
              </p>
            </section>

            {/* 4 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                4. Pricing
              </h2>
              <p>
                All prices displayed on the website are in Indian Rupees (INR) unless otherwise stated.
              </p>
              <p>
                Prices, offers, discounts, and availability may change without prior notice.
              </p>
              <p>
                In the event of an incorrect price caused by a technical, typographical, or system error, Mumbai Collection reserves the right to cancel the affected order and refund any amount already paid.
              </p>
            </section>

            {/* 5 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                5. Minimum Order Value
              </h2>
              <p>
                The minimum order value for purchases on Mumbai Collection is <strong>₹500</strong>.
              </p>
              <p>
                Orders with a product subtotal below ₹500 cannot be placed through the website.
              </p>
              <p>
                Applicable delivery charges, taxes, discounts, or promotional adjustments may be calculated separately unless specifically stated otherwise.
              </p>
            </section>

            {/* 6 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                6. Orders
              </h2>
              <p>
                When you place an order, you will receive an order confirmation through the contact details provided by you.
              </p>
              <p>
                An order is considered accepted only after Mumbai Collection confirms the order.
              </p>
              <p>
                We reserve the right to refuse, cancel, or limit an order where reasonably necessary, including in cases involving:
              </p>
              <ul className="list-inside list-disc space-y-1 pl-2 text-gray-600">
                <li>Product unavailability</li>
                <li>Incorrect pricing or product information</li>
                <li>Payment failure</li>
                <li>Incorrect or incomplete customer information</li>
                <li>Suspected fraudulent or unauthorized activity</li>
                <li>Technical errors</li>
                <li>Violation of these Terms & Conditions</li>
              </ul>
              <p>
                If an order is cancelled after payment has been received, the applicable amount will be refunded through the appropriate payment method.
              </p>
            </section>

            {/* 7 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                7. Payment
              </h2>
              <p>
                Customers must complete payment using the payment options available during checkout.
              </p>
              <p>
                Payment transactions may be processed through third-party payment service providers. Mumbai Collection does not request or store your complete payment-card credentials unless expressly stated.
              </p>
              <p>
                An order will be processed only after successful payment authorization where online payment is required.
              </p>
            </section>

            {/* 8 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                8. Delivery
              </h2>
              <p>
                Mumbai Collection currently provides delivery only to serviceable locations supported by our delivery network.
              </p>
              <p>
                The availability of delivery to a particular location may be determined based on the delivery address and serviceability checks performed during checkout.
              </p>
              <p>
                Estimated delivery times displayed on the website are indicative and may vary due to courier delays, weather conditions, public holidays, operational issues, or circumstances beyond our reasonable control.
              </p>
              <p>
                Customers are responsible for providing a complete and accurate delivery address and ensuring that someone is available to receive the order where necessary.
              </p>
            </section>

            {/* 9 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                9. Delivery Charges
              </h2>
              <p>
                Applicable delivery charges, if any, will be displayed during checkout before the order is placed.
              </p>
              <p>
                Delivery charges may vary depending on factors such as location, order value, promotional offers, or delivery conditions.
              </p>
            </section>

            {/* 10 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                10. Order Cancellation
              </h2>
              <p>
                Customers may request cancellation of an order before it has been dispatched.
              </p>
              <p>
                Once an order has been dispatched, cancellation may not be possible.
              </p>
              <p>
                To request a cancellation, customers should contact Mumbai Collection as soon as possible using the contact details provided on the website.
              </p>
            </section>

            {/* 11 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                11. Returns, Exchanges and Replacements
              </h2>
              <p>
                Returns, exchanges, or replacements are subject to the return conditions applicable to the particular product.
              </p>
              <p>
                Where a return or replacement is permitted, the product may be required to:
              </p>
              <ul className="list-inside list-disc space-y-1 pl-2 text-gray-600">
                <li>Be unused and in its original condition</li>
                <li>Include original packaging, tags, accessories, and other included items</li>
                <li>Be returned within the applicable return period</li>
                <li>Satisfy any product-specific return conditions</li>
              </ul>
              <p>
                Certain products may be non-returnable or may have different return conditions due to their nature.
              </p>
              <p>
                Mumbai Collection reserves the right to reject a return, exchange, or replacement request where the applicable conditions are not satisfied.
              </p>
            </section>

            {/* 12 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                12. Damaged, Defective or Incorrect Products
              </h2>
              <p>
                If you receive a product that is damaged, defective, incomplete, or different from what you ordered, please contact Mumbai Collection as soon as reasonably possible after delivery.
              </p>
              <p>
                We may request photographs, videos, packaging information, or other details to assess the issue.
              </p>
              <p>
                Where the claim is accepted, Mumbai Collection may provide an appropriate replacement, exchange, refund, or other resolution depending on the circumstances and product availability.
              </p>
            </section>

            {/* 13 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                13. Refunds
              </h2>
              <p>
                Where a refund is approved, the refund will generally be processed using the original payment method where technically possible.
              </p>
              <p>
                The time required for the refunded amount to appear in your account may depend on the payment gateway, bank, card issuer, or other financial institution.
              </p>
              <p>
                Shipping or other charges may be non-refundable where permitted by applicable law and depending on the circumstances of the return or cancellation.
              </p>
            </section>

            {/* 14 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                14. Promotions and Discounts
              </h2>
              <p>
                Promotional offers, coupons, discounts, and special campaigns may be subject to additional terms, eligibility requirements, validity periods, product restrictions, or usage limits.
              </p>
              <p>
                Mumbai Collection may modify, suspend, or withdraw promotional offers subject to applicable law.
              </p>
              <p>
                Unless explicitly stated otherwise, promotional offers cannot be combined.
              </p>
            </section>

            {/* 15 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                15. Customer Accounts
              </h2>
              <p>
                Where account registration is available, you are responsible for maintaining the confidentiality of your login credentials and for activities conducted through your account.
              </p>
              <p>
                You must notify Mumbai Collection if you believe your account has been accessed without authorization.
              </p>
              <p>
                Mumbai Collection may suspend or restrict an account where there is reasonable evidence of misuse, fraudulent activity, or violation of these Terms.
              </p>
            </section>

            {/* 16 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                16. Website Use
              </h2>
              <p>You agree not to:</p>
              <ul className="list-inside list-disc space-y-1 pl-2 text-gray-600">
                <li>Use the website for unlawful or fraudulent purposes</li>
                <li>Attempt unauthorized access to our systems</li>
                <li>Interfere with the operation or security of the website</li>
                <li>Upload malicious code or harmful content</li>
                <li>Use automated methods to abuse or overload the website</li>
                <li>Misuse customer, product, order, or account information</li>
              </ul>
            </section>

            {/* 17 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                17. Intellectual Property
              </h2>
              <p>
                All website content, including the Mumbai Collection name, logo, graphics, photographs, text, product content, website design, and other materials, is owned by or licensed to Mumbai Collection unless otherwise stated.
              </p>
              <p>
                You may not reproduce, distribute, modify, publish, or commercially use such content without prior written permission.
              </p>
            </section>

            {/* 18 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                18. Third-Party Services
              </h2>
              <p>
                Our website may use third-party services, including payment gateways, delivery partners, analytics providers, hosting providers, or other technology services.
              </p>
              <p>
                Your use of such services may also be subject to the terms and policies of those third parties.
              </p>
            </section>

            {/* 19 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                19. Privacy
              </h2>
              <p>
                Your personal information is handled in accordance with our Privacy Policy.
              </p>
              <p>
                By using the website and placing orders, you acknowledge that your information may be processed as necessary to provide products, payment processing, delivery, customer support, fraud prevention, and related services.
              </p>
            </section>

            {/* 20 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                20. Availability and Technical Issues
              </h2>
              <p>
                We make reasonable efforts to keep the website available and functioning properly. However, temporary interruptions may occur because of maintenance, technical failures, network problems, third-party service interruptions, or other circumstances beyond our reasonable control.
              </p>
            </section>

            {/* 21 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                21. Limitation of Liability
              </h2>
              <p>
                Mumbai Collection will make reasonable efforts to provide accurate information and reliable services.
              </p>
              <p>
                To the extent permitted by applicable law, Mumbai Collection will not be responsible for indirect or consequential losses arising from circumstances beyond our reasonable control, including delays caused by third-party service providers, delivery partners, network failures, or technical interruptions.
              </p>
              <p>
                Nothing in these Terms is intended to exclude or limit rights that cannot legally be excluded under applicable law.
              </p>
            </section>

            {/* 22 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                22. Changes to These Terms
              </h2>
              <p>
                Mumbai Collection may update these Terms & Conditions from time to time.
              </p>
              <p>
                Changes will become effective when the updated Terms are published on the website unless otherwise stated.
              </p>
              <p>
                Your continued use of the website after updated Terms are published constitutes acceptance of the revised Terms.
              </p>
            </section>

            {/* 23 */}
            <section className="space-y-2">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                23. Governing Law
              </h2>
              <p>
                These Terms & Conditions shall be governed by and interpreted in accordance with the laws applicable in India.
              </p>
              <p>
                Any disputes shall be subject to the jurisdiction of the appropriate courts having jurisdiction over the matter, subject to applicable law.
              </p>
            </section>

            {/* 24 */}
            <section className="space-y-3 rounded-2xl border border-gray-100 bg-gray-50/60 p-5 sm:p-6">
              <h2 className="text-sm sm:text-base font-bold text-[#1E1E1E]">
                24. Contact Us
              </h2>
              <p className="text-gray-600">
                For questions regarding orders, cancellations, returns, refunds, delivery, or these Terms & Conditions, please contact Mumbai Collection through the contact information below:
              </p>
              <div className="space-y-2 text-xs sm:text-sm font-medium text-gray-800 pt-1">
                <p className="font-bold text-[#1E1E1E]">Mumbai Collection</p>
                <p className="flex items-center gap-2">
                  <Mail size={15} className="text-[#7C3AED] shrink-0" />
                  <span><strong>Email:</strong> support@mumbaicollection.in</span>
                </p>
                <p className="flex items-center gap-2">
                  <Phone size={15} className="text-[#7C3AED] shrink-0" />
                  <span><strong>Phone:</strong> +91 87936 01567</span>
                </p>
                <p className="flex items-start gap-2">
                  <MapPin size={15} className="text-[#7C3AED] shrink-0 mt-0.5" />
                  <span><strong>Address:</strong> Mumbai Collection Retail Store, Vasai West, Maharashtra – 401202, India</span>
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Terms;
