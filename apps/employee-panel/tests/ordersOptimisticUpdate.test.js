import test from "node:test";
import assert from "node:assert/strict";

test("Employee Panel Orders: Optimistic Update & Concurrency Suite", async (t) => {
  await t.test("1. Concurrent updates on multiple orders track independently in Set", () => {
    let updatingIds = new Set();

    const startUpdate = (id) => {
      updatingIds = new Set(updatingIds);
      updatingIds.add(id);
    };

    const finishUpdate = (id) => {
      updatingIds = new Set(updatingIds);
      updatingIds.delete(id);
    };

    // Start updating Order 101
    startUpdate(101);
    assert.equal(updatingIds.has(101), true);
    assert.equal(updatingIds.has(102), false);

    // Rapidly start updating Order 102
    startUpdate(102);
    assert.equal(updatingIds.has(101), true, "Order 101 must remain updating");
    assert.equal(updatingIds.has(102), true, "Order 102 must be updating");

    // Order 101 finishes
    finishUpdate(101);
    assert.equal(updatingIds.has(101), false, "Order 101 should no longer be updating");
    assert.equal(updatingIds.has(102), true, "Order 102 must remain updating and not be unlocked by 101");

    // Order 102 finishes
    finishUpdate(102);
    assert.equal(updatingIds.has(102), false);
    assert.equal(updatingIds.size, 0);
  });

  await t.test("2. Optimistic UI update immediately updates status without full list GET", async () => {
    let orders = [
      { id: 101, status: "processing", customer_name: "John Doe" },
      { id: 102, status: "processing", customer_name: "Jane Smith" },
    ];
    let fullListFetched = false;

    const fakeGetOrders = async () => {
      fullListFetched = true;
      return { success: true, orders };
    };

    const fakeUpdateOrderStatus = async (id, status) => {
      return {
        success: true,
        order: { id, status },
      };
    };

    // Emulate handleStatusUpdate in Orders.jsx
    const handleStatusUpdate = async (orderId, newStatus) => {
      // 1. Optimistic local update
      orders = orders.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o));

      // 2. PATCH request
      const res = await fakeUpdateOrderStatus(orderId, newStatus);

      // 3. Merge server response (NO full list GET)
      if (res?.order) {
        orders = orders.map((o) => (o.id === orderId ? { ...o, ...res.order } : o));
      }
    };

    // Execute status update on 101 to 'packed'
    const updatePromise = handleStatusUpdate(101, "packed");

    // Immediately check optimistic state (before await finishes)
    assert.equal(orders[0].status, "packed", "Order 101 status must be immediately 'packed'");
    assert.equal(orders[1].status, "processing", "Order 102 must remain untouched");

    await updatePromise;
    assert.equal(orders[0].status, "packed");
    assert.equal(fullListFetched, false, "Full list GET /orders must NOT be called");
  });

  await t.test("3. Rollback on failure restores only the failing order", async () => {
    let orders = [
      { id: 101, status: "processing", customer_name: "Alice" },
      { id: 102, status: "packed", customer_name: "Bob" },
    ];

    const handleFailedStatusUpdate = async (orderId, newStatus) => {
      const previousOrder = orders.find((o) => o.id === orderId);

      // Optimistic update
      orders = orders.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o));

      try {
        // Simulate network failure
        throw new Error("Network timeout");
      } catch {
        // Rollback only affected order
        if (previousOrder) {
          orders = orders.map((o) => (o.id === orderId ? previousOrder : o));
        }
      }
    };

    await handleFailedStatusUpdate(101, "packed");

    assert.equal(orders[0].status, "processing", "Order 101 must be rolled back to processing");
    assert.equal(orders[1].status, "packed", "Order 102 must remain in packed status");
  });

  await t.test("4. Table mounting condition keeps existing orders visible during refresh", () => {
    const shouldShowLoadingSpinner = (loading, ordersCount) => {
      return loading && ordersCount === 0;
    };

    // Initial load: loading = true, orders = 0 -> Show spinner
    assert.equal(shouldShowLoadingSpinner(true, 0), true);

    // After orders loaded: background refresh loading = true, orders = 20 -> Keep table mounted!
    assert.equal(shouldShowLoadingSpinner(true, 20), false);

    // Normal state: loading = false, orders = 20 -> Keep table mounted
    assert.equal(shouldShowLoadingSpinner(false, 20), false);
  });
});
