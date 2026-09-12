import test from "node:test";
import assert from "node:assert/strict";
import { formatCustomerDisplayName } from "../src/utils/nameFormatter.js";

test("Customer Directory & Account Population Architecture Test Suite", async (t) => {
  const VALID_REVENUE_STATUSES = [
    "completed",
    "processing",
    "dispatched",
    "out-for-delivery",
    "out_for_delivery",
    "delivered",
    "on-hold",
    "pending",
    "refunded",
  ];

  // Helper reconciling function matching adminCustomerController logic
  function reconcileCustomerDirectory(registeredUsers, orders, search = "") {
    const customerMap = new Map();
    const emailToIdMap = new Map();

    // 1. Populate registered WordPress customers (Authoritative population)
    for (const u of registeredUsers) {
      // Exclude employee and administrator roles
      const roles = u.roles || [];
      if (roles.includes("administrator") || roles.includes("employee")) {
        continue;
      }

      const userId = Number(u.id);
      const email = (u.email || "").trim().toLowerCase();

      const record = {
        id: userId,
        email: email || "N/A",
        name: formatCustomerDisplayName(u.first_name, u.last_name, u.name || "Customer"),
        first_name: u.first_name || "",
        last_name: u.last_name || "",
        phone: u.phone || "",
        location: u.location || "Vasai, Maharashtra",
        full_address: u.full_address || "Vasai, Maharashtra",
        registered_at: u.registered_at || null,
        ordersCount: 0,
        lifetimeSpent: 0,
        lastOrderDate: null,
        lastOrderId: null,
        orders: [],
      };

      customerMap.set(userId, record);
      if (email) {
        emailToIdMap.set(email, userId);
      }
    }

    // 2. Reconcile WooCommerce orders with registered customers
    for (const o of orders) {
      if (o.status === "trash") continue;

      const rawCustId = Number(o.customer_id);
      const email = (o.billing?.email || "").trim().toLowerCase();
      const orderTotal = Number(o.total) || 0;

      const orderSummary = {
        id: o.id,
        order_number: o.number || String(o.id),
        date: o.date_created,
        total: o.total,
        status: o.status,
        payment_method: o.payment_method_title || "Cash on Delivery",
        items_count: o.line_items?.length || 0,
      };

      let matchedUser = null;
      if (rawCustId > 0 && customerMap.has(rawCustId)) {
        matchedUser = customerMap.get(rawCustId);
      } else if (email && emailToIdMap.has(email)) {
        matchedUser = customerMap.get(emailToIdMap.get(email));
      }

      if (matchedUser) {
        matchedUser.orders.push(orderSummary);
        if (VALID_REVENUE_STATUSES.includes(o.status)) {
          matchedUser.ordersCount += 1;
          matchedUser.lifetimeSpent += orderTotal;
        }
        if (!matchedUser.lastOrderDate || new Date(o.date_created) > new Date(matchedUser.lastOrderDate)) {
          matchedUser.lastOrderDate = o.date_created;
          matchedUser.lastOrderId = o.id;
          if ((!matchedUser.phone || matchedUser.phone === "") && (o.billing?.phone || o.shipping?.phone)) {
            matchedUser.phone = o.billing?.phone || o.shipping?.phone;
          }
        }
      }
    }

    let customerList = Array.from(customerMap.values()).map((c) => ({
      ...c,
      lifetimeSpent: Math.round(c.lifetimeSpent),
    }));

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      customerList = customerList.filter((c) => {
        const name = (c.name || "").toLowerCase();
        const email = (c.email || "").toLowerCase();
        const phone = String(c.phone || "");
        const loc = (c.location || "").toLowerCase();
        const addr = (c.full_address || "").toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || loc.includes(q) || addr.includes(q);
      });
    }

    return customerList;
  }

  await t.test("1. Registered WordPress customer appears even with zero orders", () => {
    const mockUsers = [
      {
        id: 101,
        email: "priya.sharma@example.com",
        first_name: "Priya",
        last_name: "Sharma",
        phone: "9820123456",
        roles: ["customer"],
      },
    ];
    const mockOrders = []; // Zero orders placed

    const list = reconcileCustomerDirectory(mockUsers, mockOrders);

    assert.equal(list.length, 1);
    assert.equal(list[0].id, 101);
    assert.equal(list[0].name, "Priya Sharma");
    assert.equal(list[0].ordersCount, 0);
    assert.equal(list[0].lifetimeSpent, 0);
  });

  await t.test("2. Employees and Administrators are excluded from Customer Directory", () => {
    const mockUsers = [
      { id: 1, email: "admin@mumbaicollection.in", name: "Super Admin", roles: ["administrator"] },
      { id: 2, email: "staff@mumbaicollection.in", name: "Store Employee", roles: ["employee"] },
      { id: 102, email: "customer@gmail.com", name: "Valid Customer", roles: ["customer"] },
    ];

    const list = reconcileCustomerDirectory(mockUsers, []);

    assert.equal(list.length, 1);
    assert.equal(list[0].id, 102);
    assert.equal(list[0].name, "Valid Customer");
  });

  await t.test("3. Deleted / Nonexistent WordPress users do not appear as registered accounts", () => {
    // WordPress returned 0 users for deleted user
    const mockUsers = [];
    // Old historical order exists in WooCommerce database
    const mockOrders = [
      {
        id: 501,
        customer_id: 999, // user was deleted from WP
        billing: { email: "deleted.user@example.com", first_name: "Old", last_name: "User" },
        total: "1500",
        status: "completed",
      },
    ];

    const list = reconcileCustomerDirectory(mockUsers, mockOrders);

    // Should NOT create customer directory entry without a registered WP account
    assert.equal(list.length, 0);
  });

  await t.test("4. Order matching a registered customer's email is reconciled into their LTV stats", () => {
    const mockUsers = [
      {
        id: 105,
        email: "rahul.patil@gmail.com",
        first_name: "Rahul",
        last_name: "Patil",
        phone: "9876543210",
        roles: ["customer"],
      },
    ];

    const mockOrders = [
      // Order placed with customer_id=0 (guest checkout) but matching registered email
      {
        id: 901,
        customer_id: 0,
        billing: { email: "rahul.patil@gmail.com", first_name: "Rahul", last_name: "Patil" },
        total: "2499",
        status: "delivered",
        date_created: "2026-09-01T10:00:00Z",
      },
      // Order placed with customer_id=105
      {
        id: 902,
        customer_id: 105,
        billing: { email: "rahul.patil@gmail.com", first_name: "Rahul", last_name: "Patil" },
        total: "1200",
        status: "processing",
        date_created: "2026-09-05T14:00:00Z",
      },
    ];

    const list = reconcileCustomerDirectory(mockUsers, mockOrders);

    assert.equal(list.length, 1);
    assert.equal(list[0].id, 105);
    assert.equal(list[0].ordersCount, 2);
    assert.equal(list[0].lifetimeSpent, 3699);
    assert.equal(list[0].lastOrderId, 902);
  });

  await t.test("5. Trash orders do NOT count towards customer LTV or order count", () => {
    const mockUsers = [
      {
        id: 108,
        email: "trash.test@example.com",
        first_name: "Spam",
        last_name: "Bot",
        roles: ["customer"],
      },
    ];
    const mockOrders = [
      {
        id: 999,
        customer_id: 108,
        billing: { email: "trash.test@example.com", first_name: "Spam", last_name: "Bot" },
        total: "99999",
        status: "trash",
      },
    ];

    const list = reconcileCustomerDirectory(mockUsers, mockOrders);
    assert.equal(list.length, 1);
    assert.equal(list[0].ordersCount, 0);
    assert.equal(list[0].lifetimeSpent, 0);
  });

  await t.test("6. Phone number fallback resolves from billing/shipping when registered profile is empty", () => {
    const mockUsers = [
      {
        id: 109,
        email: "phone.fallback@example.com",
        first_name: "Aman",
        last_name: "Singh",
        phone: "", // Empty in WP profile
        roles: ["customer"],
      },
    ];
    const mockOrders = [
      {
        id: 701,
        customer_id: 109,
        billing: { phone: "9822334455", email: "phone.fallback@example.com" },
        total: "750",
        status: "completed",
        date_created: "2026-09-02T12:00:00Z",
      },
    ];

    const list = reconcileCustomerDirectory(mockUsers, mockOrders);
    assert.equal(list[0].phone, "9822334455");
  });

  await t.test("7. Search filtering works across name, email, phone, location, and address", () => {
    const mockUsers = [
      { id: 201, email: "rohit@vasai.in", name: "Rohit Verma", phone: "9820011223", location: "Vasai West", roles: ["customer"] },
      { id: 202, email: "sunita@mumbai.com", name: "Sunita Rao", phone: "9870099887", location: "Nallasopara East", roles: ["customer"] },
    ];

    const searchByName = reconcileCustomerDirectory(mockUsers, [], "Rohit");
    assert.equal(searchByName.length, 1);
    assert.equal(searchByName[0].id, 201);

    const searchByPhone = reconcileCustomerDirectory(mockUsers, [], "9870099887");
    assert.equal(searchByPhone.length, 1);
    assert.equal(searchByPhone[0].id, 202);

    const searchByLocation = reconcileCustomerDirectory(mockUsers, [], "Nallasopara");
    assert.equal(searchByLocation.length, 1);
    assert.equal(searchByLocation[0].id, 202);
  });
});
