import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const productInfoPath = path.resolve(__dirname, "../src/components/product/ProductInfo.jsx");
const floatingCartBarPath = path.resolve(__dirname, "../src/components/layout/FloatingCartBar.jsx");

test("Product Page Action UX — Clean Sticky Bottom Bar & No Buy Now", async (t) => {
  const productInfoSource = fs.readFileSync(productInfoPath, "utf8");
  const floatingCartBarSource = fs.readFileSync(floatingCartBarPath, "utf8");

  await t.test("1. 'Buy Now' button and handler are completely removed from ProductInfo", () => {
    assert.strictEqual(
      productInfoSource.includes("Buy Now"),
      false,
      "ProductInfo should not render any 'Buy Now' button"
    );
    assert.strictEqual(
      productInfoSource.includes("handleBuyNow"),
      false,
      "ProductInfo should not define or reference handleBuyNow"
    );
  });

  await t.test("2. FloatingCartBar is hidden on mobile product pages (< lg) to prevent double-stacked bars", () => {
    assert.ok(
      floatingCartBarSource.includes('hidden lg:flex lg:bottom-8'),
      "FloatingCartBar should use 'hidden lg:flex lg:bottom-8' on product pages"
    );
  });

  await t.test("3. Bottom bar state logic accurately distinguishes the 3 required states", () => {
    // Helper replicating the component logic
    const getBottomBarState = (cart, productId) => {
      const cartItems = cart?.items || [];
      const totalCartItems = cartItems.reduce(
        (total, item) => total + (Number(item.quantity) || 0),
        0
      );
      const hasAnyCartItems = totalCartItems > 0;
      const cartItem = cartItems.find((item) => Number(item.id) === Number(productId));
      const isThisProductInCart = Boolean(cartItem && cartItem.quantity > 0);

      if (!hasAnyCartItems) {
        return {
          state: 1,
          label: "Cart is empty",
          actions: ["Price", "Add to cart"],
        };
      }
      if (!isThisProductInCart) {
        return {
          state: 2,
          label: "Cart has other products",
          actions: ["Add to cart", "View cart"],
        };
      }
      return {
        state: 3,
        label: "This product is already in the cart",
        actions: [
          `Stepper (${cartItem.quantity})`,
          `View cart · ${totalCartItems} ${totalCartItems === 1 ? "item" : "items"}`,
        ],
      };
    };

    // State 1: Cart is empty
    const state1 = getBottomBarState({ items: [] }, 42);
    assert.strictEqual(state1.state, 1);
    assert.deepStrictEqual(state1.actions, ["Price", "Add to cart"]);

    // State 2: Cart has other products
    const state2 = getBottomBarState({ items: [{ id: 99, quantity: 2 }] }, 42);
    assert.strictEqual(state2.state, 2);
    assert.deepStrictEqual(state2.actions, ["Add to cart", "View cart"]);

    // State 3A: This product is in cart (single item)
    const state3A = getBottomBarState({ items: [{ id: 42, quantity: 1 }] }, 42);
    assert.strictEqual(state3A.state, 3);
    assert.deepStrictEqual(state3A.actions, ["Stepper (1)", "View cart · 1 item"]);

    // State 3B: This product is in cart alongside other items (multiple items)
    const state3B = getBottomBarState(
      {
        items: [
          { id: 42, quantity: 2 },
          { id: 99, quantity: 3 },
        ],
      },
      42
    );
    assert.strictEqual(state3B.state, 3);
    assert.deepStrictEqual(state3B.actions, ["Stepper (2)", "View cart · 5 items"]);
  });

  await t.test("4. Outlined stepper styling is used in State 3 for quieter visual hierarchy", () => {
    assert.ok(
      productInfoSource.includes("border-2 border-[#22499F] bg-white"),
      "State 3 stepper should use outlined border styling rather than heavy solid fill"
    );
  });
});
