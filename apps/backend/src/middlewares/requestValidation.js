import { z } from "zod";

const boundedString = (max = 500) => z.string().trim().max(max);
const positiveId = z.coerce.number().int().positive();
const numericString = (max = 32) => z.string().trim().regex(/^\d+(\.\d+)?$/).max(max);
const integerString = (max = 16) => z.string().trim().regex(/^\d+$/).max(max);
const indianMobile = z.string().trim().regex(/^(?:\+?91[\s-]?)?[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number.");

const email = z.string().trim().max(254).email().refine((value) => {
  const [local, domain, ...extra] = value.split("@");
  if (!local || !domain || extra.length || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return false;
  }

  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) =>
    label.length > 0 && label.length <= 63 &&
    /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)
  ) && /^[a-z]{2,63}$/i.test(labels.at(-1));
}, "Please enter a valid email address.");
const loginPassword = z.string().min(1, "Password is required.").max(256);
const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters long.")
  .max(256, "Password is too long.")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter (A-Z).")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter (a-z).")
  .regex(/\d/, "Password must contain at least one number (0-9).")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character (e.g. !@#$%^&*).");
const context = z.enum(["customer", "employee", "admin"]).optional();

const personName = (max = 100) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((val) => val.replace(/\s+/g, " "))
    .refine(
      (val) => !val || (/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(val) && /[\p{L}\p{M}]/u.test(val)),
      "Name can only contain letters, spaces, hyphens, apostrophes, and periods."
    );

export const schemas = {
  login: z.object({ email, password: loginPassword, context }),
  register: z.object({
    email,
    password: strongPassword,
    first_name: personName(100).optional(),
    last_name: personName(100).optional(),
    firstName: personName(100).optional(),
    lastName: personName(100).optional(),
    name: personName(200).optional(),
    context,
  }),
  forgotPassword: z.object({ email }),
  resetPassword: z.object({ token: z.string().trim().min(1).max(512), password: strongPassword }),
  googleLogin: z.object({ credential: z.string().trim().min(1).max(10000) }),
  otpSend: z.object({
    phone: z.string().trim().min(3).max(254).optional(),
    email: email.optional(),
    purpose: z.enum(["verify_phone", "reset_password"]),
  }).refine((data) => !!(data.phone || data.email), {
    message: "Email or phone number is required.",
    path: ["phone"],
  }),
  otpVerify: z.object({
    phone: z.string().trim().min(3).max(254).optional(),
    email: email.optional(),
    otp: z.string().trim().regex(/^\d{6}$/, "OTP must be exactly 6 digits."),
    purpose: z.enum(["verify_phone", "reset_password"]),
  }).refine((data) => !!(data.phone || data.email), {
    message: "Email or phone number is required.",
    path: ["phone"],
  }),
  otpResetPassword: z.object({
    phone: z.string().trim().min(3).max(254).optional(),
    email: email.optional(),
    reset_token: z.string().trim().min(1).max(512),
    new_password: strongPassword,
  }).refine((data) => !!(data.phone || data.email), {
    message: "Email or phone number is required.",
    path: ["phone"],
  }),
  productCreate: z.object({
    name: boundedString(200).min(1),
    regular_price: z.union([numericString(), z.number().finite().nonnegative()]),
    sale_price: z.union([z.literal(""), numericString(), z.number().finite().nonnegative()]).optional(),
    stock_quantity: z.union([integerString(), z.number().int().nonnegative()]).optional(),
    sku: boundedString(100).optional(),
    description: boundedString(10000).optional(),
    short_description: boundedString(5000).optional(),
    category_ids: z.array(positiveId).optional(),
    categories: z.array(z.union([positiveId, z.object({ id: positiveId })])).optional(),
    image_id: z.union([z.literal(""), positiveId]).optional(),
    image_url: z.string().trim().max(2000).optional(),
    images: z.array(z.union([positiveId, z.string().trim().max(2000), z.record(z.string(), z.any())])).optional(),
  }),
  productUpdate: z.object({
    name: boundedString(200).min(1).optional(),
    regular_price: z.union([numericString(), z.number().finite().nonnegative()]).optional(),
    sale_price: z.union([z.literal(""), numericString(), z.number().finite().nonnegative()]).optional(),
    stock_quantity: z.union([integerString(), z.number().int().nonnegative()]).optional(),
    stock_status: z.enum(["instock", "outofstock", "onbackorder"]).optional(),
    sku: boundedString(100).optional(),
    description: boundedString(10000).optional(),
    short_description: boundedString(5000).optional(),
    category_ids: z.array(positiveId).optional(),
    categories: z.array(z.union([positiveId, z.object({ id: positiveId })])).optional(),
    image_id: z.union([z.literal(""), positiveId]).optional(),
    image_url: z.string().trim().max(2000).optional(),
    images: z.array(z.union([positiveId, z.string().trim().max(2000), z.record(z.string(), z.any())])).optional(),
  }),
  categoryCreate: z.object({
    name: boundedString(200).min(1),
    image_id: z.union([z.literal(""), positiveId]).optional(),
    image_url: z.string().trim().max(2000).optional(),
    description: boundedString(5000).optional(),
  }),
  categoryUpdate: z.object({
    name: boundedString(200).min(1).optional(),
    image_id: z.union([z.literal(""), positiveId]).optional(),
    image_url: z.string().trim().max(2000).optional(),
    description: boundedString(5000).optional(),
  }),
  categoryReorder: z.object({
    category_ids: z.array(positiveId).min(1).max(500),
  }),
  orderStatus: z.object({
    status: z.enum(["pending", "processing", "packed", "out-for-delivery", "dispatched", "completed", "cancelled", "failed"]),
  }),
  employeeAccess: z.object({
    email,
    role: z.literal("employee").optional(),
    notes: boundedString(500).optional(),
  }),
  employeeRole: z.object({ role: z.literal("employee").optional() }),
  employeeReject: z.object({ reason: boundedString(500).optional() }),
  employeeStatus: z.object({ status: z.enum(["active", "deactivated"]) }),
  suspension: z.object({
    email,
    duration: z.enum(["3_months", "6_months", "permanent"]),
    reason: boundedString(1000).optional(),
  }),
  suspensionLookup: z.object({ email }),
  unsuspension: z.object({ email }),
  storeHoursUpdate: z.object({
    manual_override: z.enum(["auto", "open", "closed"]).optional(),
    schedule: z.record(z.string(), z.object({
      open: z.string().trim().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
      close: z.string().trim().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
      is_enabled: z.boolean().optional(),
      enabled: z.boolean().optional(),
    })).optional(),
    notice_message: boundedString(1000).optional(),
    closed_message: boundedString(1000).optional(),
    is_peak_hours: z.boolean().optional(),
    peak_delivery_text: boundedString(200).optional(),
    normal_delivery_text: boundedString(200).optional(),
    peak_notice_message: boundedString(1000).optional(),
    peak_notice: boundedString(1000).optional(),
  }),
  storeHoursPeakToggle: z.object({
    is_peak_hours: z.boolean().optional(),
    peak_delivery_text: boundedString(200).optional(),
    normal_delivery_text: boundedString(200).optional(),
    peak_notice_message: boundedString(1000).optional(),
    peak_notice: boundedString(1000).optional(),
  }),
  review: z.object({
    rating: z.coerce.number().int().min(1).max(5),
    review: boundedString(2000).min(1),
  }),
  paymentCreateOrder: z.object({
    order_id: positiveId.optional(),
    billing_address: z.object({
      first_name: boundedString(100).optional(),
      last_name: boundedString(100).optional(),
      email: email.optional(),
      phone: boundedString(20).optional(),
      secondary_phone: boundedString(30).optional().nullable(),
      address_1: boundedString(200).optional(),
      address_2: boundedString(200).optional(),
      city: boundedString(100).optional(),
      state: boundedString(100).optional(),
      postcode: boundedString(20).optional(),
      country: boundedString(10).optional(),
    }).optional(),
    shipping_address: z.object({
      first_name: boundedString(100).optional(),
      last_name: boundedString(100).optional(),
      phone: boundedString(20).optional(),
      secondary_phone: boundedString(30).optional().nullable(),
      address_1: boundedString(200).optional(),
      address_2: boundedString(200).optional(),
      city: boundedString(100).optional(),
      state: boundedString(100).optional(),
      postcode: boundedString(20).optional(),
      country: boundedString(10).optional(),
    }).optional(),
  }),
  paymentVerify: z.object({
    order_id: positiveId.optional().nullable(),
    razorpay_order_id: boundedString(100),
    razorpay_payment_id: boundedString(100),
    razorpay_signature: boundedString(256),
  }),
  paymentCheckStatus: z.object({
    razorpay_order_id: boundedString(100),
  }),
  paymentCancel: z.object({
    razorpay_order_id: boundedString(100),
  }),
  address: z.object({
    type: z.enum(["home", "office"]).optional(),
    first_name: personName(100).optional(),
    last_name: personName(100).optional(),
    firstName: personName(100).optional(),
    lastName: personName(100).optional(),
    name: personName(200).optional(),
    full_name: personName(200).optional(),
    address_line1: boundedString(200).optional(),
    address_line2: boundedString(200).optional(),
    city: boundedString(100).optional(),
    state: boundedString(100).optional(),
    pincode: boundedString(20).optional(),
    phone: boundedString(30).optional(),
  }),
  profile: z.object({
    first_name: personName(100).optional(),
    last_name: personName(100).optional(),
    firstName: personName(100).optional(),
    lastName: personName(100).optional(),
    name: personName(200).optional(),
    full_name: personName(200).optional(),
    age: z.union([z.number().int().min(1).max(120), integerString(3)]).optional(),
    phone: indianMobile.optional(),
    secondary_phone: indianMobile.optional().nullable(),
  }),
  idParam: z.object({ id: positiveId }),
  addressIdParam: z.object({
    id: z.string().trim().regex(/^[a-zA-Z0-9-]+$/).min(1).max(64),
  }),
  categoryIdParam: z.object({ categoryId: positiveId }),
  productIdParam: z.object({ productId: positiveId }),
  reviewIdParam: z.object({ reviewId: positiveId }),
  analyticsReport: z.object({
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    product_id: positiveId.optional(),
    refresh: z.enum(["0", "1", "true", "false"]).optional(),
  }),
  pagination: z.object({
    page: z.coerce.number().int().positive().max(10000).optional(),
    per_page: z.coerce.number().int().positive().max(100).optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    format: boundedString(32).optional(),
    paginated: z.enum(["0", "1", "true", "false"]).optional(),
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
  }),
  productsByIds: z.object({
    ids: z.string().trim().min(1).max(131).regex(/^\d+(,\d+){0,11}$/),
    fresh: z.enum(["0", "1"]).optional(),
  }),
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
