import { useState, useEffect, useRef, useCallback } from "react";
import { Star, CheckCircle2, Trash2, Loader2, MessageSquarePlus } from "lucide-react";
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
  const submitSuccessTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (submitSuccessTimerRef.current) {
        clearTimeout(submitSuccessTimerRef.current);
      }
    };
  }, []);

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
    } catch {
      // Failed to load reviews, handled by UI empty state
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
        if (submitSuccessTimerRef.current) {
          clearTimeout(submitSuccessTimerRef.current);
        }
        submitSuccessTimerRef.current = setTimeout(() => {
          setShowForm(false);
          setFormSuccess("");
          submitSuccessTimerRef.current = null;
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

  const currentUserReview = reviews.find((r) => r.isOwner === true);

  return (
    <section id="product-reviews" className="rounded-2xl bg-[#111F36] p-4 sm:p-5 shadow-[0_4px_16px_rgba(0,0,0,0.2)] border border-[#1E3252]/80 space-y-3.5 sm:space-y-4 scroll-mt-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[#1E3252]/70 pb-3">
        <div>
          <h2 className="text-sm sm:text-[15px] font-bold uppercase tracking-wide text-[#F1F5F9]">
            Customer Reviews & Ratings
          </h2>
          <p className="text-[11px] sm:text-xs text-[#8FA4BE]">
            Verified ratings and feedback from shoppers
          </p>
        </div>

        {user ? (
          currentUserReview ? (
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-[#132B45] border border-[#1E3252] px-3 py-1.5 text-xs font-semibold text-[#42D6E8] shrink-0">
              <CheckCircle2 size={13} className="text-[#42D6E8]" /> You reviewed this
            </div>
          ) : (
            <button
              onClick={() => {
                setShowForm((prev) => !prev);
                setFormError("");
                setFormSuccess("");
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#42D6E8] px-3 py-1.5 text-xs font-black text-[#061220] shadow-xs hover:bg-[#2CC4D8] hover:text-[#061220] transition active:scale-95 cursor-pointer shrink-0"
            >
              {showForm ? (
                "Close"
              ) : (
                <>
                  <MessageSquarePlus size={13} /> Write Review
                </>
              )}
            </button>
          )
        ) : (
          <button
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#42D6E8] bg-transparent px-3 py-1.5 text-xs font-bold text-[#42D6E8] hover:bg-[#42D6E8] hover:text-[#061220] transition active:scale-95 cursor-pointer shrink-0"
          >
            Sign in to Review
          </button>
        )}
      </div>

      {/* Rating Breakdown & Summary */}
      <div className="grid grid-cols-[90px_1fr] sm:grid-cols-[110px_1fr] gap-3 sm:gap-4 items-center bg-[#0B1425] p-3 sm:p-3.5 rounded-xl border border-[#1E3252]/70">
        {/* Score & Stars */}
        <div className="flex flex-col items-center justify-center text-center border-r border-[#1E3252]/70 pr-3 sm:pr-4">
          <div className="text-2xl sm:text-3xl font-black leading-none text-[#F1F5F9]">
            {averageRating > 0 ? averageRating.toFixed(1) : "0.0"}
          </div>
          <div className="flex items-center gap-0.5 mt-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                size={12}
                className={
                  star <= Math.round(averageRating)
                    ? "fill-amber-400 text-amber-400"
                    : "fill-[#1E3252] text-[#1E3252]"
                }
              />
            ))}
          </div>
          <p className="text-[10px] sm:text-[11px] text-[#8FA4BE] mt-0.5 font-medium">
            {totalReviews} review{totalReviews === 1 ? "" : "s"}
          </p>
        </div>

        {/* Rating Breakdown Bars */}
        <div className="space-y-1">
          {[5, 4, 3, 2, 1].map((stars) => {
            const count = ratingDistribution[stars] || 0;
            const pct = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;
            return (
              <div key={stars} className="flex items-center gap-1.5 sm:gap-2 text-[11px] text-[#8FA4BE]">
                <span className="w-4 font-bold flex items-center gap-0.5 text-[10px] text-[#8FA4BE]">
                  {stars} <Star size={9} className="fill-amber-400 text-amber-400 inline" />
                </span>
                <div className="h-1.5 flex-1 rounded-full bg-[#0E1A2E] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#42D6E8] transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-5 text-right font-medium text-[#6E84A3] text-[10px]">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Review Submission Form */}
      {showForm && !currentUserReview && (
        <form
          onSubmit={handleSubmitReview}
          className="rounded-xl border border-[#42D6E8]/30 bg-[#0B1425] p-3.5 sm:p-4 space-y-3 animate-[fadeIn_0.3s_ease-out]"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-[#F1F5F9]">
              Write Your Review
            </h3>
          </div>

          <p className="text-[11px] text-[#8FA4BE] font-medium">
            Share your feedback and rating for this product.
          </p>

          {formError && (
            <div className="rounded-lg bg-rose-950/40 p-2.5 text-xs font-semibold text-rose-300 border border-rose-800/60">
              {formError}
            </div>
          )}

          {formSuccess && (
            <div className="rounded-lg bg-[#132B45] p-2.5 text-xs font-semibold text-[#42D6E8] border border-[#1E3252] flex items-center gap-1.5">
              <CheckCircle2 size={14} /> {formSuccess}
            </div>
          )}

          {/* Star Rating Picker */}
          <div>
            <label className="block text-[11px] font-bold text-[#F1F5F9] mb-1">
              Your Rating:
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-0.5 transition-transform hover:scale-125 cursor-pointer"
                >
                  <Star
                    size={20}
                    className={
                      star <= (hoverRating || rating)
                        ? "fill-amber-400 text-amber-400"
                        : "fill-[#1E3252] text-[#1E3252]"
                    }
                  />
                </button>
              ))}
              <span className="ml-2 text-[11px] font-bold text-amber-400">
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
            <label className="block text-[11px] font-bold text-[#F1F5F9] mb-1">
              Your Comments & Experience:
            </label>
            <textarea
              rows={2}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Share details about quality, packaging..."
              maxLength={2000}
              className="w-full rounded-lg border border-[#1E3252] bg-[#111F36] p-2.5 text-xs text-[#F1F5F9] placeholder-[#4B6282] focus:border-[#42D6E8] focus:outline-none focus:ring-2 focus:ring-[#42D6E8]/20 resize-none"
            />
            <div className="flex justify-end text-[10px] text-[#6E84A3] mt-0.5">
              {reviewText.length}/2000 characters
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-[#1E3252] bg-transparent px-3 py-1.5 text-xs font-bold text-[#8FA4BE] hover:bg-[#162744] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#42D6E8] px-4 py-1.5 text-xs font-black text-[#061220] hover:bg-[#2CC4D8] hover:text-[#061220] transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
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
      <div className="space-y-2.5">
        {loading ? (
          <div className="py-4 text-center text-xs text-[#8FA4BE] flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin text-[#42D6E8]" />
            Loading reviews...
          </div>
        ) : reviews.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#1E3252] py-3.5 px-4 text-center bg-[#0B1425]">
            <p className="text-xs font-semibold text-[#8FA4BE]">No reviews yet for this product</p>
            <p className="text-[11px] text-[#6E84A3] mt-0.5">
              Be the first to share your experience with other shoppers!
            </p>
          </div>
        ) : (
          reviews.map((r) => {
            const isOwnReview = r.isOwner === true;

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
                className="rounded-xl border border-[#1E3252]/70 bg-[#0B1425] p-3 sm:p-3.5 space-y-1.5 transition hover:border-[#42D6E8]/50"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-[#F1F5F9]">
                        {(isOwnReview && (user?.name || user?.full_name))
                          ? (user.name || user.full_name)
                          : (r.reviewer || "Customer")}
                      </span>
                      {r.verified && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-[#42D6E8] bg-[#132B45] px-1.5 py-0.2 rounded-full border border-[#1E3252]">
                          <CheckCircle2 size={10} /> Verified Buyer
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            size={11}
                            className={
                              star <= r.rating
                                ? "fill-amber-400 text-amber-400"
                                : "fill-[#1E3252] text-[#1E3252]"
                            }
                          />
                        ))}
                      </div>
                      {reviewDate && (
                        <span className="text-[10px] text-[#6E84A3] font-medium">
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
                      className="p-1 text-[#6E84A3] hover:text-rose-400 rounded-md hover:bg-rose-950/30 transition cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>

                <p className="text-xs text-[#CBD5E1] leading-relaxed">
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
