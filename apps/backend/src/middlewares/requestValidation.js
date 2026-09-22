import { z } from "zod";

const boundedString = (max = 500) => z.string().trim().max(max);
const positiveId = z.coerce.number().int().positive();
const numericString = (max = 32) => z.string().trim().regex(/^\d+(\.\d+)?$/).max(max);
const integerString = (max = 16) => z.string().trim().regex(/^\d+$/).max(max);

const email = z.string().trim().email().max(254);
const password = z.string().min(8).max(256);
const context = z.enum(["customer", "employee", "admin"]).optional();

export const schemas = {
  login: z.object({ email, password, context }).passthrough(),
  register: z.object({
    email,
    password,
    first_name: boundedString(100).optional(),
    last_name: boundedString(100).optional(),
    firstName: boundedString(100).optional(),
    lastName: boundedString(100).optional(),
    name: boundedString(200).optional(),
    context,
  }).passthrough(),
  forgotPassword: z.object({ email }).passthrough(),
  resetPassword: z.object({ token: z.string().trim().min(1).max(512), password }).passthrough(),
  googleLogin: z.object({ credential: z.string().trim().min(1).max(10000) }).passthrough(),
  otpSend: z.object({
    phone: z.string().trim().min(3).max(254),
    purpose: z.enum(["verify_phone", "reset_password"]),
  }).passthrough(),
  otpVerify: z.object({
    phone: z.string().trim().min(3).max(254),
    otp: z.string().trim().regex(/^\d{6}$/),
    purpose: z.enum(["verify_phone", "reset_password"]),
  }).passthrough(),
  otpResetPassword: z.object({
    phone: z.string().trim().min(3).max(254),
    reset_token: z.string().trim().min(1).max(512),
    new_password: password,
  }).passthrough(),
  productCreate: z.object({
    name: boundedString(200).min(1),
    regular_price: z.union([numericString(), z.number().finite().nonnegative()]),
    sale_price: z.union([z.literal(""), numericString(), z.number().finite().nonnegative()]).optional(),
    stock_quantity: z.union([integerString(), z.number().int().nonnegative()]).optional(),
    sku: boundedString(100).optional(),
    description: boundedString(10000).optional(),
    short_description: boundedString(5000).optional(),
  }).passthrough(),
  productUpdate: z.object({
    name: boundedString(200).min(1).optional(),
    regular_price: z.union([numericString(), z.number().finite().nonnegative()]).optional(),
    sale_price: z.union([z.literal(""), numericString(), z.number().finite().nonnegative()]).optional(),
    stock_quantity: z.union([integerString(), z.number().int().nonnegative()]).optional(),
    stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
  }).passthrough(),
  categoryCreate: z.object({
    name: boundedString(200).min(1),
    image_id: z.union([z.literal(""), positiveId]).optional(),
    image_url: z.string().trim().max(2000).optional(),
    description: boundedString(5000).optional(),
  }).passthrough(),
  categoryUpdate: z.object({
    name: boundedString(200).min(1).optional(),
    image_id: z.union([z.literal(""), positiveId]).optional(),
    image_url: z.string().trim().max(2000).optional(),
    description: boundedString(5000).optional(),
  }).passthrough(),
  categoryReorder: z.object({
    category_ids: z.array(positiveId).min(1).max(500),
  }).passthrough(),
  orderStatus: z.object({
    status: z.enum(["pending", "processing", "packed", "on-hold", "out-for-delivery", "dispatched", "completed", "cancelled", "refunded", "failed"]),
  }).passthrough(),
  employeeAccess: z.object({
    email,
    role: z.literal("employee").optional(),
    notes: boundedString(500).optional(),
  }).passthrough(),
  employeeRole: z.object({ role: z.literal("employee").optional() }).passthrough(),
  employeeReject: z.object({ reason: boundedString(500).optional() }).passthrough(),
  employeeStatus: z.object({ status: z.enum(["active", "deactivated"]) }).passthrough(),
  suspension: z.object({
    email,
    duration: z.enum(["3_months", "6_months", "permanent"]),
    reason: boundedString(1000).optional(),
  }).passthrough(),
  suspensionLookup: z.object({ email }).passthrough(),
  unsuspension: z.object({ email }).passthrough(),
  review: z.object({
    rating: z.coerce.number().int().min(1).max(5),
    review: boundedString(2000).min(1),
  }).passthrough(),
  paymentCreateOrder: z.object({
    order_id: positiveId.optional(),
    billing_address: z.object({
      first_name: boundedString(100).optional(),
      last_name: boundedString(100).optional(),
      email: email.optional(),
      phone: boundedString(20).optional(),
      address_1: boundedString(200).optional(),
      address_2: boundedString(200).optional(),
      city: boundedString(100).optional(),
      state: boundedString(100).optional(),
      postcode: boundedString(20).optional(),
      country: boundedString(10).optional(),
    }).passthrough().optional(),
    shipping_address: z.object({
      first_name: boundedString(100).optional(),
      last_name: boundedString(100).optional(),
      phone: boundedString(20).optional(),
      address_1: boundedString(200).optional(),
      address_2: boundedString(200).optional(),
      city: boundedString(100).optional(),
      state: boundedString(100).optional(),
      postcode: boundedString(20).optional(),
      country: boundedString(10).optional(),
    }).passthrough().optional(),
  }).passthrough(),
  paymentVerify: z.object({
    order_id: positiveId.optional().nullable(),
    razorpay_order_id: boundedString(100),
    razorpay_payment_id: boundedString(100),
    razorpay_signature: boundedString(256),
  }).passthrough(),
  paymentCheckStatus: z.object({
    razorpay_order_id: boundedString(100),
  }).passthrough(),
  idParam: z.object({ id: positiveId }).passthrough(),
  addressIdParam: z.object({
    id: z.string().trim().regex(/^[a-zA-Z0-9-]+$/).min(1).max(64),
  }).passthrough(),
  categoryIdParam: z.object({ categoryId: positiveId }).passthrough(),
  productIdParam: z.object({ productId: positiveId }).passthrough(),
  reviewIdParam: z.object({ reviewId: positiveId }).passthrough(),
  pagination: z.object({
    page: z.coerce.number().int().positive().max(10000).optional(),
    per_page: z.coerce.number().int().positive().max(100).optional(),
    search: boundedString(100).optional(),
    status: boundedString(64).optional(),
    location: boundedString(100).optional(),
    category: boundedString(100).optional(),
    stock_status: z.enum(["all", "instock", "outofstock", "onbackorder", "lowstock"]).optional(),
    date_filter: boundedString(32).optional(),
    dateFilter: boundedString(32).optional(),
    date_from: boundedString(32).optional(),
    date_to: boundedString(32).optional(),
    refresh: z.enum(["0", "1", "true", "false"]).optional(),
  }).passthrough(),
};

export const validateRequest = ({ body, query, params } = {}) => (req, res, next) => {
  try {
    if (body) req.body = body.parse(req.body || {});
    if (query) {
      const parsedQuery = query.parse(req.query || {});
      Object.defineProperty(req, "query", {
        value: parsedQuery,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    if (params) req.params = params.parse(req.params || {});
    return next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: "Invalid request data.",
        code: "VALIDATION_ERROR",
        fields: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
      });
    }
    return next(error);
  }
};
