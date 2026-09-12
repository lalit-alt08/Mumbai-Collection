import wp from "../services/wordpress.js";
import { invalidateUserSessionCache } from "../middlewares/authMiddleware.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { logError } from "../utils/logger.js";

/**
 * Look up customer suspension status and account details by email
 */
export const lookupCustomerSuspension = async (req, res) => {
  try {
    const { email } = req.query;

    if (!email || !String(email).trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer email is required.",
      });
    }

    const response = await wp.get(
      "/wp-json/mumbai-auth/v1/admin/customer-suspension/lookup",
      {
        params: { email: String(email).trim().toLowerCase() },
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Lookup customer suspension error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Failed to look up customer suspension status.",
    });
  }
};

/**
 * Suspend a registered customer account
 */
export const suspendCustomer = async (req, res) => {
  try {
    const { email, duration, reason } = req.body;

    if (!email || !String(email).trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer email is required.",
      });
    }

    if (!duration || !String(duration).trim()) {
      return res.status(400).json({
        success: false,
        message: "Suspension duration is required (3 months, 6 months, or Permanent).",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const adminId = req.wpUserId || req.user?.id || 0;

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/admin/customer-suspension/suspend",
      {
        email: cleanEmail,
        duration: String(duration).trim(),
        reason: reason ? String(reason).trim() : "",
        admin_id: adminId,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    const customerId = response.data?.customer?.id;
    if (customerId) {
      invalidateUserSessionCache(customerId);
    }

    logAuditEvent({
      req,
      action: "customer.suspended",
      targetType: "customer",
      targetId: customerId || cleanEmail,
      details: {
        email: cleanEmail,
        duration: response.data?.customer?.duration || duration,
        expires_at: response.data?.customer?.expires_at,
        is_permanent: response.data?.customer?.is_permanent,
        reason: reason ? String(reason).trim() : undefined,
      },
    });

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Suspend customer error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message:
        error.response?.data?.message || "Failed to suspend customer account.",
    });
  }
};

/**
 * Remove suspension from a customer account
 */
export const unsuspendCustomer = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !String(email).trim()) {
      return res.status(400).json({
        success: false,
        message: "Customer email is required.",
      });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const adminId = req.wpUserId || req.user?.id || 0;

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/admin/customer-suspension/unsuspend",
      {
        email: cleanEmail,
        admin_id: adminId,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    const customerId = response.data?.customer?.id;
    if (customerId) {
      invalidateUserSessionCache(customerId);
    }

    logAuditEvent({
      req,
      action: "customer.unsuspended",
      targetType: "customer",
      targetId: customerId || cleanEmail,
      details: {
        email: cleanEmail,
      },
    });

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Unsuspend customer error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Failed to remove customer suspension.",
    });
  }
};
