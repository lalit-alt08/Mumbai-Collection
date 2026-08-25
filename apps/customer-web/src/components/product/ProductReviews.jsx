import { useState, useEffect, useRef, useCallback } from "react";
import { Star, CheckCircle2, Trash2, Edit3, Loader2, MessageSquarePlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  getProductReviews,
  submitProductReview,
  deleteProductReview,
} from "../../services/reviewService";
import ConfirmModal from "../common/ConfirmModal.jsx";

function ProductReviews({ productId }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [reviews, setReviews] = useState([]);
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [ratingDistribution, setRatingDistribution] = useState({ 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
  const [loading, setLoading] = useState(true);

  // Form State
  const [showForm, setShowForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  const isSubmittingRef = useRef(false);

  const loadReviews = useCallback(async () => {
    if (!productId) return;
    try {
      setLoading(true);
      const data = await getProductReviews(productId);
      if (data.success) {
        setReviews(data.reviews || []);
        setAverageRating(data.averageRating || 0);
        setTotalReviews(data.totalReviews || 0);
        setRatingDistribution(data.ratingDistribution || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
      }
    } catch (err) {
      console.warn("Failed to load reviews:", err.message);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  // Handle Review Submission with Concurrency Lock
  const handleSubmitReview = async (e) => {
    e.preventDefault();

    if (isSubmittingRef.current || submitting) return;

    if (!rating || rating < 1 || rating > 5) {
      setFormError("Please select a rating from 1 to 5 stars.");
      return;
    }

    if (!reviewText.trim()) {
      setFormError("Please write a few words about your experience.");
      return;
    }

    setFormError("");
    setFormSuccess("");

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);

      const res = await submitProductReview(productId, {
        rating,
        review: reviewText.trim(),
      });

      if (res.success) {
        setFormSuccess(res.message || "Review submitted successfully!");
        setReviewText("");
        setRating(5);
        await loadReviews();
        setTimeout(() => {
          setShowForm(false);
          setFormSuccess("");
        }, 2000);
      } else {
        setFormError(res.message || "Failed to submit review.");
      }
    } catch (err) {
      setFormError(
        err.response?.data?.message || err.message || "Failed to submit review."
      );
    } finally {
      isSubmittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Delete Review Modal State
  const [reviewToDelete, setReviewToDelete] = useState(null);
  const [isDeletingReview, setIsDeletingReview] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const handlePromptDeleteReview = (reviewId) => {
    setDeleteError("");
    setReviewToDelete(reviewId);
  };

  const handleConfirmDeleteReview = async () => {
    if (!reviewToDelete || isDeletingReview) return;
    try {
      setIsDeletingReview(true);
      setDeleteError("");
      await deleteProductReview(reviewToDelete);
      await loadReviews();
      setReviewToDelete(null);
    } catch (err) {
      setDeleteError(err.response?.data?.message || err.message || "Failed to delete review.");
    } finally {
      setIsDeletingReview(false);
    }
  };

  const currentUserReview = reviews.find(
    (r) =>
      user &&
      r.reviewerEmail &&
      user.email &&
      r.reviewerEmail.toLowerCase() === user.email.toLowerCase()
  );

  return (
    <section className="rounded-[24px] bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)] md:p-6 border border-gray-100 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-100 pb-4">
        <div>
          <h2 className="text-[15px] sm:text-[16px] font-bold uppercase tracking-wide text-[#1F2937]">
            Customer Reviews & Ratings
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Verified ratings and feedback from Mumbai Collection shoppers
          </p>
        </div>

        {user ? (
          <button
            onClick={() => {
              if (currentUserReview && !showForm) {
                setRating(currentUserReview.rating);
                setReviewText(currentUserReview.review);
              }
              setShowForm((prev) => !prev);
              setFormError("");
              setFormSuccess("");
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-[#7C3AED] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#6C35E8] transition active:scale-95 cursor-pointer self-start sm:self-auto"
          >
            {showForm ? (
              "Close Form"
            ) : currentUserReview ? (
              <>
                <Edit3 size={14} /> Edit Your Review
              </>
            ) : (
              <>
                <MessageSquarePlus size={14} /> Write a Review
              </>
            )}
          </button>
        ) : (
          <button
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-2 rounded-xl border border-[#7C3AED] bg-white px-4 py-2 text-xs font-bold text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white transition active:scale-95 cursor-pointer self-start sm:self-auto"
          >
            Sign in to write a review
          </button>
        )}
      </div>

      {/* Rating Breakdown & Summary */}
      <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-center bg-[#FAFBFD] p-5 rounded-2xl border border-gray-100">
        {/* Score & Stars */}
        <div className="flex flex-col items-center justify-center text-center md:border-r md:border-gray-200 md:pr-6">
          <div className="text-[40px] font-black leading-none text-[#1F2937]">
            {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
          </div>
          <div className="flex items-center gap-1 mt-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                size={16}
                className={
                  star <= Math.round(averageRating)
                    ? "fill-amber-400 text-amber-400"
                    : "fill-gray-200 text-gray-200"
                }
              />
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1 font-medium">
            Based on {totalReviews} review{totalReviews === 1 ? "" : "s"}
          </p>
        </div>

        {/* Rating Breakdown Bars */}
        <div className="space-y-1.5">
          {[5, 4, 3, 2, 1].map((stars) => {
            const count = ratingDistribution[stars] || 0;
            const pct = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
            return (
              <div key={stars} className="flex items-center gap-2.5 text-xs text-gray-600">
                <span className="w-6 font-bold flex items-center gap-0.5">
                  {stars} <Star size={10} className="fill-amber-400 text-amber-400 inline" />
                </span>
                <div className="h-2 flex-1 rounded-full bg-gray-200 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#7C3AED] transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-8 text-right font-medium text-gray-400 text-[11px]">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Review Submission Form */}
      {showForm && (
        <form
          onSubmit={handleSubmitReview}
          className="rounded-2xl border border-[#7C3AED]/20 bg-[#FBF9FF] p-5 space-y-4 animate-[fadeIn_0.3s_ease-out]"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#1F2937]">
              {currentUserReview ? "Update Your Review" : "Write Your Review"}
            </h3>
            {currentUserReview && (
              <span className="text-[11px] font-bold text-[#7C3AED] bg-[#7C3AED]/10 px-2.5 py-0.5 rounded-full">
                Editing Previous Review
              </span>
            )}
          </div>

          {formError && (
            <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-600 border border-red-200">
              {formError}
            </div>
          )}

          {formSuccess && (
            <div className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
              <CheckCircle2 size={15} /> {formSuccess}
            </div>
          )}

          {/* Star Rating Picker */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Your Rating:
            </label>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 transition-transform hover:scale-125 cursor-pointer"
                >
                  <Star
                    size={24}
                    className={
                      star <= (hoverRating || rating)
                        ? "fill-amber-400 text-amber-400"
                        : "fill-gray-200 text-gray-200"
                    }
                  />
                </button>
              ))}
              <span className="ml-2 text-xs font-bold text-amber-800">
                {rating === 5
                  ? "5 Stars - Excellent!"
                  : rating === 4
                  ? "4 Stars - Good"
                  : rating === 3
                  ? "3 Stars - Average"
                  : rating === 2
                  ? "2 Stars - Below Average"
                  : "1 Star - Poor"}
              </span>
            </div>
          </div>

          {/* Review Textarea */}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1.5">
              Your Comments & Experience:
            </label>
            <textarea
              rows={3}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Share details about the fit, quality, material, and packaging..."
              maxLength={2000}
              className="w-full rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-800 placeholder-gray-400 focus:border-[#7C3AED] focus:outline-none focus:ring-2 focus:ring-[#7C3AED]/20 resize-none"
            />
            <div className="flex justify-end text-[11px] text-gray-400 mt-1">
              {reviewText.length}/2000 characters
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7C3AED] px-5 py-2 text-xs font-extrabold text-white hover:bg-[#6C35E8] transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Review"
              )}
            </button>
          </div>
        </form>
      )}

      {/* Review List */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-8 text-center text-xs text-gray-400 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin text-[#7C3AED]" />
            Loading reviews...
          </div>
        ) : reviews.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center bg-[#FAFBFD]">
            <p className="text-xs font-bold text-gray-700">No reviews yet for this product</p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Be the first to share your experience with other shoppers!
            </p>
          </div>
        ) : (
          reviews.map((r) => {
            const isOwnReview =
              user &&
              r.reviewerEmail &&
              user.email &&
              r.reviewerEmail.toLowerCase() === user.email.toLowerCase();

            const reviewDate = r.dateCreated
              ? new Date(r.dateCreated).toLocaleDateString("en-IN", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              : "";

            return (
              <div
                key={r.id}
                className="rounded-2xl border border-gray-100 bg-[#FAFBFD] p-4 sm:p-5 space-y-2.5 transition hover:bg-white hover:shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs sm:text-sm font-bold text-[#1F2937]">
                        {r.reviewer || "Shopper"}
                      </span>
                      {r.verified && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 size={11} /> Verified Buyer
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            size={13}
                            className={
                              star <= r.rating
                                ? "fill-amber-400 text-amber-400"
                                : "fill-gray-200 text-gray-200"
                            }
                          />
                        ))}
                      </div>
                      {reviewDate && (
                        <span className="text-[11px] text-gray-400 font-medium">
                          • {reviewDate}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions for own review */}
                  {isOwnReview && (
                    <button
                      onClick={() => handlePromptDeleteReview(r.id)}
                      title="Delete your review"
                      className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                <p className="text-xs sm:text-sm text-gray-700 leading-relaxed">
                  {r.review}
                </p>
              </div>
            );
          })
        )}
      </div>

      {/* Delete Review Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(reviewToDelete)}
        onClose={() => {
          if (!isDeletingReview) setReviewToDelete(null);
        }}
        onConfirm={handleConfirmDeleteReview}
        title="Delete your review?"
        message={deleteError || "Are you sure you want to delete your review? This action cannot be undone."}
        confirmText="Delete Review"
        cancelText="Cancel"
        isLoading={isDeletingReview}
        variant="danger"
      />
    </section>
  );
}

export default ProductReviews;
