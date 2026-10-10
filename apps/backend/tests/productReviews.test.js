import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import axios from "axios";
import {
  getProductReviews,
  createOrUpdateReview,
  deleteReview,
} from "../src/controllers/reviewController.js";
import api from "../src/config/woocommerce.js";
import { serverCache } from "../src/utils/memoryCache.js";
import reviewRoutes from "../src/routes/reviewRoutes.js";
import { requireAuth } from "../src/middlewares/authMiddleware.js";

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
  const headersSet = {};

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
    set(header, value) {
      headersSet[header.toLowerCase()] = value;
      return res;
    },
    getStatus: () => statusCode,
    getData: () => responseData,
    getHeader: (header) => headersSet[header.toLowerCase()],
  };

  return { req, res };
};

describe("Product Reviews & Ratings Suite", () => {
  let originalGet;
  let originalPost;
  let originalPut;
  let originalDelete;

  beforeEach(() => {
    serverCache.clear();
    originalGet = api.get;
    originalPost = api.post;
    originalPut = api.put;
    originalDelete = api.delete;
  });

  afterEach(() => {
    serverCache.clear();
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
  // 3. Review Submission Rules & Duplicate Prevention (1 Review / User)
  // -------------------------------------------------------------

  test("11. Review Creation: Any authenticated customer can submit a review without purchase requirement", async () => {
    let postCalled = false;
    let postData = null;

    api.get = async (url) => {
      if (url === "products/reviews") return { data: [] };
      return { data: [] };
    };

    api.post = async (url, data) => {
      postCalled = true;
      postData = data;
      return {
        data: {
          id: 777,
          product_id: 123,
          rating: data.rating,
          reviewer: data.reviewer,
          verified: false,
          date_created: new Date().toISOString(),
        },
      };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Great shirt!" },
      user: { id: 101, name: "Rahul", email: "rahul@example.com" },
      wpUserId: 101,
      wpUserEmail: "rahul@example.com",
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(postCalled, true);
    assert.equal(postData.rating, 5);
    assert.equal(postData.review, "Great shirt!");
    assert.equal(res.getData()?.success, true);
    assert.equal(res.getData()?.review?.isOwner, true);
  });

  test("12. Review Creation: Unauthenticated request is rejected with HTTP 401", async () => {
    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Nice quality" },
      user: null,
      wpUserId: null,
      wpAuthCookie: null,
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 401);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /Please sign in to submit a review/);
  });

  test("13. Review Creation: Duplicate review by same customer is blocked with HTTP 409 (ALREADY_REVIEWED)", async () => {
    api.get = async (url) => {
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 555,
              product_id: 123,
              reviewer_email: "rahul@example.com",
              rating: 5,
              review: "Already reviewed",
            },
          ],
        };
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 4, review: "Trying to submit second review" },
      user: { id: 101, name: "Rahul", email: "rahul@example.com" },
      wpUserId: 101,
      wpUserEmail: "rahul@example.com",
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 409);
    assert.equal(res.getData()?.code, "ALREADY_REVIEWED");
    assert.match(res.getData()?.message, /already reviewed this product/);
  });

  test("14. Review Creation: Targeted cache invalidation clears product cache and preserves catalog:products:all", async () => {
    serverCache.set("reviews:product:123", { cached: true });
    serverCache.set("catalog:product:123", { cached: true });
    serverCache.set("catalog:products:all", { cached: true });

    api.get = async (url) => {
      if (url === "products/reviews") return { data: [] };
      return { data: [] };
    };

    api.post = async (url, data) => ({
      data: { id: 1234, product_id: 123, rating: data.rating, date_created: new Date().toISOString() },
    });

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Targeted invalidation test" },
      user: { id: 101, name: "Rahul", email: "rahul@example.com" },
      wpUserId: 101,
      wpUserEmail: "rahul@example.com",
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);

    // Specific product review and product card caches are purged
    assert.equal(serverCache.get("reviews:product:123"), null);
    assert.equal(serverCache.get("catalog:product:123"), null);

    // Site-wide catalog cache is PRESERVED (no cache stampede under review traffic)
    assert.ok(serverCache.get("catalog:products:all") !== null);
  });

  // -------------------------------------------------------------
  // 4. Review Ownership & Deletion Authorization
  // -------------------------------------------------------------

  test("15. Security & RBAC: Customer cannot delete another customer's review or nonexistent review (Returns HTTP 404)", async () => {
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
    assert.equal(res.getStatus(), 404);
    assert.equal(res.getData()?.success, false);
    assert.match(res.getData()?.message, /Review not found/);
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

  test("20. Review Deletion & Re-submission: After deleting review, customer can submit a new review", async () => {
    let reviewDeleted = false;
    let newReviewSubmitted = false;

    api.get = async (url) => {
      if (url === "products/reviews/888") {
        return {
          data: {
            id: 888,
            product_id: 123,
            reviewer_email: "active_user@example.com",
            review: "Old review",
          },
        };
      }
      if (url === "products/reviews") {
        return { data: reviewDeleted ? [] : [{ id: 888, reviewer_email: "active_user@example.com" }] };
      }
      return { data: null };
    };

    api.delete = async (url) => {
      if (url === "products/reviews/888") {
        reviewDeleted = true;
        return { data: { deleted: true } };
      }
      return { data: {} };
    };

    api.post = async (url, data) => {
      newReviewSubmitted = true;
      return {
        data: {
          id: 889,
          product_id: 123,
          rating: data.rating,
          reviewer: data.reviewer,
          date_created: new Date().toISOString(),
        },
      };
    };

    // 1. Delete the existing review
    const { req: delReq, res: delRes } = createMockContext({
      params: { reviewId: "888" },
      user: { id: 101, email: "active_user@example.com" },
      wpUserId: 101,
      wpUserEmail: "active_user@example.com",
    });
    await deleteReview(delReq, delRes);
    assert.equal(delRes.getStatus(), 200);
    assert.equal(reviewDeleted, true);

    // 2. Now submit a fresh review
    const { req: postReq, res: postRes } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Fresh review after deletion" },
      user: { id: 101, name: "Active User", email: "active_user@example.com" },
      wpUserId: 101,
      wpUserEmail: "active_user@example.com",
    });
    await createOrUpdateReview(postReq, postRes);
    assert.equal(postRes.getStatus(), 200);
    assert.equal(newReviewSubmitted, true);
    assert.equal(postRes.getData()?.success, true);
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

  test("24. Reviewer Name Resolution: Resolves customer real name from customer profile when req.user has no name", async () => {
    let capturedReviewer = null;

    api.get = async (url) => {
      if (url === "customers/101") {
        return {
          data: {
            id: 101,
            first_name: "Lalit",
            last_name: "Choudhary",
            email: "lalit@example.com",
          },
        };
      }
      if (url === "products/reviews") return { data: [] };
      return { data: [] };
    };

    api.post = async (url, payload) => {
      capturedReviewer = payload.reviewer;
      return {
        data: {
          id: 55,
          product_id: 123,
          rating: payload.rating,
          reviewer: payload.reviewer,
          verified: false,
          date_created: new Date().toISOString(),
        },
      };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      body: { rating: 5, review: "Excellent product!" },
      user: { id: 101, email: "lalit@example.com" }, // No user.name
      wpUserId: 101,
      wpUserEmail: "lalit@example.com",
    });

    await createOrUpdateReview(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(capturedReviewer, "Lalit Choudhary", "Must resolve real name from customer profile");
    assert.equal(res.getData()?.review?.reviewer, "Lalit Choudhary");
  });

  test("25. Reviewer Name Resolution: Heals legacy reviews stored as 'Customer' when owner views the product", async () => {
    api.get = async (url) => {
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 877,
              product_id: 123,
              rating: 5,
              reviewer: "Customer", // Legacy review stored with placeholder
              reviewer_email: "lalit@example.com",
              review: "Great quality",
              verified: true,
              date_created: "2026-10-09T09:20:09",
            },
          ],
        };
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
      user: { id: 101, name: "Lalit Choudhary", email: "lalit@example.com" },
      wpUserId: 101,
      wpUserEmail: "lalit@example.com",
    });

    await getProductReviews(req, res);
    assert.equal(res.getStatus(), 200);

    const data = res.getData();
    assert.equal(data.reviews.length, 1);
    assert.equal(data.reviews[0].isOwner, true);
    assert.equal(data.reviews[0].reviewer, "Lalit Choudhary", "Must heal reviewer display to real name for owner");
  });

  // -------------------------------------------------------------
  // 7. Audit Hardening: Mutex, Cache Generation, Math, Text, Auth 503, Real Express Port
  // -------------------------------------------------------------

  test("26. Atomic Mutex: 5 concurrent submits with 20ms delay produce exactly one post, one 200, four 409", async () => {
    let postCallCount = 0;
    const existingDatabaseReviews = [];

    api.get = async (url) => {
      if (url === "products/reviews") {
        return { data: [...existingDatabaseReviews] };
      }
      return { data: [] };
    };

    api.post = async (url, payload) => {
      if (url === "products/reviews") {
        postCallCount++;
        // Simulate real network/DB latency
        await new Promise((r) => setTimeout(r, 20));
        const newReview = {
          id: 500 + postCallCount,
          product_id: payload.product_id,
          rating: payload.rating,
          reviewer: payload.reviewer,
          reviewer_email: payload.reviewer_email,
          review: payload.review,
          status: "approved",
          verified: false,
          date_created: new Date().toISOString(),
        };
        existingDatabaseReviews.push(newReview);
        return { data: newReview };
      }
      return { data: {} };
    };

    // Fire 5 concurrent handler calls for same customer and product
    const contexts = Array.from({ length: 5 }, (_, i) =>
      createMockContext({
        params: { productId: "333" },
        body: { rating: 5, review: `Concurrent test ${i}` },
        user: { id: 777, name: "Race Tester", email: "racetest@example.com" },
        wpUserId: 777,
        wpUserEmail: "racetest@example.com",
      })
    );

    await Promise.all(contexts.map(({ req, res }) => createOrUpdateReview(req, res)));

    const statusCodes = contexts.map(({ res }) => res.getStatus());
    const count200 = statusCodes.filter((s) => s === 200).length;
    const count409 = statusCodes.filter((s) => s === 409).length;

    assert.equal(postCallCount, 1, "Exactly one api.post must execute");
    assert.equal(count200, 1, "Exactly one request must succeed with 200 OK");
    assert.equal(count409, 4, "Four concurrent requests must be rejected with 409 Conflict");
    assert.equal(existingDatabaseReviews.length, 1, "Database must store exactly 1 row");
  });

  test("27. Cache Generation Counter: Stale fetch does NOT overwrite cache if key was deleted during fetch", async () => {
    const key = "test:stale_write:1";
    serverCache.clear();

    // Start slow fetch that takes 40ms
    const slowFetchPromise = serverCache.getOrFetch(
      key,
      async () => {
        await new Promise((r) => setTimeout(r, 40));
        return { value: "stale_data" };
      },
      60000
    );

    // After 10ms (while fetch is in-flight), invalidate the key
    await new Promise((r) => setTimeout(r, 10));
    serverCache.delete(key);

    // Let the slow fetch resolve
    await slowFetchPromise;

    // Generation counter must have discarded set(), so cache must remain null!
    const cachedAfter = serverCache.get(key);
    assert.equal(cachedAfter, null, "Stale data must NOT be cached after deletion");
  });

  test("28. Cache-Control Header: Public review responses include 'private, no-cache'", async () => {
    api.get = async (url) => {
      if (url === "products/reviews") {
        return { data: [] };
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "123" },
    });

    await getProductReviews(req, res);
    assert.equal(res.getStatus(), 200);
    assert.equal(res.getHeader("cache-control"), "private, no-cache");
  });

  test("29. Correct Numbers: 120 reviews across 2 pages calculate exact average, distribution, and totalReviews", async () => {
    // Generate 120 reviews: 60 5-star and 60 4-star (exact average: 4.5)
    const page1Reviews = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      product_id: 888,
      rating: i < 50 ? 5 : 4,
      reviewer: `Customer ${i}`,
      reviewer_email: `user${i}@example.com`,
      review: `Review ${i}`,
      status: "approved",
      verified: true,
      date_created: "2026-10-01T10:00:00",
    }));

    const page2Reviews = Array.from({ length: 20 }, (_, i) => ({
      id: 101 + i,
      product_id: 888,
      rating: i < 10 ? 5 : 4,
      reviewer: `Customer ${100 + i}`,
      reviewer_email: `user${100 + i}@example.com`,
      review: `Review ${100 + i}`,
      status: "approved",
      verified: false,
      date_created: "2026-10-01T10:00:00",
    }));

    api.get = async (url, params) => {
      if (url === "products/reviews") {
        if (params?.page === 1) {
          return {
            data: page1Reviews,
            headers: { "x-wp-total": "120", "x-wp-totalpages": "2" },
          };
        }
        if (params?.page === 2) {
          return {
            data: page2Reviews,
            headers: { "x-wp-total": "120", "x-wp-totalpages": "2" },
          };
        }
      }
      return { data: [] };
    };

    const { req, res } = createMockContext({
      params: { productId: "888" },
    });

    await getProductReviews(req, res);
    assert.equal(res.getStatus(), 200);
    const data = res.getData();

    assert.equal(data.totalReviews, 120, "totalReviews must match all 120 reviews");
    assert.equal(data.averageRating, 4.5, "averageRating must be mathematically accurate 4.5");
    assert.equal(data.ratingDistribution[5], 60, "5-star count must be 60");
    assert.equal(data.ratingDistribution[4], 60, "4-star count must be 60");
    assert.equal(data.reviews.length, 50, "Returned reviews array must slice latest 50");
  });

  test("30. Text Handling: Preserves '<3' and '5 > 4', strips actual HTML tags, and decodes HTML entities", async () => {
    let capturedReviewText = "";
    api.get = async (url) => {
      if (url === "products/reviews") {
        return {
          data: [
            {
              id: 991,
              product_id: 777,
              rating: 5,
              reviewer: "Sam",
              reviewer_email: "sam@example.com",
              review: "<p>Love it &#038; amazing &#039;quality&#039; &lt;3</p>",
              verified: true,
              date_created: "2026-10-01T10:00:00",
            },
          ],
        };
      }
      return { data: [] };
    };

    api.post = async (url, payload) => {
      if (url === "products/reviews") {
        capturedReviewText = payload.review;
        return {
          data: {
            id: 992,
            product_id: payload.product_id,
            rating: payload.rating,
            reviewer: payload.reviewer,
            reviewer_email: payload.reviewer_email,
            review: payload.review,
            verified: false,
            date_created: new Date().toISOString(),
          },
        };
      }
      return { data: {} };
    };

    // 1. Post review with text containing "<3", "> 4" and an injection tag
    const { req: postReq, res: postRes } = createMockContext({
      params: { productId: "777" },
      body: { rating: 5, review: "Love it <3 & 5 > 4 <img src=x onerror=alert(1)>hello" },
      user: { id: 101, email: "user101@example.com" },
      wpUserId: 101,
      wpUserEmail: "user101@example.com",
    });

    await createOrUpdateReview(postReq, postRes);
    assert.equal(postRes.getStatus(), 200);
    assert.match(capturedReviewText, /Love it <3 & 5 > 4 hello/, "Must preserve <3 and strip <img...>");
    assert.doesNotMatch(capturedReviewText, /<img/, "Must strip <img> tag");

    // 2. Read review containing WordPress encoded entities
    serverCache.clear();
    const { req: getReq, res: getRes } = createMockContext({
      params: { productId: "777" },
    });

    await getProductReviews(getReq, getRes);
    assert.equal(getRes.getStatus(), 200);
    const readReview = getRes.getData()?.reviews?.[0]?.review;
    assert.equal(readReview, "Love it & amazing 'quality' <3", "Must decode HTML entities on read");
  });

  test("31. Auth Middleware: Returns 503 on upstream network timeout/5xx, and 401 on missing session", async () => {
    // 1. Unauthenticated request -> 401
    const unauthedReq = { cookies: {}, headers: {} };
    let unauthedCode = 0;
    const unauthedRes = {
      status(c) { unauthedCode = c; return this; },
      json() { return this; },
    };
    await requireAuth("customer")(unauthedReq, unauthedRes, () => {});
    assert.equal(unauthedCode, 401, "Missing auth cookie must return 401");

    // 2. Upstream timeout error -> 503
    const originalAxiosGet = axios.get;
    try {
      axios.get = async () => {
        const timeoutError = new Error("timeout of 8000ms exceeded");
        timeoutError.code = "ECONNABORTED";
        throw timeoutError;
      };

      const timeoutReq = {
        cookies: { mumbai_customer_auth: "test_cookie_timeout" },
        headers: {},
      };
      let timeoutCode = 0;
      let timeoutBody = null;
      const timeoutRes = {
        status(c) { timeoutCode = c; return this; },
        json(b) { timeoutBody = b; return this; },
      };

      await requireAuth("customer")(timeoutReq, timeoutRes, () => {});
      assert.equal(timeoutCode, 503, "Upstream timeout must return 503 Service Unavailable");
      assert.equal(timeoutBody?.code, "AUTH_SERVICE_UNAVAILABLE");
    } finally {
      axios.get = originalAxiosGet;
    }
  });

  test("32. Real Express HTTP App Integration: Anonymous POST -> 401; authed POSTs 1-5 pass; 6th -> 429", async () => {
    const originalAxiosGet = axios.get;
    axios.get = async (url) => {
      if (typeof url === "string" && url.includes("/wp-json/mumbai-auth/v1/me")) {
        return {
          data: {
            logged_in: true,
            current_user_id: 888,
            roles: ["customer"],
            email: "rate_customer@example.com",
            name: "Rate Customer",
            is_phone_verified: true,
            is_suspended: false,
          },
        };
      }
      return { data: {} };
    };

    const testApp = express();
    testApp.use(express.json());
    testApp.use(cookieParser());
    testApp.use("/api/reviews", reviewRoutes);

    const testServer = await new Promise((resolve) => {
      const s = testApp.listen(0, "127.0.0.1", () => resolve(s));
    });
    const port = testServer.address().port;
    const baseUrl = `http://127.0.0.1:${port}/api/reviews`;

    try {
      // 1. Anonymous POST -> 401
      const anonRes = await fetch(`${baseUrl}/product/101`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: 5, review: "Anon review" }),
      });
      assert.equal(anonRes.status, 401, "Anonymous POST must return 401");

      // 2. Authenticated POSTs: simulate 5 submissions on distinct products to test reviewLimiter (max 5)
      let reviewCounter = 0;
      api.get = async () => ({ data: [] });
      api.post = async (url, payload) => ({
        data: {
          id: ++reviewCounter,
          product_id: payload.product_id,
          rating: payload.rating,
          reviewer: payload.reviewer,
          reviewer_email: payload.reviewer_email,
          review: payload.review,
          status: "approved",
          verified: false,
          date_created: new Date().toISOString(),
        },
      });

      const authedHeaders = {
        "Content-Type": "application/json",
        Cookie: "mumbai_customer_auth=test_auth_cookie_888",
      };

      for (let i = 1; i <= 5; i++) {
        const authedRes = await fetch(`${baseUrl}/product/${200 + i}`, {
          method: "POST",
          headers: authedHeaders,
          body: JSON.stringify({ rating: 5, review: `Review ${i}` }),
        });
        assert.equal(authedRes.status, 200, `POST ${i} of 5 must pass with 200`);
      }

      // 3. 6th POST from same user -> 429 Too Many Requests from reviewLimiter
      const sixthRes = await fetch(`${baseUrl}/product/206`, {
        method: "POST",
        headers: authedHeaders,
        body: JSON.stringify({ rating: 5, review: "Review 6 exceeding rate limit" }),
      });
      assert.equal(sixthRes.status, 429, "6th POST must return 429 Too Many Requests");
      const sixthBody = await sixthRes.json();
      assert.match(sixthBody.message, /Too many review submissions/);
    } finally {
      axios.get = originalAxiosGet;
      await new Promise((resolve) => testServer.close(resolve));
    }
  });
});

