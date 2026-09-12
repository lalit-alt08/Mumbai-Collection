import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getProductReviews,
  createOrUpdateReview,
  deleteReview,
} from "../src/controllers/reviewController.js";
import api from "../src/config/woocommerce.js";

// Mock helper for Express req/res
const createMockContext = ({
  body = {},
  params = {},
  query = {},
  headers = {},
  cookies = {},
  user = { id: 101 },
  wpUserId = 101,
  wpAuthCookie = "wordpress_logged_in_test=123",
} = {}) => {
  let statusCode = 200;
  let responseData = null;

  const req = {
    body,
    params,
    query,
    headers,
    cookies,
    user,
    wpUserId,
    wpAuthCookie,
    ip: "127.0.0.1",
  };

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    getStatus: () => statusCode,
    getData: () => responseData,
  };

  return { req, res };
};

describe("Product Reviews & Ratings Suite", () => {
  let originalGet;
  let originalPost;
  let originalPut;
  let originalDelete;

  beforeEach(() => {
    originalGet = api.get;
    originalPost = api.post;
    originalPut = api.put;
    originalDelete = api.delete;
  });

  afterEach(() => {
    api.get = originalGet;
    api.post = originalPost;
    api.put = originalPut;
    api.delete = originalDelete;
  });

  // -------------------------------------------------------------
  // 1. Rating Boundary & Validation Tests
  // -------------------------------------------------------------

  test("1. Rating Validation: rating 1 is accepted", async () => {
    api.get = async (url) => {
      if (url === "orders") return { data: [] };
      if (url === "products/reviews") return { data: [] };
      return { data: [] };
    };
    api.post = async (url, data) => ({
      data: { id: 99, product_id: 123, rating: data.rating, reviewer: "Customer", date_created: new Date().toISOString() },
    });

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 1, review: "Adequate product" },
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getData()?.success, true);
    assert.equal(res.getData()?.review?.rating, 1);
  });

  test("2. Rating Validation: rating 5 is accepted", async () => {
    api.get = async (url) => {
      if (url === "orders") return { data: [] };
      if (url === "products/reviews") return { data: [] };
      return { data: [] };
    };
    api.post = async (url, data) => ({
      data: { id: 100, product_id: 123, rating: data.rating, reviewer: "Customer", date_created: new Date().toISOString() },
    });

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Supercool product" },
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getData()?.success, true);
    assert.equal(res.getData()?.review?.rating, 5);
  });

  test("3. Rating Validation: rating 0 is rejected with HTTP 400", async () => {
    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 0, review: "Zero rating" },
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /Rating must be a whole number between 1 and 5/);
  });

  test("4. Rating Validation: rating 6 is rejected with HTTP 400", async () => {
    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 6, review: "Too high" },
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /Rating must be a whole number between 1 and 5/);
  });

  test("5. Rating Validation: non-integer ratings (e.g. 4.5, strings, null) are rejected", async () => {
    const invalidRatings = [4.5, 3.2, "five", null, undefined, -1, NaN];

    for (const invalidRating of invalidRatings) {
      const { req, res } = createMockContext({
        params: { productId: "123" },
        body: { rating: invalidRating, review: "Invalid rating value" },
      });

      await createOrUpdateReview(req, res);
      assert.equal(res.getStatus(), 400, `Rating "${invalidRating}" should be rejected with 400`);
      assert.equal(res.getData()?.success, false);
    }
  });

  test("6. Review Text Validation: empty or whitespace review text is rejected", async () => {
    const invalidTexts = ["", "   ", "\n\t  ", null, undefined];

    for (const text of invalidTexts) {
      const { req, res } = createMockContext({
        params: { productId: "123" },
        body: { rating: 5, review: text },
      });

      await createOrUpdateReview(req, res);
      assert.equal(res.getStatus(), 400);
      assert.equal(res.getData()?.success, false);
      assert.match(res.getData()?.message, /Please write a review comment/);
    }
  });

  test("7. Review Text Validation: review over 2000 characters is rejected", async () => {
    const longText = "a".repeat(2001);
    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: longText },
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 400);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /cannot exceed 2000 characters/);
  });

  // -------------------------------------------------------------
  // 2. Rating Calculation & Distribution Mathematics
  // -------------------------------------------------------------

  test("8. Rating Calculation: Zero-review state returns avg 0, total 0, and all zero distributions", async () => {
    api.get = async () => ({ data: [] });

    const { req, res } = createMockContext({ params: { productId: "123" } });
    await getProductReviews(req, res);

    assert.equal(res.getStatus(), 200);
    const data = res.getData();
    assert.equal(data.success, true);
    assert.equal(data.averageRating, 0);
    assert.equal(data.totalReviews, 0);
    assert.deepEqual(data.ratingDistribution, { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
    assert.deepEqual(data.reviews, []);
  });

  test("9. Rating Calculation: 1-review 5-star distribution produces avg 5.0 and exact count 1", async () => {
    api.get = async () => ({
      data: [
        {
          id: 1,
          product_id: 123,
          rating: 5,
          reviewer: "Sirvi",
          reviewer_email: "sirvi@example.com",
          review: "supercool",
          verified: true,
          date_created: "2026-09-03T10:00:00",
        },
      ],
    });

    const { req, res } = createMockContext({ params: { productId: "123" } });
    await getProductReviews(req, res);

    assert.equal(res.getStatus(), 200);
    const data = res.getData();
    assert.equal(data.averageRating, 5.0);
    assert.equal(data.totalReviews, 1);
    assert.deepEqual(data.ratingDistribution, { 5: 1, 4: 0, 3: 0, 2: 0, 1: 0 });
    assert.equal(data.reviews[0].review, "supercool");
    assert.equal(data.reviews[0].verified, true);
  });

  test("10. Rating Calculation: Mixed-rating distribution correctly calculates mathematical average", async () => {
    // 3 reviews: 5?, 4?, 4? => (5 + 4 + 4) / 3 = 13 / 3 = 4.3333... => 4.3
    api.get = async () => ({
      data: [
        { id: 1, product_id: 123, rating: 5, review: "Great", date_created: "2026-09-01" },
        { id: 2, product_id: 123, rating: 4, review: "Good", date_created: "2026-09-02" },
        { id: 3, product_id: 123, rating: 4, review: "Nice", date_created: "2026-09-03" },
      ],
    });

    const { req, res } = createMockContext({ params: { productId: "123" } });
    await getProductReviews(req, res);

    assert.equal(res.getStatus(), 200);
    const data = res.getData();
    assert.equal(data.averageRating, 4.3);
    assert.equal(data.totalReviews, 3);
    assert.deepEqual(data.ratingDistribution, { 5: 1, 4: 2, 3: 0, 2: 0, 1: 0 });
  });

  // -------------------------------------------------------------
  // 3. Verified Buyer Logic & Order Status Filters
  // -------------------------------------------------------------

  test("11. Verified Buyer: Cancelled order does NOT produce Verified Buyer", async () => {
    let capturedVerified = null;

    api.get = async (url) => {
      if (url === "orders") {
        return {
          data: [
            {
              id: 501,
              status: "cancelled",
              line_items: [{ product_id: 123, name: "Sample Item" }],
            },
          ],
        };
      }
      if (url === "products/reviews") return { data: [] };
      return { data: [] };
    };

    api.post = async (url, payload) => {
      capturedVerified = payload.verified;
      return {
        data: { id: 10, product_id: 123, rating: payload.rating, verified: payload.verified },
      };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Test cancelled order" },
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(capturedVerified, false, "Cancelled order must not grant verified buyer status");
    assert.equal(res.getData()?.review?.verified, false);
  });

  test("12. Verified Buyer: Failed order does NOT produce Verified Buyer", async () => {
    let capturedVerified = null;

    api.get = async (url) => {
      if (url === "orders") {
        return {
          data: [
            {
              id: 502,
              status: "failed",
              line_items: [{ product_id: 123, name: "Sample Item" }],
            },
          ],
        };
      }
      if (url === "products/reviews") return { data: [] };
      return { data: [] };
    };

    api.post = async (url, payload) => {
      capturedVerified = payload.verified;
      return {
        data: { id: 11, product_id: 123, rating: payload.rating, verified: payload.verified },
      };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Test failed order" },
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(capturedVerified, false, "Failed order must not grant verified buyer status");
    assert.equal(res.getData()?.review?.verified, false);
  });

  test("13. Verified Buyer: Refunded order does NOT produce Verified Buyer", async () => {
    let capturedVerified = null;

    api.get = async (url) => {
      if (url === "orders") {
        return {
          data: [
            {
              id: 503,
              status: "refunded",
              line_items: [{ product_id: 123, name: "Sample Item" }],
            },
          ],
        };
      }
      if (url === "products/reviews") return { data: [] };
      return { data: [] };
    };

    api.post = async (url, payload) => {
      capturedVerified = payload.verified;
      return {
        data: { id: 12, product_id: 123, rating: payload.rating, verified: payload.verified },
      };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Test refunded order" },
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(capturedVerified, false, "Refunded order must not grant verified buyer status");
    assert.equal(res.getData()?.review?.verified, false);
  });

  test("14. Verified Buyer: Valid completed / processing order DOES produce Verified Buyer", async () => {
    const validStatuses = ["completed", "processing", "out-for-delivery", "dispatched", "on-hold", "pending"];

    for (const validStatus of validStatuses) {
      let capturedVerified = null;

      api.get = async (url) => {
        if (url === "orders") {
          return {
            data: [
              {
                id: 600,
                status: validStatus,
                line_items: [{ product_id: 123, name: "Sample Item" }],
              },
            ],
          };
        }
        if (url === "products/reviews") return { data: [] };
        return { data: [] };
      };

      api.post = async (url, payload) => {
        capturedVerified = payload.verified;
        return {
          data: { id: 15, product_id: 123, rating: payload.rating, verified: payload.verified },
        };
      };

      const { req, res } = createMockContext({
        params: { productId: "123" },
        body: { rating: 5, review: `Test with valid status ${validStatus}` },
      });

      await createOrUpdateReview(req, res);
      assert.equal(res.getStatus(), 200);
      assert.equal(capturedVerified, true, `Status "${validStatus}" must grant verified buyer status`);
      assert.equal(res.getData()?.review?.verified, true);
    }
  });

  // -------------------------------------------------------------
  // 4. Review Ownership & Deletion Authorization
  // -------------------------------------------------------------

  test("15. Security & RBAC: Customer cannot delete another customer's review (Returns HTTP 403)", async () => {
    api.get = async (url) => {
      if (url === "products/reviews/999") {
        return {
          data: {
            id: 999,
            product_id: 123,
            reviewer_email: "another_customer@example.com",
            review: "Someone else's review",
          },
        };
      }
      return { data: null };
    };

    const { req, res } = createMockContext({
      params: { reviewId: "999" },
      user: { id: 101, email: "my_email@example.com" },
      wpUserId: 101,
      wpUserEmail: "my_email@example.com",
    });

    await deleteReview(req, res);
    assert.equal(res.getStatus(), 403);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /You can only delete your own reviews/);
  });

  // -------------------------------------------------------------
  // 5. isOwner Flag & Public Email Privacy
  // -------------------------------------------------------------

  test("16. Review Ownership: isOwner=true for current customer's review, false for others, and reviewer_email never returned", async () => {
    api.get = async (url) => {
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 1,
              product_id: 123,
              rating: 5,
              reviewer: "Myself",
              reviewer_email: "my_customer@example.com",
              review: "My own review",
              verified: true,
              date_created: "2026-09-10T10:00:00",
            },
            {
              id: 2,
              product_id: 123,
              rating: 4,
              reviewer: "Other Shopper",
              reviewer_email: "other_customer@example.com",
              review: "Another review",
              verified: false,
              date_created: "2026-09-11T10:00:00",
            },
          ],
        };
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      user: { id: 101, email: "my_customer@example.com" },
      wpUserId: 101,
      wpUserEmail: "my_customer@example.com",
    });

    await getProductReviews(req, res);
    assert.equal(res.getStatus(), 200);

    const data = res.getData();
    assert.equal(data.success, true);
    assert.equal(data.reviews.length, 2);

    // Review 1 is owned by current customer
    assert.equal(data.reviews[0].isOwner, true);
    assert.equal(data.reviews[0].reviewerEmail, undefined, "reviewerEmail must NEVER be returned publicly");
    assert.equal(data.reviews[0].reviewer_email, undefined, "reviewer_email must NEVER be returned publicly");

    // Review 2 is NOT owned by current customer
    assert.equal(data.reviews[1].isOwner, false);
    assert.equal(data.reviews[1].reviewerEmail, undefined, "reviewerEmail must NEVER be returned publicly");
    assert.equal(data.reviews[1].reviewer_email, undefined, "reviewer_email must NEVER be returned publicly");
  });

  test("17. Review Ownership: Unauthenticated customer gets isOwner=false for all reviews", async () => {
    api.get = async (url) => {
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 1,
              product_id: 123,
              rating: 5,
              reviewer: "Anyone",
              reviewer_email: "anyone@example.com",
              review: "Public review",
              verified: true,
              date_created: "2026-09-10T10:00:00",
            },
          ],
        };
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      user: null,
      wpUserId: null,
      wpAuthCookie: null,
    });

    await getProductReviews(req, res);
    assert.equal(res.getStatus(), 200);

    const data = res.getData();
    assert.equal(data.reviews[0].isOwner, false);
    assert.equal(data.reviews[0].reviewerEmail, undefined);
  });

  test("18. Customer Suspension Guard: Suspended customer cannot create or update a review (HTTP 403)", async () => {
    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Trying to post while suspended" },
      user: { id: 101, email: "suspended@example.com", is_suspended: true },
      wpUserId: 101,
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 403);
    assert.equal(res.getData()?.success, false);
    assert.equal(res.getData()?.code, "CUSTOMER_SUSPENDED");
    assert.match(res.getData()?.message, /Your account is currently suspended/);
  });

  test("19. Customer Suspension Guard: Suspended customer CAN still read public reviews", async () => {
    api.get = async (url) => {
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 1,
              product_id: 123,
              rating: 5,
              reviewer: "Normal Customer",
              reviewer_email: "normal@example.com",
              review: "Public review",
              verified: true,
              date_created: "2026-09-10T10:00:00",
            },
          ],
        };
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      user: { id: 101, email: "suspended@example.com", is_suspended: true },
      wpUserId: 101,
    });

    await getProductReviews(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getData()?.success, true);
    assert.equal(res.getData()?.reviews?.length, 1);
  });

  test("20. Review Update Flow: Active customer editing existing review calls PUT and returns isOwner=true", async () => {
    let putCalled = false;
    let putData = null;

    api.get = async (url) => {
      if (url === "orders") return { data: [{ status: "completed", line_items: [{ product_id: 123 }] }] };
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 888,
              product_id: 123,
              reviewer_email: "active_user@example.com",
              rating: 4,
              review: "Old review",
            },
          ],
        };
      }
      return { data: [] };
    };

    api.put = async (url, data) => {
      putCalled = true;
      putData = data;
      return {
        data: {
          id: 888,
          product_id: 123,
          rating: data.rating,
          reviewer: "Active User",
          date_created: "2026-09-10T10:00:00",
        },
      };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Updated review text" },
      user: { id: 101, name: "Active User", email: "active_user@example.com" },
      wpUserId: 101,
      wpUserEmail: "active_user@example.com",
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(putCalled, true);
    assert.equal(putData.rating, 5);
    assert.equal(putData.review, "Updated review text");
    assert.equal(res.getData()?.review?.isOwner, true);
    assert.match(res.getData()?.message, /Your review has been updated/);
  });

  test("21. Review Delete Flow: Active customer deleting own review succeeds", async () => {
    let deleteCalled = false;

    api.get = async (url) => {
      if (url === "products/reviews/888") {
        return {
          data: {
            id: 888,
            product_id: 123,
            reviewer_email: "active_user@example.com",
            review: "To be deleted",
          },
        };
      }
      return { data: null };
    };

    api.delete = async (url, options) => {
      if (url === "products/reviews/888" && options?.force) {
        deleteCalled = true;
        return { data: { deleted: true } };
      }
      return { data: {} };
    };

    const { req, res } = createMockContext({
      params: { reviewId: "888" },
      user: { id: 101, email: "active_user@example.com" },
      wpUserId: 101,
      wpUserEmail: "active_user@example.com",
    });

    await deleteReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(deleteCalled, true);
    assert.equal(res.getData()?.success, true);
    assert.match(res.getData()?.message, /Review deleted successfully/);
  });

  // -------------------------------------------------------------
  // 6. Reviewer Display Name Resolution & Privacy
  // -------------------------------------------------------------

  test("22. Reviewer Name: Returns reviewer customer name when valid name exists", async () => {
    api.get = async (url) => {
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 1,
              product_id: 123,
              rating: 5,
              reviewer: "Rahul Sharma",
              reviewer_email: "rahul@example.com",
              review: "Fits great!",
              verified: true,
              date_created: "2026-09-10T10:00:00",
            },
            {
              id: 2,
              product_id: 123,
              rating: 4,
              reviewer: "Pooja Patel",
              reviewer_email: "pooja@example.com",
              review: "Loved the quality",
              verified: false,
              date_created: "2026-09-11T10:00:00",
            },
          ],
        };
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
    });

    await getProductReviews(req, res);
    assert.equal(res.getStatus(), 200);

    const data = res.getData();
    assert.equal(data.reviews[0].reviewer, "Rahul Sharma");
    assert.equal(data.reviews[1].reviewer, "Pooja Patel");
  });

  test("23. Reviewer Name: Falls back to 'Customer' if reviewer name is blank, email address, phone, or generic placeholder", async () => {
    api.get = async (url) => {
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 1,
              product_id: 123,
              rating: 5,
              reviewer: "",
              reviewer_email: "test1@example.com",
              review: "Blank reviewer",
            },
            {
              id: 2,
              product_id: 123,
              rating: 4,
              reviewer: "test2@example.com", // Leaked email string in raw review
              reviewer_email: "test2@example.com",
              review: "Email reviewer",
            },
            {
              id: 3,
              product_id: 123,
              rating: 5,
              reviewer: "+919820123456", // Leaked phone string in raw review
              reviewer_email: "test3@example.com",
              review: "Phone reviewer",
            },
            {
              id: 4,
              product_id: 123,
              rating: 4,
              reviewer: "mumbaicollection", // Store name placeholder
              reviewer_email: "test4@example.com",
              review: "Store placeholder reviewer",
            },
            {
              id: 5,
              product_id: 123,
              rating: 5,
              reviewer: "Verified Customer",
              reviewer_email: "test5@example.com",
              review: "Generic verified customer placeholder",
            },
          ],
        };
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
    });

    await getProductReviews(req, res);
    assert.equal(res.getStatus(), 200);

    const data = res.getData();
    assert.equal(data.reviews[0].reviewer, "Customer");
    assert.equal(data.reviews[1].reviewer, "Customer", "Must not leak email as reviewer name");
    assert.equal(data.reviews[2].reviewer, "Customer", "Must not leak phone as reviewer name");
    assert.equal(data.reviews[3].reviewer, "Customer", "Must not show store name as reviewer name");
    assert.equal(data.reviews[4].reviewer, "Customer", "Must normalize generic Verified Customer to Customer");
  });
});
