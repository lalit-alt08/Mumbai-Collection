import api from "../config/woocommerce.js";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { checkSessionSuspended } from "../middlewares/authMiddleware.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { logError, logger } from "../utils/logger.js";
import { serverCache } from "../utils/memoryCache.js";

/**
 * In-process promise mutex map for serializing review check + insert per user and product
 */
const reviewMutex = new Map();

/**
 * Decode HTML entities returned by WordPress / WooCommerce
 */
const decodeHtmlEntities = (str) => {
  if (!str || typeof str !== "string") return "";
  return str
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
};

/**
 * Helper to sanitize customer reviewer display name, avoiding email/phone/system fallbacks
 */
const sanitizeReviewerDisplayName = (rawName, fallback = "Customer") => {
  if (!rawName || typeof rawName !== "string") return fallback;
  const name = rawName.trim();
  if (!name) return fallback;

  // Never leak email addresses as reviewer name
  if (name.includes("@")) return fallback;

  // Never leak raw phone numbers as reviewer name
  if (/^\+?\d[\d\s-]{7,}\d$/.test(name)) return fallback;

  // Filter out system placeholders
  const lower = name.toLowerCase();
  if (
    lower === "customer" ||
    lower === "verified customer" ||
    lower === "shopper" ||
    lower === "guest customer" ||
    lower === "mumbaicollection" ||
    lower === "mumbai collection"
  ) {
    return fallback;
  }

  return name;
};

/**
 * Helper to fetch customer email and display name from session and WordPress
 */
const getCustomerDetails = async (req) => {
  const userId = req.user?.id || req.wpUserId;
  let reviewerName = (req.user?.name || "").trim() || "Customer";
  let reviewerEmail = (req.user?.email || req.wpUserEmail || "").trim();

  if (!reviewerEmail && userId) {
    reviewerEmail = `customer_${userId}@mumbai-collection.local`;
  }

  // Check email-to-name cache first
  if (reviewerName === "Customer" && reviewerEmail.includes("@")) {
    const cachedName = serverCache.get(`customer:email_name:${reviewerEmail.toLowerCase()}`);
    if (cachedName && cachedName !== "Customer") {
      reviewerName = cachedName;
    }
  }

  // If reviewer name is default/empty, attempt WordPress lookup (cached 5 min)
  if (reviewerName === "Customer" && (req.wpAuthCookie || userId)) {
    const cacheKey = `customer:review_details:${userId || req.wpAuthCookie?.slice(0, 32)}`;
    const cached = serverCache.get(cacheKey);
    if (cached) {
      if (cached.reviewerName && reviewerName === "Customer") reviewerName = cached.reviewerName;
      if (cached.reviewerEmail && !reviewerEmail.includes("@")) reviewerEmail = cached.reviewerEmail;
    } else {
      if (req.wpAuthCookie && process.env.WORDPRESS_URL) {
        try {
          const meRes = await axios.get(
            `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
            {
              headers: { Cookie: req.wpAuthCookie },
              httpsAgent,
              timeout: 4000,
            }
          );
          if (meRes.data?.email && !reviewerEmail.includes("@")) {
            reviewerEmail = meRes.data.email;
          }
          const possibleName = (
            meRes.data?.name ||
            meRes.data?.display_name ||
            meRes.data?.user?.display_name ||
            ""
          ).trim();
          if (possibleName && sanitizeReviewerDisplayName(possibleName, "") !== "") {
            reviewerName = possibleName;
          }
        } catch (_) {}
      }

      if (reviewerName === "Customer" && userId && process.env.WORDPRESS_URL && process.env.MUMBAI_INTERNAL_API_KEY) {
        try {
          const profRes = await axios.get(
            `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
            {
              headers: {
                "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
                "X-Mumbai-User-ID": String(userId),
              },
              httpsAgent,
              timeout: 4000,
            }
          );
          const fullName = (
            profRes.data?.profile?.full_name ||
            profRes.data?.full_name ||
            ""
          ).trim();
          if (fullName && sanitizeReviewerDisplayName(fullName, "") !== "") {
            reviewerName = fullName;
          }
        } catch (_) {}
      }

      if (reviewerName === "Customer" && userId) {
        try {
          const custRes = await api.get(`customers/${userId}`);
          const custData = custRes?.data;
          if (custData) {
            const nameFromCust = formatCustomerDisplayName(
              custData.first_name,
              custData.last_name,
              custData.username || ""
            );
            if (nameFromCust && sanitizeReviewerDisplayName(nameFromCust, "") !== "") {
              reviewerName = nameFromCust;
            }
          }
        } catch (_) {}
      }

      if (reviewerName !== "Customer" || (reviewerEmail && reviewerEmail.includes("@"))) {
        serverCache.set(cacheKey, { reviewerName, reviewerEmail }, 300000);
      }
    }
  }

  if (reviewerName !== "Customer" && reviewerEmail && reviewerEmail.includes("@")) {
    serverCache.set(`customer:email_name:${reviewerEmail.toLowerCase()}`, reviewerName, 86400000);
  }

  return { userId, reviewerName, reviewerEmail };
};

/**
 * Get Reviews and Rating Summary for a Product
 */
export const getProductReviews = async (req, res) => {
  try {
    const productId = Number(req.params.productId);
    if (!productId || isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    // Resolve current authenticated customer's email and name directly from session (no slow WP calls on read)
    const currentCustomerEmail = (req.user?.email || req.wpUserEmail || "").toLowerCase().trim();
    const currentCustomerName = (req.user?.name || "").trim();

    // High-performance public single-flight read-through cache (5-minute TTL)
    const publicCacheKey = `reviews:product:${productId}`;
    const publicReviewData = await serverCache.getOrFetch(
      publicCacheKey,
      async () => {
        let allApprovedReviews = [];
        let page = 1;
        const MAX_REVIEWS_CAP = 500;

        while (allApprovedReviews.length < MAX_REVIEWS_CAP) {
          const pageRes = await api.get("products/reviews", {
            product: [productId],
            status: "approved",
            per_page: 100,
            page,
            order: "desc",
            orderby: "date",
          });

          const list = Array.isArray(pageRes?.data) ? pageRes.data : [];
          if (list.length === 0) break;

          allApprovedReviews.push(...list);

          const totalPages = Number(pageRes.headers?.["x-wp-totalpages"]);
          if (!isNaN(totalPages) && page >= totalPages) break;
          if (list.length < 100) break;

          page++;
        }

        const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        let totalScore = 0;

        for (const r of allApprovedReviews) {
          const ratingNum = Math.max(1, Math.min(5, Number(r.rating) || 5));
          totalScore += ratingNum;
          ratingDistribution[ratingNum] = (ratingDistribution[ratingNum] || 0) + 1;
        }

        const totalReviews = allApprovedReviews.length;
        const averageRating =
          totalReviews > 0 ? Number((totalScore / totalReviews).toFixed(1)) : 0;

        // Slice latest 50 reviews for frontend display
        const rawLatest50 = allApprovedReviews.slice(0, 50);

        const formattedReviews = rawLatest50.map((r) => {
          const ratingNum = Math.max(1, Math.min(5, Number(r.rating) || 5));

          // Strip HTML tags using safe regex while preserving text like "<3" and "a < b"
          const cleanReview = decodeHtmlEntities(
            String(r.review || "").replace(/<\/?[a-z][^>]*>/gi, "")
          ).trim();

          let reviewerDisplay = sanitizeReviewerDisplayName(r.reviewer, "Customer");
          if (reviewerDisplay === "Customer" && r.reviewer_email) {
            const cachedReviewer = serverCache.get(`customer:email_name:${r.reviewer_email.toLowerCase()}`);
            if (cachedReviewer && cachedReviewer !== "Customer") {
              reviewerDisplay = cachedReviewer;
            }
          }

          return {
            id: r.id,
            productId: r.product_id,
            rating: ratingNum,
            reviewer: reviewerDisplay,
            reviewerEmail: (r.reviewer_email || "").toLowerCase().trim(),
            review: cleanReview,
            verified: Boolean(r.verified),
            dateCreated: r.date_created,
          };
        });

        return {
          productId,
          averageRating,
          totalReviews,
          ratingDistribution,
          reviews: formattedReviews,
        };
      },
      300000 // 5-minute TTL
    );

    // Dynamic, user-specific mapping for current requester (prevents cross-user cache leakage)
    const clientReviews = publicReviewData.reviews.map((r) => {
      const isOwner = Boolean(
        currentCustomerEmail &&
        r.reviewerEmail &&
        r.reviewerEmail === currentCustomerEmail
      );

      let reviewerDisplay = r.reviewer;
      if (isOwner && reviewerDisplay === "Customer" && currentCustomerName && currentCustomerName !== "Customer") {
        reviewerDisplay = currentCustomerName;
      }

      return {
        id: r.id,
        productId: r.productId,
        rating: r.rating,
        reviewer: reviewerDisplay,
        review: r.review,
        verified: r.verified,
        dateCreated: r.dateCreated,
        isOwner,
      };
    });

    if (typeof res.set === "function") {
      res.set("Cache-Control", "private, no-cache");
    } else if (typeof res.setHeader === "function") {
      res.setHeader("Cache-Control", "private, no-cache");
    }
    res.json({
      success: true,
      productId: publicReviewData.productId,
      averageRating: publicReviewData.averageRating,
      totalReviews: publicReviewData.totalReviews,
      ratingDistribution: publicReviewData.ratingDistribution,
      reviews: clientReviews,
    });
  } catch (error) {
    logError(req, error, "Get product reviews error");
    res.status(500).json({
      success: false,
      message: "Failed to load product reviews.",
      reviews: [],
      averageRating: 0,
      totalReviews: 0,
    });
  }
};

/**
 * Submit or Update a Product Review (1 per customer/product)
 */
export const createOrUpdateReview = async (req, res) => {
  try {
    const productId = Number(req.params.productId);
    if (!productId || isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product ID.",
      });
    }

    // Customer Suspension Guard
    const isSuspended =
      typeof req.user?.is_suspended === "boolean"
        ? req.user.is_suspended
        : typeof req.isSuspended === "boolean"
        ? req.isSuspended
        : req.wpAuthCookie
        ? await checkSessionSuspended(req.wpAuthCookie)
        : false;

    if (isSuspended) {
      return res.status(403).json({
        success: false,
        code: "CUSTOMER_SUSPENDED",
        message: "Your account is currently suspended and you cannot submit product reviews.",
      });
    }

    const { rating, review } = req.body;
    const ratingNum = Number(rating);

    if (!ratingNum || !Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be a whole number between 1 and 5 stars.",
      });
    }

    if (!review || typeof review !== "string" || !review.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please write a review comment.",
      });
    }

    if (review.trim().length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Review cannot exceed 2000 characters.",
      });
    }

    const userId = req.user?.id || req.wpUserId;
    const hasAuth = Boolean(userId || req.user?.email || req.wpUserEmail || req.wpAuthCookie);
    if (!hasAuth) {
      return res.status(401).json({
        success: false,
        message: "Please sign in to submit a review.",
      });
    }

    let { reviewerName, reviewerEmail } = await getCustomerDetails(req);

    if (!reviewerEmail) {
      return res.status(401).json({
        success: false,
        message: "Please sign in to submit a review.",
      });
    }

    // Sanitize review text: strip HTML tags but preserve text like "<3" and "5 > 4"
    const cleanReview = review.replace(/<\/?[a-z][^>]*>/gi, "").trim();

    // Acquire per-key in-process mutex to serialize check + insert per customer and product
    const mutexKey = `${userId || reviewerEmail}:${productId}`;
    while (reviewMutex.has(mutexKey)) {
      try {
        await reviewMutex.get(mutexKey);
      } catch (_) {}
    }

    let releaseMutex;
    const mutexPromise = new Promise((resolve) => {
      releaseMutex = resolve;
    });
    reviewMutex.set(mutexKey, mutexPromise);

    try {
      // Check if customer already submitted review for this product (including held/spam statuses)
      const existingReviewsRes = await api.get("products/reviews", {
        product: [productId],
        status: "all",
        per_page: 100,
      });

      const existingList = Array.isArray(existingReviewsRes?.data) ? existingReviewsRes.data : [];
      const existingReview = existingList.find(
        (r) =>
          r.reviewer_email &&
          r.reviewer_email.toLowerCase() === reviewerEmail.toLowerCase()
      );

      if (existingReview) {
        return res.status(409).json({
          success: false,
          code: "ALREADY_REVIEWED",
          message: "You have already reviewed this product. Each customer can submit one review.",
          reviewId: existingReview.id,
        });
      }

      // Create new review
      const sanitizedReviewerName = sanitizeReviewerDisplayName(reviewerName, "Customer");
      const createRes = await api.post("products/reviews", {
        product_id: productId,
        reviewer: sanitizedReviewerName,
        reviewer_email: reviewerEmail,
        rating: ratingNum,
        review: cleanReview,
        status: "approved",
      });

      const resultReview = createRes.data;

      // Targeted cache invalidation: invalidate only this product's reviews and product card cache
      serverCache.delete(`reviews:product:${productId}`);
      serverCache.delete(`catalog:product:${productId}`);

      return res.status(200).json({
        success: true,
        message: "Thank you! Your review has been submitted.",
        review: {
          id: resultReview.id,
          productId: resultReview.product_id,
          rating: resultReview.rating,
          reviewer: sanitizeReviewerDisplayName(resultReview.reviewer || sanitizedReviewerName, "Customer"),
          review: cleanReview,
          verified: Boolean(resultReview.verified),
          dateCreated: resultReview.date_created,
          isOwner: true,
        },
      });
    } finally {
      reviewMutex.delete(mutexKey);
      if (releaseMutex) releaseMutex();
    }
  } catch (error) {
    logError(req, error, "Submit review error");
    return res.status(500).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to submit review.",
    });
  }
};

/**
 * Delete Own Review
 */
export const deleteReview = async (req, res) => {
  try {
    const reviewId = Number(req.params.reviewId);
    if (!reviewId || isNaN(reviewId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid review ID.",
      });
    }

    const { reviewerEmail } = await getCustomerDetails(req);

    // Fetch review to verify customer ownership
    let reviewData;
    try {
      const reviewRes = await api.get(`products/reviews/${reviewId}`);
      reviewData = reviewRes.data;
    } catch (_) {
      // Nonexistent review in WooCommerce -> generic 404 (prevents leaking 500 error)
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    // Ownership check: If review does not exist or belongs to another user, return 404
    // (Prevents IDOR resource enumeration and avoids leaking review existence via 403)
    if (
      !reviewData ||
      !reviewData.reviewer_email ||
      reviewData.reviewer_email.toLowerCase() !== (reviewerEmail || "").toLowerCase()
    ) {
      return res.status(404).json({
        success: false,
        message: "Review not found.",
      });
    }

    await api.delete(`products/reviews/${reviewId}`, {
      force: true,
    });

    // Note: Delete-then-re-post remains permitted by design. Rate limiting (reviewLimiter: 5/15m) bounds submissions.
    if (reviewData?.product_id) {
      serverCache.delete(`reviews:product:${reviewData.product_id}`);
      serverCache.delete(`catalog:product:${reviewData.product_id}`);
    }

    return res.json({
      success: true,
      message: "Review deleted successfully.",
    });
  } catch (error) {
    logError(req, error, "Delete review error");
    return res.status(500).json({
      success: false,
      message: "Failed to delete review.",
    });
  }
};
