import api from "../config/woocommerce.js";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";
import { checkSessionSuspended } from "../middlewares/authMiddleware.js";
import { formatCustomerDisplayName } from "../utils/nameFormatter.js";
import { logError, logger } from "../utils/logger.js";

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

  if (!reviewerEmail) {
    reviewerEmail = `customer_${userId}@mumbai-collection.local`;
  }

  // If reviewer name is default/empty, attempt WordPress lookup
  if (reviewerName === "Customer" && (req.wpAuthCookie || userId)) {
    try {
      const wpAuth = req.wpAuthCookie;
      if (wpAuth) {
        const meRes = await axios.get(
          `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
          {
            headers: { Cookie: wpAuth },
            httpsAgent,
            timeout: 4000,
          }
        );
        if (meRes.data?.email && !reviewerEmail.includes("@")) {
          reviewerEmail = meRes.data.email;
        }
        if (meRes.data?.user?.display_name) {
          reviewerName = meRes.data.user.display_name;
        }
      }

      if (reviewerName === "Customer" && userId) {
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
        if (profRes.data?.full_name && profRes.data.full_name.trim()) {
          reviewerName = profRes.data.full_name.trim();
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, "Customer profile detail fetch warning for review");
    }
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

    // Resolve current authenticated customer's email if logged in
    let currentCustomerEmail = "";
    if (req.user?.email || req.wpUserEmail) {
      currentCustomerEmail = (req.user?.email || req.wpUserEmail || "").toLowerCase().trim();
    } else if (req.wpAuthCookie) {
      try {
        const details = await getCustomerDetails(req);
        if (details.reviewerEmail) {
          currentCustomerEmail = details.reviewerEmail.toLowerCase().trim();
        }
      } catch (_) {}
    }

    const response = await api.get("products/reviews", {
      product: [productId],
      status: "approved",
      per_page: 50,
      order: "desc",
      orderby: "date",
    });

    const rawReviews = Array.isArray(response.data) ? response.data : [];

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalScore = 0;

    const formattedReviews = rawReviews.map((r) => {
      const ratingNum = Math.max(1, Math.min(5, Number(r.rating) || 5));
      totalScore += ratingNum;
      ratingDistribution[ratingNum] = (ratingDistribution[ratingNum] || 0) + 1;

      // Plain text sanitization to eliminate XSS
      const cleanReview = String(r.review || "")
        .replace(/<[^>]*>?/gm, "")
        .trim();

      const isOwner = Boolean(
        currentCustomerEmail &&
        r.reviewer_email &&
        r.reviewer_email.toLowerCase().trim() === currentCustomerEmail
      );

      return {
        id: r.id,
        productId: r.product_id,
        rating: ratingNum,
        reviewer: sanitizeReviewerDisplayName(r.reviewer, "Customer"),
        review: cleanReview,
        verified: Boolean(r.verified),
        dateCreated: r.date_created,
        isOwner,
      };
    });

    const totalReviews = formattedReviews.length;
    const averageRating =
      totalReviews > 0 ? Number((totalScore / totalReviews).toFixed(1)) : 0;

    res.json({
      success: true,
      productId,
      averageRating,
      totalReviews,
      ratingDistribution,
      reviews: formattedReviews,
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

    const { userId, reviewerName, reviewerEmail } = await getCustomerDetails(req);

    // Sanitize review text to plain text (Prevent XSS)
    const cleanReview = review.replace(/<[^>]*>?/gm, "").trim();

    // Parallelize purchase verification check & existing review lookup for performance
    const [ordersResult, existingReviewsResult] = await Promise.allSettled([
      api.get("orders", {
        customer: userId,
        per_page: 50,
      }),
      api.get("products/reviews", {
        product: [productId],
      }),
    ]);

    let isVerified = false;
    if (ordersResult.status === "fulfilled") {
      const orders = Array.isArray(ordersResult.value?.data) ? ordersResult.value.data : [];
      isVerified = orders
        .filter((order) => !["cancelled", "failed", "refunded"].includes(order.status))
        .some((order) =>
          order.line_items?.some((item) => Number(item.product_id) === productId)
        );
    } else {
      logger.warn({ err: ordersResult.reason?.message }, "Order check for verified purchase warning");
    }

    const existingList =
      existingReviewsResult.status === "fulfilled" && Array.isArray(existingReviewsResult.value?.data)
        ? existingReviewsResult.value.data
        : [];

    const existingReview = existingList.find(
      (r) =>
        r.reviewer_email &&
        r.reviewer_email.toLowerCase() === reviewerEmail.toLowerCase()
    );

    let resultReview = null;

    if (existingReview) {
      // Update existing review (One review per customer per product)
      const updateRes = await api.put(`products/reviews/${existingReview.id}`, {
        rating: ratingNum,
        review: cleanReview,
        verified: isVerified,
      });
      resultReview = updateRes.data;
    } else {
      // Create new review
      const createRes = await api.post("products/reviews", {
        product_id: productId,
        reviewer: reviewerName,
        reviewer_email: reviewerEmail,
        rating: ratingNum,
        review: cleanReview,
        verified: isVerified,
        status: "approved",
      });
      resultReview = createRes.data;
    }

    res.status(200).json({
      success: true,
      message: existingReview
        ? "Your review has been updated."
        : "Thank you! Your review has been submitted.",
      review: {
        id: resultReview.id,
        productId: resultReview.product_id,
        rating: resultReview.rating,
        reviewer: sanitizeReviewerDisplayName(resultReview.reviewer || reviewerName, "Customer"),
        review: cleanReview,
        verified: isVerified,
        dateCreated: resultReview.date_created,
        isOwner: true,
      },
    });
  } catch (error) {
    logError(req, error, "Submit review error");
    res.status(500).json({
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
    const reviewRes = await api.get(`products/reviews/${reviewId}`);
    const reviewData = reviewRes.data;

    if (
      !reviewData ||
      !reviewData.reviewer_email ||
      reviewData.reviewer_email.toLowerCase() !== reviewerEmail.toLowerCase()
    ) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own reviews.",
      });
    }

    await api.delete(`products/reviews/${reviewId}`, {
      force: true,
    });

    res.json({
      success: true,
      message: "Review deleted successfully.",
    });
  } catch (error) {
    logError(req, error, "Delete review error");
    res.status(500).json({
      success: false,
      message: "Failed to delete review.",
    });
  }
};
