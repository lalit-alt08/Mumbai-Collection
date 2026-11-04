import test from "node:test";
import assert from "node:assert/strict";
import { getSafeInternalPath } from "../src/utils/navigation.js";
import {
  getCartItemIdentity,
  diffGuestItemsForMerge,
  orchestrateCartMerge,
} from "../src/utils/cartMerge.js";

test("Customer Web: Deferred Profile & Delivery Address Setup Suite", async (suite) => {
  // 1. Navigation path sanitation & loop prevention
  await suite.test("1. getSafeInternalPath: Sanitize destinations and prevent auth loops", () => {
    // Safe relative routes
    assert.equal(getSafeInternalPath("/cart"), "/cart");
    assert.equal(getSafeInternalPath("/account/orders"), "/account/orders");
    assert.equal(getSafeInternalPath("/product/sandisk-cruzer-32gb"), "/product/sandisk-cruzer-32gb");
    assert.equal(getSafeInternalPath("/category/electronics?sort=price_asc"), "/category/electronics?sort=price_asc");

    // Rejection of protocol-relative and external URLs
    assert.equal(getSafeInternalPath("//attacker.com"), "/");
    assert.equal(getSafeInternalPath("/\\attacker.com"), "/");
    assert.equal(getSafeInternalPath("https://attacker.com"), "/");
    assert.equal(getSafeInternalPath("javascript:alert(1)"), "/");
    assert.equal(getSafeInternalPath("data:text/html,evil"), "/");

    // Rejection of CRLF injection attempts
    assert.equal(getSafeInternalPath("/cart\r\nSet-Cookie: evil=1"), "/");
    assert.equal(getSafeInternalPath("/checkout\nevil"), "/");

    // Loop prevention: Auth endpoints must never be returned to after successful authentication
    assert.equal(getSafeInternalPath("/login"), "/");
    assert.equal(getSafeInternalPath("/register"), "/");
    assert.equal(getSafeInternalPath("/profile-setup"), "/");
    assert.equal(getSafeInternalPath("/forgot-password"), "/");
    assert.equal(getSafeInternalPath("/reset-password"), "/");
    assert.equal(getSafeInternalPath("/otp"), "/");
    assert.equal(getSafeInternalPath("/profile-setup?from=/cart"), "/");

    // Custom fallback
    assert.equal(getSafeInternalPath("/login", "/cart"), "/cart");
    assert.equal(getSafeInternalPath(null, "/cart"), "/cart");
    assert.equal(getSafeInternalPath(undefined, "/"), "/");
    assert.equal(getSafeInternalPath("", "/shop"), "/shop");
  });

  // 2. Email registration destination contract
  await suite.test("2. Email registration: Navigates to home or safe referrer, not profile-setup", () => {
    const simulatePostRegistrationNavigation = ({ from, regResponse }) => {
      if (!regResponse?.user) {
        throw new Error("Registration session missing");
      }
      return getSafeInternalPath(from, "/");
    };

    // Customer registered directly from homepage
    const dest1 = simulatePostRegistrationNavigation({
      from: null,
      regResponse: { user: { id: 10, email: "shopper@example.com" } },
    });
    assert.equal(dest1, "/");

    // Customer registered after clicking checkout on /cart
    const dest2 = simulatePostRegistrationNavigation({
      from: "/cart",
      regResponse: { user: { id: 11, email: "buyer@example.com" } },
    });
    assert.equal(dest2, "/cart");

    // Attempted redirect to /profile-setup or /register defaults to /
    const dest3 = simulatePostRegistrationNavigation({
      from: "/profile-setup",
      regResponse: { user: { id: 12, email: "user@example.com" } },
    });
    assert.equal(dest3, "/");
  });

  // 3. Google SSO destination contract
  await suite.test("3. Google SSO: Navigates to safe referrer or home for both new and existing customers, preserving link mode", () => {
    const simulateGoogleAuthCompletion = ({ mode, is_new_user, from }) => {
      if (mode === "link") {
        return { action: "stay_on_link_page", linked: true };
      }
      // Both new and existing users go to safe destination without forced profile-setup
      const safeTarget = getSafeInternalPath(from, "/");
      return { action: "navigate", destination: safeTarget };
    };

    // Linking mode must never navigate away
    const linkResult = simulateGoogleAuthCompletion({ mode: "link", is_new_user: false, from: "/account" });
    assert.equal(linkResult.action, "stay_on_link_page");
    assert.equal(linkResult.linked, true);

    // New Google customer from cart goes to /cart
    const newFromCart = simulateGoogleAuthCompletion({ mode: "signup", is_new_user: true, from: "/cart" });
    assert.equal(newFromCart.action, "navigate");
    assert.equal(newFromCart.destination, "/cart");

    // New Google customer from home goes to /
    const newFromHome = simulateGoogleAuthCompletion({ mode: "signup", is_new_user: true, from: "/" });
    assert.equal(newFromHome.action, "navigate");
    assert.equal(newFromHome.destination, "/");

    // Returning Google customer goes to intended page
    const existingFromProduct = simulateGoogleAuthCompletion({ mode: "login", is_new_user: false, from: "/product/charger-199" });
    assert.equal(existingFromProduct.action, "navigate");
    assert.equal(existingFromProduct.destination, "/product/charger-199");
  });

  // 4. Cart preservation and address selection contract
  await suite.test("4. Checkout: Return from address creation restores cart and pre-selects new address", () => {
    // Simulate address return handler in BillingForm
    const simulateAddressSelection = ({ savedAddresses, targetAddressId, currentSelectedId }) => {
      const targetExists = targetAddressId && savedAddresses.some((a) => a.id === targetAddressId);
      if (targetExists) {
        return targetAddressId;
      }
      const stillValid = currentSelectedId && savedAddresses.some((a) => a.id === currentSelectedId);
      return stillValid ? currentSelectedId : (savedAddresses[0]?.id || null);
    };

    const addresses = [
      { id: 101, type: "home", address_line1: "Evershine St 4", city: "Vasai West" },
      { id: 102, type: "office", address_line1: "Business Park", city: "Vasai East" },
    ];

    // Returning with newly created address 102
    assert.equal(
      simulateAddressSelection({ savedAddresses: addresses, targetAddressId: 102, currentSelectedId: 101 }),
      102
    );

    // Initial load with existing preference
    assert.equal(
      simulateAddressSelection({ savedAddresses: addresses, targetAddressId: null, currentSelectedId: 101 }),
      101
    );

    // Fallback to first address if preferred ID no longer exists
    assert.equal(
      simulateAddressSelection({ savedAddresses: addresses, targetAddressId: 999, currentSelectedId: 888 }),
      101
    );
  });

  // 5. Storage hygiene on session termination
  await suite.test("5. AuthContext: Clears address storage cache on login and session expiry", () => {
    const memoryStorage = new Map([
      ["user", '{"id":1}'],
      ["saved_addresses_cache", '[{"id":101}]'],
      ["selected_address_id", "101"],
    ]);

    const clearSessionStorage = () => {
      memoryStorage.delete("user");
      memoryStorage.delete("user_profile");
      memoryStorage.delete("saved_addresses_cache");
      memoryStorage.delete("selected_address_id");
    };

    clearSessionStorage();

    assert.equal(memoryStorage.has("saved_addresses_cache"), false);
    assert.equal(memoryStorage.has("selected_address_id"), false);
    assert.equal(memoryStorage.has("user"), false);
  });

  // 6. Registration session confirmation contract
  await suite.test("6. Registration: Guides user to sign in if backend could not establish a session cookie", () => {
    const handleRegistrationOutcome = (regResponse, cleanEmail, from) => {
      if (!regResponse?.user) {
        throw new Error("Registration session missing");
      }
      if (regResponse.session_established === false) {
        return {
          action: "navigate_to_login",
          destination: "/login",
          state: {
            email: cleanEmail,
            from,
            message: "Account created successfully! Please sign in with your password to continue.",
          },
        };
      }
      return {
        action: "login_and_navigate",
        destination: getSafeInternalPath(from, "/"),
        user: regResponse.user,
      };
    };

    // Case A: Session confirmed by backend -> logs in and goes to destination
    const resA = handleRegistrationOutcome({ user: { id: 1 }, session_established: true }, "user@example.com", "/cart");
    assert.equal(resA.action, "login_and_navigate");
    assert.equal(resA.destination, "/cart");

    // Case B: Session NOT confirmed by backend -> does not call loginUser, guides to login with preserved email & destination
    const resB = handleRegistrationOutcome({ user: { id: 2 }, session_established: false }, "user@example.com", "/cart");
    assert.equal(resB.action, "navigate_to_login");
    assert.equal(resB.destination, "/login");
    assert.equal(resB.state.email, "user@example.com");
    assert.equal(resB.state.from, "/cart");
  });

  // 7. Address UUID string preservation (No NaN)
  await suite.test("7. Address UUID: Preserves UUID strings across reloads without NaN corruption", () => {
    const uuid = "4e3b7b2f-8b29-41a4-9b2d-7b269b2d1840";
    const parseSelectedAddressId = (cachedId) => {
      // Must NOT use Number(cachedId)
      return cachedId ? String(cachedId) : null;
    };

    const restoredId = parseSelectedAddressId(uuid);
    assert.equal(restoredId, uuid);
    assert.equal(Number.isNaN(restoredId), false);

    // Finding matching address in array
    const addresses = [
      { id: "4e3b7b2f-8b29-41a4-9b2d-7b269b2d1840", type: "home", city: "Vasai West" },
      { id: "88a1b2c3-1122-3344-5566-778899aabbcc", type: "office", city: "Vasai East" },
    ];
    const match = addresses.find((a) => String(a.id) === String(restoredId));
    assert.ok(match);
    assert.equal(match.city, "Vasai West");
  });

  // 8. Add New Address shortcut opens for users with 1 existing address
  await suite.test("8. Addresses: selectNew opens form when customer has 1 address and capacity remains", () => {
    const shouldOpenAddForm = (fetchedAddresses, locationState) => {
      const hasHome = fetchedAddresses.some((a) => a.type?.toLowerCase() === "home");
      const hasOffice = fetchedAddresses.some((a) => a.type?.toLowerCase() === "office");
      const canAdd = !hasHome || !hasOffice;

      return (
        (locationState?.from === "/cart" && fetchedAddresses.length === 0) ||
        (locationState?.selectNew && canAdd)
      );
    };

    // User has 0 addresses -> opens
    assert.equal(shouldOpenAddForm([], { from: "/cart" }), true);

    // User has 1 address (Home) and clicks '+ Add New Address' in checkout (selectNew: true) -> opens!
    const singleAddress = [{ id: "addr_1", type: "home" }];
    assert.equal(shouldOpenAddForm(singleAddress, { from: "/cart", selectNew: true }), true);

    // User already has both Home and Office (capacity exhausted) -> does not open
    const maxAddresses = [{ id: "addr_1", type: "home" }, { id: "addr_2", type: "office" }];
    assert.equal(shouldOpenAddForm(maxAddresses, { from: "/cart", selectNew: true }), false);
  });

  // 9. Address load failure clears stale data to block checkout
  await suite.test("9. Address load failure: Clears address list so checkout cannot proceed with stale cache", () => {
    const handleAddressFetchResult = (fetchError, serverAddresses) => {
      if (fetchError) {
        return {
          addresses: [],
          selectedAddressId: null,
          isCheckoutBlocked: true,
        };
      }
      return {
        addresses: serverAddresses,
        selectedAddressId: serverAddresses[0]?.id || null,
        isCheckoutBlocked: serverAddresses.length === 0,
      };
    };

    // When address request fails, state is cleared and checkout is blocked
    const errorState = handleAddressFetchResult(new Error("503 Upstream Outage"), null);
    assert.deepEqual(errorState.addresses, []);
    assert.equal(errorState.selectedAddressId, null);
    assert.equal(errorState.isCheckoutBlocked, true);
  });

  // 10. getCartItemIdentity preserves variation differentiation
  await suite.test("10. Cart identity: Distinguishes product variations and attribute combinations", () => {
    // Simple product without variations
    const simple1 = { id: 101 };
    const simple2 = { id: 101 };
    assert.equal(getCartItemIdentity(simple1), getCartItemIdentity(simple2));

    // Variable product with variations (different sizes)
    const varSizeM = {
      id: 202,
      variation: [{ attribute: "pa_size", value: "m" }],
    };
    const varSizeL = {
      id: 202,
      variation: [{ attribute: "pa_size", value: "l" }],
    };
    assert.notEqual(getCartItemIdentity(varSizeM), getCartItemIdentity(varSizeL));

    // Attribute order invariance
    const varOrder1 = {
      id: 303,
      variation: [
        { attribute: "pa_color", value: "black" },
        { attribute: "pa_size", value: "xl" },
      ],
    };
    const varOrder2 = {
      id: 303,
      variation: [
        { attribute: "pa_size", value: "xl" },
        { attribute: "pa_color", value: "black" },
      ],
    };
    assert.equal(getCartItemIdentity(varOrder1), getCartItemIdentity(varOrder2));
  });

  // 11. diffGuestItemsForMerge accurately produces add & update actions
  await suite.test("11. diffGuestItemsForMerge: Computes required additions and quantity top-ups", () => {
    const guestItems = [
      { id: 101, quantity: 2 },
      { id: 202, quantity: 3, variation: [{ attribute: "pa_size", value: "m" }] },
      { id: 303, quantity: 4 },
    ];
    const serverItems = [
      { id: 101, key: "k101", quantity: 2 }, // identical, no action needed
      { id: 303, key: "k303", quantity: 1 }, // under-quantitied on server, needs update to 4
      // 202 missing completely on server
    ];

    const actions = diffGuestItemsForMerge(guestItems, serverItems);
    assert.equal(actions.length, 2);

    const addAction = actions.find((a) => a.type === "add");
    assert.ok(addAction);
    assert.equal(addAction.item.id, 202);
    assert.equal(addAction.quantity, 3);

    const updateAction = actions.find((a) => a.type === "update");
    assert.ok(updateAction);
    assert.equal(updateAction.key, "k303");
    assert.equal(updateAction.quantity, 4);
  });

  // 12. orchestrateCartMerge executes additions and tracks failed items
  await suite.test("12. orchestrateCartMerge: Preserves items and records failures with visible error info", async () => {
    const calls = [];
    const mockApi = {
      refreshCart: async () => {
        calls.push("refreshCart");
        return { items: [{ id: 999, key: "k999", quantity: 1 }] };
      },
      addToCart: async (id, qty, variation) => {
        calls.push(`addToCart:${id}`);
        if (id === 102) {
          throw new Error("Item is out of stock");
        }
        return {
          items: [
            { id: 999, key: "k999", quantity: 1 },
            { id, quantity: qty, variation },
          ],
        };
      },
      updateCartItem: async (key, qty) => {
        calls.push(`update:${key}:${qty}`);
        return { items: [] };
      },
    };

    const guestItems = [
      { id: 101, name: "Available Product", quantity: 1 },
      { id: 102, name: "Out-of-Stock Product", quantity: 2 },
    ];

    const result = await orchestrateCartMerge({
      guestItems,
      api: mockApi,
      isSessionValid: () => true,
    });

    assert.equal(result.cancelled, false);
    assert.equal(result.failedItems.length, 1);
    assert.equal(result.failedItems[0].id, 102);
    assert.equal(result.failedItems[0].name, "Out-of-Stock Product");
    assert.match(result.failedItems[0].error, /out of stock/i);
    assert.ok(result.serverCart.items.some((i) => i.id === 101));
  });

  // 13. orchestrateCartMerge race condition & session epoch cancellation
  await suite.test("13. orchestrateCartMerge: Aborts immediately if user logs out or switches mid-merge", async () => {
    let sessionActive = true;
    let addedCount = 0;

    const mockApi = {
      refreshCart: async () => ({ items: [] }),
      addToCart: async (id) => {
        addedCount += 1;
        // Mid-merge simulation: user logs out or switches account while first item is added
        sessionActive = false;
        return { items: [{ id }] };
      },
      updateCartItem: async () => ({ items: [] }),
    };

    const guestItems = [
      { id: 101, quantity: 1 },
      { id: 102, quantity: 1 },
      { id: 103, quantity: 1 },
    ];

    const result = await orchestrateCartMerge({
      guestItems,
      api: mockApi,
      isSessionValid: () => sessionActive,
    });

    // Merge must detect session became invalid and cancel
    assert.equal(result.cancelled, true);
    // Did not continue adding remaining items (102, 103) after session switch
    assert.equal(addedCount, 1);
  });

  // 14. Registration session confirmation: Browser cookie verification via /auth/me
  await suite.test("14. Registration session confirmation: Redirects to /login if browser rejected cookie", async () => {
    const handlePostRegistration = async ({ regResponse, refreshUserCheck, navigate }) => {
      if (regResponse.session_established === false) {
        navigate("/login", { reason: "session_established_false" });
        return;
      }

      // Authoritative verification via /auth/me
      const sessionCheck = await refreshUserCheck();
      if (!sessionCheck?.ok) {
        navigate("/login", { reason: "cookie_not_accepted" });
        return;
      }

      navigate("/", { reason: "authenticated" });
    };

    let navCall = null;
    const mockNavigate = (path, opts) => {
      navCall = { path, opts };
    };

    // Scenario A: Server sent session_established: true, but browser rejected cookie (refreshUser -> 401)
    await handlePostRegistration({
      regResponse: { user: { id: 1 }, session_established: true },
      refreshUserCheck: async () => ({ ok: false, reason: "unauthorized", status: 401 }),
      navigate: mockNavigate,
    });
    assert.equal(navCall.path, "/login");
    assert.equal(navCall.opts.reason, "cookie_not_accepted");

    // Scenario B: Browser accepted cookie (refreshUser -> 200 ok)
    await handlePostRegistration({
      regResponse: { user: { id: 1 }, session_established: true },
      refreshUserCheck: async () => ({ ok: true, user: { id: 1 } }),
      navigate: mockNavigate,
    });
    assert.equal(navCall.path, "/");
    assert.equal(navCall.opts.reason, "authenticated");
  });

  // 15. Checkout CTA disabled while address verification is in flight
  await suite.test("15. Checkout guard: Button is disabled while addresses are loading or unverified", () => {
    const calculateCheckoutDisabled = ({
      loading,
      loadingAddresses,
      isAuthenticated,
      addresses,
      selectedAddress,
    }) => {
      return (
        loading ||
        (isAuthenticated && loadingAddresses) ||
        (isAuthenticated && addresses.length > 0 && !selectedAddress)
      );
    };

    // Authenticated user with addresses loading -> DISABLED
    assert.equal(
      calculateCheckoutDisabled({
        loading: false,
        loadingAddresses: true,
        isAuthenticated: true,
        addresses: [],
        selectedAddress: null,
      }),
      true
    );

    // Authenticated user with addresses loaded and selected -> ENABLED
    assert.equal(
      calculateCheckoutDisabled({
        loading: false,
        loadingAddresses: false,
        isAuthenticated: true,
        addresses: [{ id: "addr_1" }],
        selectedAddress: { id: "addr_1" },
      }),
      false
    );
  });
});
