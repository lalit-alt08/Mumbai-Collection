import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Customer Search & Read-Only Payments Verification", () => {
  const phpPath = path.resolve(__dirname, "../../../mumbai-auth.php");
  const phpContent = fs.readFileSync(phpPath, "utf8");

  test("WordPress Plugin: Customer search has exact email matching and order billing email branch", () => {
    // 1. Live account email exact match & indexed customer email match
    assert.match(
      phpContent,
      /u\.user_email\s*=\s*%s/,
      "Must match exact live account email"
    );
    assert.match(
      phpContent,
      /table_customer_search.*email\s*=\s*%s/,
      "Must match exact customer search index email"
    );

    // 2. Exact historical billing email matching on wc_orders where customer_id > 0
    assert.match(
      phpContent,
      /SELECT\s+DISTINCT\s+customer_id\s+FROM\s+\{\$table_orders\}\s+WHERE\s+billing_email\s*=\s*%s\s+AND\s+customer_id\s*>\s*0/,
      "Must search past orders billing_email for registered customer accounts"
    );

    // 3. Email fragments bypass boolean full-text token matcher
    assert.match(
      phpContent,
      /user_email\s+LIKE\s+%s/,
      "Must match partial email fragments using literal LIKE"
    );

    // 4. Contact priority ordering places exact contact matches first
    assert.match(
      phpContent,
      /\$order_by\s*=\s*\$contact_priority_sql\s*\.\s*\$order_by/,
      "Must rank exact contact matches first before generic sort"
    );

    // 5. Phone normalization handles +91 and checks phone pattern
    assert.match(
      phpContent,
      /substr\(\$digits,\s*0,\s*2\)\s*===\s*'91'/,
      "Must strip Indian country code 91 from normalized phone query"
    );
  });

  test("WordPress Plugin: Phone lookup uses equality for full numbers and safe fallback during index rebuild", () => {
    // Exact equality for full numbers when search index is ready
    assert.match(
      phpContent,
      /WHERE\s+phone_digits\s*=\s*%s/,
      "Must use exact equality for full phone number on indexed search table"
    );

    // Multi-phone indexing table and helper
    assert.match(
      phpContent,
      /function\s+mumbai_customer_search_phones_table_name/,
      "Must define mumbai_customer_search_phones_table_name"
    );
    assert.match(
      phpContent,
      /function\s+mumbai_get_user_all_contact_phones/,
      "Must define mumbai_get_user_all_contact_phones helper"
    );
    assert.match(
      phpContent,
      /table_customer_search_phones/,
      "Must query indexed phone table across all customer contacts"
    );

    // Fallback normalizes meta_value spaces and hyphens across billing_phone, profile, and saved addresses
    assert.match(
      phpContent,
      /REPLACE\(REPLACE\(REPLACE\(REPLACE\(REPLACE\(meta_value,\s*' ',\s*''\)/,
      "Must clean spaces, hyphens, and plus signs in billing_phone fallback"
    );
    assert.match(
      phpContent,
      /_mumbai_user_profile.*_mumbai_saved_addresses/,
      "Fallback phone search must cover user profile and saved addresses during index rebuild"
    );

    // Targets actual phone keys in serialized metadata to avoid false positives on postcodes/street addresses
    assert.match(
      phpContent,
      /mumbai_normalize_phone\(\$cand\)/,
      "Fallback phone search must normalize structured phone candidate before comparison"
    );
    assert.match(
      phpContent,
      /meta_value\s+LIKE\s+%s/,
      "Fallback phone search must pre-filter structured metadata in SQL to avoid loading all rows"
    );
  });

  test("WordPress Plugin: Suspension status is authoritative", () => {
    assert.match(
      phpContent,
      /\$is_suspended\s*=\s*mumbai_is_customer_suspended\(\$user_id\);/,
      "Must call authoritative mumbai_is_customer_suspended instead of reading raw user_meta directly"
    );
  });

  test("WordPress Plugin: Exposes read-only payments routes with internal permissions", () => {
    assert.match(
      phpContent,
      /'\/admin\/customers\/\(\?P<id>\\d\+\)\/payments'/,
      "Must register /admin/customers/:id/payments route"
    );
    assert.match(
      phpContent,
      /'\/admin\/payments\/lookup'/,
      "Must register /admin/payments/lookup route"
    );
    assert.match(
      phpContent,
      /function\s+mumbai_admin_get_customer_payments/,
      "Must declare mumbai_admin_get_customer_payments function"
    );
    assert.match(
      phpContent,
      /function\s+mumbai_admin_lookup_payment_reference/,
      "Must declare mumbai_admin_lookup_payment_reference function"
    );
  });

  test("WordPress Plugin & Backend: Payment status outcome labels include 'Needs review' for unconfirmed refunds", () => {
    const requiredLabelsInPhp = [
      "Order created · #",
      "Payment captured · Order not created yet",
      "Payment capture not confirmed",
      "Refund pending",
      "Refunded",
      "Needs review",
      "No matching payment record found",
    ];

    for (const label of requiredLabelsInPhp) {
      assert.ok(
        phpContent.includes(label),
        `mumbai-auth.php must support plain label: ${label}`
      );
    }

    const controllerPath = path.resolve(__dirname, "../src/controllers/adminCustomerController.js");
    const controllerContent = fs.readFileSync(controllerPath, "utf8");
    assert.ok(
      controllerContent.includes("Payment lookup unavailable"),
      "Controller must return 'Payment lookup unavailable' on failure"
    );
    assert.ok(
      controllerContent.includes("Payment captured · Order verification unavailable"),
      "Controller must support 'Payment captured · Order verification unavailable'"
    );
    assert.ok(
      controllerContent.includes("Partially refunded"),
      "Controller must support 'Partially refunded' outcome label"
    );
    assert.ok(
      controllerContent.includes("minimumFractionDigits: 2"),
      "Controller must format partial refund with 2 decimal places to preserve paise"
    );
    assert.ok(
      controllerContent.includes("hasCustomerConflict"),
      "Controller must detect customer ID conflict between payment and order"
    );
    assert.ok(
      controllerContent.includes("api.get(`orders/${localPayment.wc_order_id}`)") ||
      controllerContent.includes("api.get('orders/' + localPayment.wc_order_id)") ||
      controllerContent.includes("orders/${localPayment.wc_order_id}"),
      "Controller must verify stored WooCommerce order ID with WooCommerce API"
    );
  });

  test("Admin Dashboard: Customers.jsx UI requirements verified", () => {
    const customersJsxPath = path.resolve(__dirname, "../../admin-dashboard/src/pages/Customers.jsx");
    const jsxContent = fs.readFileSync(customersJsxPath, "utf8");

    // 1. Label and placeholder
    assert.match(
      jsxContent,
      /Find a customer/,
      "Must display visible label 'Find a customer'"
    );
    assert.match(
      jsxContent,
      /Search by customer name, phone, email, or location/,
      "Must include required search placeholder"
    );

    // 2. No hardcoded Active badge - uses c.is_suspended
    assert.match(
      jsxContent,
      /c\.is_suspended\s*\?/,
      "Must check c.is_suspended for status badge"
    );

    // 3. View orders & payments primary action button
    assert.match(
      jsxContent,
      /View orders & payments/,
      "Must have primary action button 'View orders & payments'"
    );

    // 4. Top-right Refresh button removed (no setPageRefresh registration)
    assert.ok(
      !jsxContent.includes("setPageRefresh?."),
      "Must NOT register setPageRefresh so top-right Refresh button is removed"
    );

    // 5. Orders on file & Latest order summary & Recent Online Payments
    assert.match(
      jsxContent,
      /Orders on file:/,
      "Must display 'Orders on file:' in customer details"
    );
    assert.match(
      jsxContent,
      /Latest Order:/,
      "Must display summary of latest order"
    );
    assert.match(
      jsxContent,
      /Recent Online Payments/,
      "Must display Recent Online Payments section"
    );
    assert.match(
      jsxContent,
      /Search Razorpay Reference/,
      "Must provide staff reference lookup"
    );

    // 6. Request lifecycle & association
    assert.match(
      jsxContent,
      /refAbortControllerRef/,
      "Must use refAbortControllerRef to manage in-flight lookup lifecycle"
    );
    assert.match(
      jsxContent,
      /Associated with this customer/,
      "Must display confirmation when payment belongs to selected customer"
    );
    assert.match(
      jsxContent,
      /Customer association could not be verified/,
      "Must state that association could not be verified when no association is confirmed"
    );
    assert.match(
      jsxContent,
      /Orders \(LTV\)/,
      "Mobile card must label filtered metrics count as 'Orders (LTV)'"
    );
  });

  test("Backend: adminCustomerController exports read-only payment endpoints with robust validation", async () => {
    const { getAdminCustomerPayments, lookupAdminPaymentReference } = await import(
      "../src/controllers/adminCustomerController.js"
    );

    assert.equal(typeof getAdminCustomerPayments, "function");
    assert.equal(typeof lookupAdminPaymentReference, "function");

    // Test input validation for getAdminCustomerPayments
    const reqInvalid = { params: { id: "invalid" } };
    let resStatus = 0;
    let resJson = null;
    const resMock = {
      status(code) {
        resStatus = code;
        return this;
      },
      json(data) {
        resJson = data;
        return this;
      },
      set() {
        return this;
      },
    };

    await getAdminCustomerPayments(reqInvalid, resMock);
    assert.equal(resStatus, 400, "Should return 400 for invalid customer ID");
    assert.equal(resJson?.success, false);

    // Test input validation for lookupAdminPaymentReference
    const reqNoRef = { query: {} };
    await lookupAdminPaymentReference(reqNoRef, resMock);
    assert.equal(resStatus, 400, "Should return 400 when ref is missing");
  });
  test("Admin Dashboard: Layout suppresses refresh button on /customers", () => {
    const layoutPath = path.resolve(__dirname, "../../admin-dashboard/src/layouts/AdminLayout.jsx");
    const layoutContent = fs.readFileSync(layoutPath, "utf8");

    assert.ok(layoutContent.includes("!location.pathname.startsWith") && layoutContent.includes("/customers"), "AdminLayout must explicitly suppress refresh button on /customers");
    assert.ok(!layoutContent.includes("setPageRefresh(null)"), "AdminLayout must NOT reset pageRefresh on pathname change so child registrations are preserved");
  });
  test("Backend: Stored order verification requires valid WooCommerce response and matching Razorpay IDs", async () => {
    const controllerPath = path.resolve(__dirname, "../src/controllers/adminCustomerController.js");
    const controllerContent = fs.readFileSync(controllerPath, "utf8");

    assert.ok(
      controllerContent.includes("verifyStoredOrderMatchesPayment"),
      "Must define and call verifyStoredOrderMatchesPayment helper"
    );
    assert.ok(
      controllerContent.includes("!verified.valid"),
      "Must handle malformed order responses as unavailable instead of false miss"
    );
    assert.ok(
      controllerContent.includes("verified.status === \"unavailable\""),
      "Must treat unavailable verification status explicitly in order verification branches"
    );
    assert.ok(
      controllerContent.includes("hasOrderConflict") && controllerContent.includes("hasTxnConflict"),
      "Must explicitly detect conflicting order IDs or transaction IDs"
    );
    assert.ok(
      controllerContent.includes("!orderRzpOrderId && !orderTransactionId"),
      "Must treat stored orders with neither reference as unavailable"
    );
    assert.ok(
      controllerContent.includes("verified.matches"),
      "Must verify that order matches Razorpay payment or order ID"
    );
  });
});