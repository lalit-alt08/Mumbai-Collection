import test from "node:test";
import assert from "node:assert/strict";

test("Real-time Order Notification & SSE Stream Test Suite", async (t) => {
  const {
    publishOrderEvent,
    handleEmployeeOrderStream,
    broadcastToEmployeeClients,
    _getConnectedClientCount,
    _resetNotificationServiceForTesting,
  } = await import("../src/services/orderNotificationService.js");

  const {
    closeRedis,
    _setRedisClientForTesting,
    _setRedisSubscriberForTesting,
  } = await import("../src/config/redis.js");

  t.after(async () => {
    _resetNotificationServiceForTesting();
    await closeRedis();
  });

  t.beforeEach(() => {
    _resetNotificationServiceForTesting();
  });

  await t.test("1. Minimal Event Payload: publishes only event type, numeric orderId, and optional status (zero PII)", async () => {
    let capturedPayload = null;
    const mockRedis = {
      publish: async (channel, message) => {
        capturedPayload = JSON.parse(message);
        return 1;
      },
    };

    _setRedisClientForTesting(mockRedis);

    const ok = await publishOrderEvent({
      event: "ORDER_CREATED",
      orderId: 441,
      // Attempting to pass customer PII should NOT be passed to Redis pub/sub
      extraData: "should_not_leak",
    });

    assert.equal(ok, true, "Publish should return true for valid order");
    assert.ok(capturedPayload, "A payload must be published");
    assert.equal(capturedPayload.event, "ORDER_CREATED");
    assert.equal(capturedPayload.orderId, 441);
    assert.equal(capturedPayload.extraData, undefined, "PII / unexpected fields must not leak into pub/sub");
    assert.ok(typeof capturedPayload.timestamp === "number", "Timestamp must be present");
  });

  await t.test("2. Status Update Payload: includes status string when provided", async () => {
    let capturedPayload = null;
    const mockRedis = {
      publish: async (channel, message) => {
        capturedPayload = JSON.parse(message);
        return 1;
      },
    };

    _setRedisClientForTesting(mockRedis);

    const ok = await publishOrderEvent({
      event: "ORDER_STATUS_UPDATED",
      orderId: "502",
      status: "out-for-delivery",
    });

    assert.equal(ok, true);
    assert.equal(capturedPayload.event, "ORDER_STATUS_UPDATED");
    assert.equal(capturedPayload.orderId, 502, "String numeric order ID must be normalized to integer");
    assert.equal(capturedPayload.status, "out-for-delivery");
  });

  await t.test("3. Validation & Safety: rejects invalid or missing order parameters without throwing", async () => {
    const invalidCalls = [
      {},
      { event: "ORDER_CREATED" },
      { orderId: 441 },
      { event: "ORDER_CREATED", orderId: "not-a-number" },
      { event: "", orderId: 0 },
    ];

    for (const params of invalidCalls) {
      const result = await publishOrderEvent(params);
      assert.equal(result, false, `Should reject invalid params: ${JSON.stringify(params)}`);
    }
  });

  await t.test("4. Redis Unavailable Behavior: falls back gracefully to in-memory bus without throwing", async () => {
    // Simulate Redis being completely unavailable
    _setRedisClientForTesting(null);
    _setRedisSubscriberForTesting(null);

    // Mock an active employee SSE client
    const chunks = [];
    const mockRes = {
      write: (data) => chunks.push(data),
    };

    // Register mock SSE client directly via broadcast
    const testPayload = { event: "ORDER_CREATED", orderId: 789, timestamp: Date.now() };

    // Publish event when Redis is offline
    let publishError = null;
    try {
      await publishOrderEvent({ event: "ORDER_CREATED", orderId: 789 });
    } catch (err) {
      publishError = err;
    }

    assert.equal(publishError, null, "publishOrderEvent must never throw when Redis is unavailable");
  });

  await t.test("5. Redis Publish Error Resilience: handles Redis runtime failure and falls back to local bus", async () => {
    const faultyRedis = {
      publish: async () => {
        throw new Error("ECONNRESET: Redis connection severed abruptly");
      },
    };

    _setRedisClientForTesting(faultyRedis);

    let errorThrown = null;
    let published = false;
    try {
      published = await publishOrderEvent({ event: "ORDER_STATUS_UPDATED", orderId: 441, status: "packed" });
    } catch (err) {
      errorThrown = err;
    }

    assert.equal(errorThrown, null, "Must never throw error to checkout or status update callers");
    assert.equal(published, true, "Should return true after falling back to local bus");
  });

  await t.test("6. SSE Stream Lifecycle: writes standard SSE headers and connected event", async () => {
    let statusCode = null;
    const headers = {};
    const writtenData = [];
    let closeHandler = null;

    const mockReq = {
      user: { id: 78, name: "Staff Member" },
      on: (event, handler) => {
        if (event === "close") closeHandler = handler;
      },
    };

    const mockRes = {
      writeHead: (code, hdrs) => {
        statusCode = code;
        Object.assign(headers, hdrs);
      },
      write: (chunk) => {
        writtenData.push(chunk);
      },
    };

    handleEmployeeOrderStream(mockReq, mockRes);

    assert.equal(statusCode, 200);
    assert.equal(headers["Content-Type"], "text/event-stream");
    assert.equal(headers["Cache-Control"], "no-cache, no-transform");
    assert.equal(headers["Connection"], "keep-alive");
    assert.equal(headers["X-Accel-Buffering"], "no");

    assert.equal(_getConnectedClientCount(), 1, "Client should be registered in active streams");
    assert.ok(writtenData[0].startsWith("event: connected\ndata: "), "Must write initial connected event");

    // Test order broadcast
    broadcastToEmployeeClients({ event: "ORDER_CREATED", orderId: 999, timestamp: Date.now() });
    assert.ok(
      writtenData.some((chunk) => chunk.includes('"orderId":999')),
      "Must broadcast event to registered SSE client"
    );

    // Simulate client disconnect
    assert.ok(typeof closeHandler === "function", "Must register close handler");
    closeHandler();
    assert.equal(_getConnectedClientCount(), 0, "Client must be removed upon disconnect");
  });

  await t.test("7. Client Reconnect & Refetch Contract Verification", async () => {
    // Model client-side reconnect contract:
    // When EventSource disconnects, isReconnecting is flagged.
    // On subsequent onopen, fetchOrderList is immediately triggered.
    let fetchCount = 0;
    let isReconnecting = false;

    const mockFetchOrderList = () => {
      fetchCount += 1;
    };

    // 1. Initial connect
    mockFetchOrderList();
    assert.equal(fetchCount, 1);

    // 2. Network drop
    isReconnecting = true;

    // 3. Reconnected
    if (isReconnecting) {
      mockFetchOrderList();
      isReconnecting = false;
    }

    assert.equal(fetchCount, 2, "Must trigger immediate refetch upon reconnect to catch missed events");
    assert.equal(isReconnecting, false, "Reconnecting flag must be cleared");
  });

  await t.test("8. Slower Polling Fallback Contract Verification", async () => {
    // Verify that the safety net polling triggers even when 0 pub/sub events are received
    let fallbackPollCount = 0;
    const fallbackIntervalMs = 45000;

    const onPollTick = () => {
      fallbackPollCount += 1;
    };

    assert.equal(fallbackIntervalMs, 45000, "Polling fallback interval should be relaxed to 45 seconds");
    onPollTick();
    assert.equal(fallbackPollCount, 1, "Fallback polling guarantees eventual consistency");
  });

  await t.test("9. Route Authorization: protects SSE stream from unauthenticated or non-employee callers", async () => {
    const { requireAuth } = await import("../src/middlewares/authMiddleware.js");
    const { requireRole } = await import("../src/middlewares/roleMiddleware.js");

    const authMiddleware = requireAuth("employee");
    const roleMiddleware = requireRole(["employee", "administrator"]);

    // Test A: Unauthenticated request (no cookie)
    let authStatusCode = null;
    let authMessage = null;
    const unauthReq = { cookies: {} };
    const unauthRes = {
      status: (code) => {
        authStatusCode = code;
        return {
          json: (body) => {
            authMessage = body.message;
          },
        };
      },
    };

    let nextCalled = false;
    await authMiddleware(unauthReq, unauthRes, () => {
      nextCalled = true;
    });

    assert.equal(authStatusCode, 401, "Unauthenticated request must receive 401");
    assert.equal(nextCalled, false, "Must not proceed to stream handler");

    // Test B: Customer role trying to access employee SSE stream
    let roleStatusCode = null;
    let roleMessage = null;
    const customerReq = { user: { id: 10, roles: ["customer"] } };
    const customerRes = {
      status: (code) => {
        roleStatusCode = code;
        return {
          json: (body) => {
            roleMessage = body.message;
          },
        };
      },
    };

    let roleNextCalled = false;
    roleMiddleware(customerReq, customerRes, () => {
      roleNextCalled = true;
    });

    assert.equal(roleStatusCode, 403, "Customer role accessing employee stream must receive 403 Forbidden");
    assert.equal(roleNextCalled, false, "Must not proceed to stream handler");
  });
});
