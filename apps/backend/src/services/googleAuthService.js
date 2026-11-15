import { OAuth2Client } from "google-auth-library";

export const isAllowedGoogleOrigin = (origin) => {
  if (!origin) return false;

  const normalizeOrigin = (value) => {
    try {
      return new URL(value).origin.toLowerCase();
    } catch (_) {
      return "";
    }
  };

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  const staffOrigins = new Set(
    [
      ...String(process.env.ADMIN_ORIGIN || "").split(","),
      ...String(process.env.EMPLOYEE_ORIGIN || "").split(","),
    ]
      .map((value) => normalizeOrigin(value.trim()))
      .filter(Boolean)
  );

  const customerOrigins = new Set(
    [
      ...String(process.env.CUSTOMER_ORIGIN || "").split(","),
      ...String(process.env.FRONTEND_URL || "").split(","),
      ...String(process.env.CLIENT_ORIGIN || "").split(","),
      ...String(process.env.ALLOWED_ORIGINS || "")
        .split(",")
        .filter((val) => !val.includes("admin") && !val.includes("employee")),
    ]
      .map((value) => normalizeOrigin(value.trim()))
      .filter(Boolean)
  );

  if (process.env.NODE_ENV !== "production") {
    customerOrigins.add("http://localhost:5173");
    customerOrigins.add("http://127.0.0.1:5173");
  }

  for (const staffOrigin of staffOrigins) {
    customerOrigins.delete(staffOrigin);
  }

  return customerOrigins.has(normalized);
};

export const verifyGoogleAuthPayload = async (req) => {
  const { credential, code } = req.body;

  if (Boolean(credential) === Boolean(code)) {
    return {
      status: 400,
      payload: {
        success: false,
        message: "Provide either a Google ID credential or an authorization code.",
      },
    };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return {
      status: 500,
      payload: {
        success: false,
        message: "Google Auth is not configured on the server",
      },
    };
  }

  let ticket;

  if (credential) {
    const client = new OAuth2Client(clientId);
    ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
  } else {
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const origin = req.headers?.origin;
    if (!clientSecret) {
      return {
        status: 500,
        payload: {
          success: false,
          message: "Google authorization-code exchange is not configured on the server.",
        },
      };
    }
    if (!isAllowedGoogleOrigin(origin) || req.headers?.["x-requested-with"] !== "XMLHttpRequest") {
      return {
        status: 403,
        payload: {
          success: false,
          message: "Google sign-in request could not be verified. Please try again.",
        },
      };
    }

    const client = new OAuth2Client(clientId, clientSecret, origin);
    const tokenResponse = await client.getToken({ code, redirect_uri: origin });
    if (!tokenResponse.tokens?.id_token) {
      return {
        status: 400,
        payload: {
          success: false,
          message: "Google did not return a verifiable identity token.",
        },
      };
    }
    ticket = await client.verifyIdToken({
      idToken: tokenResponse.tokens.id_token,
      audience: clientId,
    });
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.email || !payload.sub) {
    return {
      status: 400,
      payload: {
        success: false,
        message: "Invalid Google token payload",
      },
    };
  }

  if (payload.email_verified !== true) {
    return {
      status: 400,
      payload: {
        success: false,
        message: "Google email is not verified",
      },
    };
  }

  return {
    success: true,
    data: {
      email: payload.email,
      name: payload.name || "Customer",
      google_sub: payload.sub,
    },
  };
};
