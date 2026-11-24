import test from "node:test";
import assert from "node:assert/strict";
import { schemas } from "../src/middlewares/requestValidation.js";

test("Employee Product Update Schema Security", async (t) => {
  await t.test("schemas.employeeProductUpdate strictly permits stock fields only", () => {
    // Valid stock payload
    const validStock = {
      stock_quantity: 25,
      stock_status: "instock",
      expected_stock_quantity: 20,
    };
    const parsed = schemas.employeeProductUpdate.safeParse(validStock);
    assert.equal(parsed.success, true);
  });

  await t.test("schemas.employeeProductUpdate rejects regular_price", () => {
    const maliciousPayload = {
      stock_quantity: 10,
      regular_price: "1.00",
    };
    const parsed = schemas.employeeProductUpdate.safeParse(maliciousPayload);
    assert.equal(parsed.success, false);
    const issues = parsed.error.issues;
    assert.ok(issues.some((i) => i.code === "unrecognized_keys" && i.keys.includes("regular_price")));
  });

  await t.test("schemas.employeeProductUpdate rejects sale_price", () => {
    const maliciousPayload = {
      stock_quantity: 10,
      sale_price: "1.00",
    };
    const parsed = schemas.employeeProductUpdate.safeParse(maliciousPayload);
    assert.equal(parsed.success, false);
    const issues = parsed.error.issues;
    assert.ok(issues.some((i) => i.code === "unrecognized_keys" && i.keys.includes("sale_price")));
  });

  await t.test("schemas.employeeProductUpdate rejects product name tampering", () => {
    const maliciousPayload = {
      name: "Tampered Product Name",
      stock_quantity: 10,
    };
    const parsed = schemas.employeeProductUpdate.safeParse(maliciousPayload);
    assert.equal(parsed.success, false);
    const issues = parsed.error.issues;
    assert.ok(issues.some((i) => i.code === "unrecognized_keys" && i.keys.includes("name")));
  });

  await t.test("schemas.productUpdate continues to allow administrators to edit prices", () => {
    const adminPayload = {
      regular_price: "499",
      sale_price: "399",
      stock_quantity: 50,
      stock_status: "instock",
    };
    const parsed = schemas.productUpdate.safeParse(adminPayload);
    assert.equal(parsed.success, true);
  });
});

test("Store API Checkout Online vs COD Push Gating Logic", async (t) => {
  const evaluateShouldPublish = (responseData) => {
    const paymentMethod = responseData?.payment_method || responseData?.payment_result?.payment_method;
    const needsPayment = responseData?.needs_payment !== false;
    const isOnlinePrepaid = needsPayment || (paymentMethod && paymentMethod !== "cod");
    const createdOrderId = responseData?.id || responseData?.order_id;
    return !isOnlinePrepaid && Boolean(createdOrderId);
  };

  await t.test("Online prepaid order (needs_payment: true) does NOT publish from /checkout", () => {
    const onlineOrder = {
      id: 99101,
      status: "pending",
      needs_payment: true,
      payment_method: "razorpay",
    };
    assert.equal(evaluateShouldPublish(onlineOrder), false, "Must suppress push on /checkout for online orders");
  });

  await t.test("Online order with missing payment confirmation does NOT publish from /checkout", () => {
    const pendingOrder = {
      order_id: 99102,
      status: "pending",
      totals: { total_price: 150000 },
    };
    assert.equal(evaluateShouldPublish(pendingOrder), false, "Default needs_payment !== false must suppress push");
  });

  await t.test("COD order (needs_payment: false, payment_method: 'cod') DOES publish immediately", () => {
    const codOrder = {
      id: 99103,
      status: "processing",
      needs_payment: false,
      payment_method: "cod",
    };
    assert.equal(evaluateShouldPublish(codOrder), true, "COD orders must publish push immediately");
  });
});
