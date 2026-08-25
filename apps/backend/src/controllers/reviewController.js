import api from "../config/woocommerce.js";
import axios from "axios";
import { httpsAgent } from "../config/httpAgent.js";

/**
 * Helper to fetch customer email and display name from WordPress
 */
const getCustomerDetails = async (req) => {
  const userId = req.user?.id || req.wpUserId;
  let reviewerName = "Customer";
  let reviewerEmail = `customer_${userId}@mumbai-collection.local`;

  try {
    const wpAuth = req.wpAuthCookie;
    if (wpAuth) {
      const meRes = await axios.get(
        `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/me`,
        {
          headers: { Cookie: wpAuth },
          httpsAgent,
          timeout: 5000,
        }
      );
      if (meRes.data?.user?.user_email) {
        reviewerEmail = meRes.data.user.user_email;
      }
      if (meRes.data?.user?.display_name) {
        reviewerName = meRes.data.user.display_name;
      }
    }

    // Try profile endpoint for full name
    const profRes = await axios.get(
      `${process.env.WORDPRESS_URL}/wp-json/mumbai-auth/v1/profile`,
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
          "X-Mumbai-User-ID": String(userId),
        },
        httpsAgent,
        timeout: 5000,
      }
    );
    if (profRes.data?.full_name && profRes.data.full_name.trim()) {
      reviewerName = profRes.data.full_name.trim();
    }
  } catch (err) {
    console.warn("Failed to fetch customer profile details for review:", err.message);
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

      return {
        id: r.id,
        productId: r.product_id,
        rating: ratingNum,
        reviewer: r.reviewer || "Verified Customer",
        reviewerEmail: r.reviewer_email || "",
        review: cleanReview,
        verified: Boolean(r.verified),
        dateCreated: r.date_created,
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
    console.error("Get product reviews error:", error.response?.data || error.message);
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

    // Sanitize review text to plain text (Prevent XSS)
    const cleanReview = review.replace(/<[^>]*>?/gm, "").trim();

    const { userId, reviewerName, reviewerEmail } = await getCustomerDetails(req);

    // Purchase Verification Check
    let isVerified = false;
    try {
      const ordersRes = await api.get("orders", {
        customer: userId,
        per_page: 50,
      });
      const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
      isVerified = orders.some((order) =>
        order.line_items?.some((item) => Number(item.product_id) === productId)
      );
    } catch (orderErr) {
      console.warn("Order check for verified purchase warning:", orderErr.message);
    }

    // Check for existing review from this customer on this product
    const existingReviewsRes = await api.get("products/reviews", {
      product: [productId],
    });
    const existingList = Array.isArray(existingReviewsRes.data)
      ? existingReviewsRes.data
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
        reviewer: resultReview.reviewer,
        review: cleanReview,
        verified: isVerified,
        dateCreated: resultReview.date_created,
      },
    });
  } catch (error) {
    console.error("Submit review error:", error.response?.data || error.message);
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
    console.error("Delete review error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete review.",
    });
  }
};
