import wp from "../services/wordpress.js";
import { invalidateUserSessionCache } from "../middlewares/authMiddleware.js";
import { logAuditEvent } from "../utils/auditLogger.js";
import { logError } from "../utils/logger.js";

const ALLOWED_EMPLOYEE_ROLES = ["employee"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Get staff directory and pending employee access requests
 */
export const getAdminEmployees = async (req, res) => {
  try {
    const { search, status } = req.query;

    const response = await wp.get("/wp-json/mumbai-auth/v1/admin/employees", {
      headers: {
        "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
      },
      params: {
        search: search || undefined,
        status: status || undefined,
      },
    });

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Get admin employees error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || "Failed to load employee list.",
      employees: [],
    });
  }
};

/**
 * Add an email to pending approval or allowlist
 */
export const requestEmployeeAccess = async (req, res) => {
  try {
    const { email, role = "employee", notes = "" } = req.body;

    if (!email || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: "A valid email address is required.",
      });
    }

    if (!ALLOWED_EMPLOYEE_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Only 'employee' can be requested.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/admin/employees/access",
      {
        email: normalizedEmail,
        role: "employee",
        notes: notes ? String(notes).slice(0, 500) : "",
        admin_id: req.wpUserId || req.user?.id || 0,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    logAuditEvent({
      req,
      action: "employee.access_requested",
      targetType: "employee_candidate",
      targetId: normalizedEmail,
      details: { role: "employee", is_registered: response.data?.is_registered },
    });

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Request employee access error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || "Failed to request employee access.",
    });
  }
};

/**
 * Approve employee access with employee role
 */
export const approveEmployee = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const { role = "employee" } = req.body;

    if (!targetUserId || isNaN(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required.",
      });
    }

    if (Number(req.wpUserId) === targetUserId || Number(req.user?.id) === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Administrators cannot approve their own account via employee access.",
      });
    }

    if (!ALLOWED_EMPLOYEE_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Only 'employee' can be assigned.",
      });
    }

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/admin/employees/approve",
      {
        user_id: targetUserId,
        role: "employee",
        approved_by: req.wpUserId || req.user?.id || 0,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    // Invalidate cached server-side sessions
    invalidateUserSessionCache(targetUserId);

    logAuditEvent({
      req,
      action: "employee.approved",
      targetType: "employee",
      targetId: targetUserId,
      details: { assigned_role: role },
    });

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Approve employee error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || "Failed to approve employee.",
    });
  }
};

/**
 * Reject employee access request
 */
export const rejectEmployee = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const { reason = "" } = req.body;

    if (!targetUserId || isNaN(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required.",
      });
    }

    if (Number(req.wpUserId) === targetUserId || Number(req.user?.id) === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Administrators cannot reject their own account.",
      });
    }

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/admin/employees/reject",
      {
        user_id: targetUserId,
        reason: reason ? String(reason).slice(0, 500) : "",
        rejected_by: req.wpUserId || req.user?.id || 0,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    invalidateUserSessionCache(targetUserId);

    logAuditEvent({
      req,
      action: "employee.rejected",
      targetType: "employee",
      targetId: targetUserId,
      details: { reason },
    });

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Reject employee error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || "Failed to reject employee request.",
    });
  }
};

/**
 * Deactivate or Reactivate employee access
 */
export const updateEmployeeStatus = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const { status } = req.body;

    if (!targetUserId || isNaN(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required.",
      });
    }

    if (Number(req.wpUserId) === targetUserId || Number(req.user?.id) === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Administrators cannot deactivate their own account.",
      });
    }

    if (!["active", "deactivated"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be either 'active' or 'deactivated'.",
      });
    }

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/admin/employees/status",
      {
        user_id: targetUserId,
        status,
        updated_by: req.wpUserId || req.user?.id || 0,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    invalidateUserSessionCache(targetUserId);

    logAuditEvent({
      req,
      action: status === "deactivated" ? "employee.deactivated" : "employee.reactivated",
      targetType: "employee",
      targetId: targetUserId,
      details: { status },
    });

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Update employee status error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || "Failed to update employee status.",
    });
  }
};

/**
 * Revoke all active sessions for an employee
 */
export const revokeEmployeeSessions = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);

    if (!targetUserId || isNaN(targetUserId)) {
      return res.status(400).json({
        success: false,
        message: "Valid User ID is required.",
      });
    }

    if (Number(req.wpUserId) === targetUserId || Number(req.user?.id) === targetUserId) {
      return res.status(400).json({
        success: false,
        message: "Use the standard logout function to terminate your own admin session.",
      });
    }

    const response = await wp.post(
      "/wp-json/mumbai-auth/v1/admin/employees/revoke-sessions",
      {
        user_id: targetUserId,
      },
      {
        headers: {
          "X-Mumbai-Internal-Key": process.env.MUMBAI_INTERNAL_API_KEY,
        },
      }
    );

    invalidateUserSessionCache(targetUserId);

    logAuditEvent({
      req,
      action: "employee.sessions_revoked",
      targetType: "employee",
      targetId: targetUserId,
    });

    return res.json(response.data);
  } catch (error) {
    logError(req, error, "Revoke employee sessions error");
    const statusCode = error.response?.status || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.response?.data?.message || "Failed to revoke employee sessions.",
    });
  }
};
