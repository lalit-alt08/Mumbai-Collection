import axios from "axios";
import API_URL from "../config/api.js";
import { getSafeInternalPath } from "./navigation.js";

const isCartPath = (path) =>
  path === "/cart" ||
  path.startsWith("/cart?") ||
  path.startsWith("/cart#") ||
  path === "/checkout" ||
  path.startsWith("/checkout?") ||
  path.startsWith("/checkout#");

export async function fetchProfileCompletion() {
  const response = await axios.get(`${API_URL}/profile/complete`, {
    withCredentials: true,
    headers: { "X-Mumbai-Panel": "customer" },
    timeout: 5000,
  });
  return response.data;
}

/**
 * Resolves where to navigate a customer immediately after sign-in or registration.
 *
 * Returns one of:
 * - { status: "cancelled" } when the initiating auth attempt is no longer active
 * - { status: "unauthorized", pathname: "/login", state: { from, message } } on 401
 * - { status: "incomplete", pathname: "/profile-setup", state: { from, first_name, last_name } }
 * - { status: "complete", pathname }
 * - { status: "unavailable", pathname, state: { profileCheckUnavailable: true } }
 * - { status: "cart_unavailable", pathname: "/", state: { cartCheckUnavailable: true } }
 * - { status: "default", pathname } for non-cart flows
 */
export async function resolvePostAuthDestination({
  from,
  hasCartItems = false,
  user = null,
  firstName = "",
  lastName = "",
  isNewUser = false,
  checkAuthenticatedCart = null,
  checkProfileComplete = fetchProfileCompletion,
  isAttemptActive = () => true,
} = {}) {
  const safeReturn = getSafeInternalPath(from, "/");
  const cartOrigin = isCartPath(safeReturn);
  let effectiveHasCartItems = Boolean(hasCartItems);

  // When a brand new user registers or signs up via Google SSO:
  // ONLY prompt for delivery address (/profile-setup) if they signed up from the cart or checkout.
  // Otherwise, redirect them to Home with an "Account created successfully!" confirmation message.
  if (isNewUser) {
    if (cartOrigin) {
      const cartDestination = safeReturn;
      try {
        const status = await checkProfileComplete();
        if (!isAttemptActive()) {
          return { status: "cancelled" };
        }

        if (status && typeof status === "object" && status.complete === false) {
          return {
            status: "incomplete",
            pathname: "/profile-setup",
            state: {
              from: cartDestination,
              first_name: firstName || user?.first_name || "",
              last_name: lastName || user?.last_name || "",
            },
          };
        }

        if (status && typeof status === "object" && status.complete === true) {
          return { status: "complete", pathname: cartDestination };
        }

        return {
          status: "unavailable",
          pathname: cartDestination,
          state: { profileCheckUnavailable: true },
        };
      } catch (err) {
        if (!isAttemptActive()) {
          return { status: "cancelled" };
        }

        if (err?.response?.status === 401) {
          return {
            status: "unauthorized",
            pathname: "/login",
            state: {
              from: cartDestination,
              message: "Your session expired. Please sign in again to continue.",
            },
          };
        }

        return {
          status: "unavailable",
          pathname: cartDestination,
          state: { profileCheckUnavailable: true },
        };
      }
    }

    return {
      status: "default",
      pathname: "/",
      state: {
        accountCreated: true,
        message: "Account created successfully!",
      },
    };
  }

  // If the customer signed in from Header/Home (no explicit protected destination)
  // with an empty guest cart, wait for the authenticated account cart to confirm
  // whether they already have saved items waiting for checkout.
  if (!cartOrigin && safeReturn === "/" && !effectiveHasCartItems && typeof checkAuthenticatedCart === "function") {
    try {
      const authCartResult = await checkAuthenticatedCart();
      if (!isAttemptActive()) {
        return { status: "cancelled" };
      }

      const isStructured =
        authCartResult &&
        typeof authCartResult === "object" &&
        typeof authCartResult.status === "string";

      if (isStructured) {
        if (authCartResult.status !== "confirmed" || !Array.isArray(authCartResult.cart?.items)) {
          return {
            status: "cart_unavailable",
            pathname: "/",
            state: { cartCheckUnavailable: true },
          };
        }
        if (authCartResult.cart.items.length > 0) {
          effectiveHasCartItems = true;
        }
      } else if (authCartResult && Array.isArray(authCartResult.items)) {
        if (authCartResult.items.length > 0) {
          effectiveHasCartItems = true;
        }
      } else {
        return {
          status: "cart_unavailable",
          pathname: "/",
          state: { cartCheckUnavailable: true },
        };
      }
    } catch {
      if (!isAttemptActive()) {
        return { status: "cancelled" };
      }
      return {
        status: "cart_unavailable",
        pathname: "/",
        state: { cartCheckUnavailable: true },
      };
    }
  }

  if (!isAttemptActive()) {
    return { status: "cancelled" };
  }

  const isCartFlow = cartOrigin || (safeReturn === "/" && effectiveHasCartItems);
  if (!isCartFlow) {
    return { status: "default", pathname: safeReturn };
  }

  const cartDestination = cartOrigin ? safeReturn : "/cart";

  try {
    const status = await checkProfileComplete();
    if (!isAttemptActive()) {
      return { status: "cancelled" };
    }

    if (status && typeof status === "object" && status.complete === false) {
      return {
        status: "incomplete",
        pathname: "/profile-setup",
        state: {
          from: cartDestination,
          first_name: firstName || user?.first_name || "",
          last_name: lastName || user?.last_name || "",
        },
      };
    }

    if (status && typeof status === "object" && status.complete === true) {
      return { status: "complete", pathname: cartDestination };
    }

    // Missing or malformed `complete` field is treated as an unavailable check,
    // never silently assumed to be a complete profile.
    return {
      status: "unavailable",
      pathname: cartDestination,
      state: { profileCheckUnavailable: true },
    };
  } catch (err) {
    if (!isAttemptActive()) {
      return { status: "cancelled" };
    }

    if (err?.response?.status === 401) {
      return {
        status: "unauthorized",
        pathname: "/login",
        state: {
          from: cartDestination,
          message: "Your session expired. Please sign in again to continue.",
        },
      };
    }

    // Transient 503/network error: fail open to cart with a retryable notice
    // while final checkout still enforces valid delivery details.
    return {
      status: "unavailable",
      pathname: cartDestination,
      state: { profileCheckUnavailable: true },
    };
  }
}

/**
 * Orchestrates post-authentication navigation for Login, Register, and GoogleAuthButton:
 * checks attempt/session freshness after async cart and profile calls, clears expired
 * sessions on 401 while preserving cart return state, and navigates only while active.
 */
export async function executePostAuthNavigation({
  from,
  hasCartItems = false,
  user = null,
  firstName = "",
  lastName = "",
  isNewUser = false,
  waitForAuthenticatedCart = null,
  checkProfileComplete = fetchProfileCompletion,
  isAttemptActive = () => true,
  handleSessionExpired = null,
  navigate = null,
  onUnauthorized = null,
} = {}) {
  const destination = await resolvePostAuthDestination({
    from,
    hasCartItems,
    user,
    firstName,
    lastName,
    isNewUser,
    checkAuthenticatedCart:
      user?.id && typeof waitForAuthenticatedCart === "function"
        ? () => waitForAuthenticatedCart(user.id)
        : null,
    checkProfileComplete,
    isAttemptActive,
  });

  if (destination.status === "cancelled" || !isAttemptActive()) {
    return { status: "cancelled" };
  }

  if (destination.status === "unauthorized") {
    if (typeof handleSessionExpired === "function") {
      handleSessionExpired();
    }
    if (typeof onUnauthorized === "function") {
      onUnauthorized(
        destination.state?.message || "Your session expired. Please sign in again to continue.",
        destination.state
      );
    }
    if (typeof navigate === "function") {
      navigate(destination.pathname, { replace: true, state: destination.state });
    }
    return destination;
  }

  if (typeof navigate === "function") {
    navigate(destination.pathname, { replace: true, state: destination.state });
  }
  return destination;
}

/**
 * Guards Cart's "Retry profile check" action against unmount, account switches,
 * or overlapping retry requests so a stale response can never redirect or clear
 * another session.
 */
export async function executeCartProfileRetry({
  user = null,
  checkProfileComplete = fetchProfileCompletion,
  isRetryActive = () => true,
  onComplete = null,
  onIncomplete = null,
  handleSessionExpired = null,
  navigate = null,
} = {}) {
  try {
    const status = await checkProfileComplete();
    if (!isRetryActive()) {
      return { status: "cancelled" };
    }

    if (status && typeof status === "object" && status.complete === false) {
      if (typeof onIncomplete === "function") onIncomplete();
      if (typeof navigate === "function") {
        navigate("/profile-setup", {
          replace: true,
          state: {
            from: "/cart",
            first_name: user?.first_name || "",
            last_name: user?.last_name || "",
          },
        });
      }
      return { status: "incomplete" };
    }

    if (status && typeof status === "object" && status.complete === true) {
      if (typeof onComplete === "function") onComplete();
      return { status: "complete" };
    }

    return { status: "unavailable" };
  } catch (err) {
    if (!isRetryActive()) {
      return { status: "cancelled" };
    }

    if (err?.response?.status === 401) {
      if (typeof handleSessionExpired === "function") {
        handleSessionExpired();
      }
      if (typeof navigate === "function") {
        navigate("/login", {
          replace: true,
          state: {
            from: "/cart",
            message: "Your session expired. Please sign in again to continue.",
          },
        });
      }
      return { status: "unauthorized" };
    }

    return { status: "unavailable" };
  }
}
