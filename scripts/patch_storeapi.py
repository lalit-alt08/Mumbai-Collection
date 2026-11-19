path = r"apps/customer-web/src/services/storeApi.js"
with open(path, "r", encoding="utf-8") as f:
    c = f.read()

# Normalize line endings for replacement
c = c.replace("\r\n", "\n")

old_block = """    const tracking = getSessionTracking(config._cartSessionEpoch);
    const isMutation = config.method && config.method.toLowerCase() !== "get";
    if (isMutation) {
      tracking.totalWritesInitiated += 1;
      tracking.activeWritesCount += 1;
      config._writeId = tracking.totalWritesInitiated;
    } else {
      config._readStartWriteId = tracking.latestCompletedWriteId;
      config._hadActiveWritesAtStart = tracking.activeWritesCount > 0;
    }

    // WooCommerce Store API requires a valid Nonce for all mutations and checkout endpoints.
    // If nonce is completely missing, fetch the cart first to initialize session and acquire a nonce.
    const urlStr = config.url || "";
    const isCheckout = urlStr === "/checkout" || urlStr === `${STORE_API}/checkout` || urlStr.includes("/checkout");
    const isCartGet = urlStr === "/cart" || urlStr === `${STORE_API}/cart`;
    const needsNonce = (isMutation || isCheckout) && !isCartGet && !config._isInitializing;

    if (needsNonce && !nonce) {
      await ensureSessionNonce();
    }"""

new_block = """    // WooCommerce Store API requires a valid Nonce for all mutations and checkout endpoints.
    // If nonce is completely missing, fetch the cart first to initialize session and acquire a nonce.
    const isMutation = config.method && config.method.toLowerCase() !== "get";
    const urlStr = config.url || "";
    const isCheckout = urlStr === "/checkout" || urlStr === `${STORE_API}/checkout` || urlStr.includes("/checkout");
    const isCartGet = urlStr === "/cart" || urlStr === `${STORE_API}/cart`;
    const needsNonce = (isMutation || isCheckout) && !isCartGet && !config._isInitializing;

    if (needsNonce && !nonce) {
      await ensureSessionNonce();
    }

    const tracking = getSessionTracking(config._cartSessionEpoch);
    if (isMutation) {
      tracking.totalWritesInitiated += 1;
      tracking.activeWritesCount += 1;
      config._writeId = tracking.totalWritesInitiated;
    } else {
      config._readStartWriteId = tracking.latestCompletedWriteId;
      config._hadActiveWritesAtStart = tracking.activeWritesCount > 0;
    }"""

old_stale = """        const isStale =
          response.config._hadActiveWritesAtStart ||
          currentTracking.latestCompletedWriteId > response.config._readStartWriteId ||
          currentTracking.activeWritesCount > 0;"""

new_stale = """        const isStale =
          !response.config?._isInitializing &&
          (response.config._hadActiveWritesAtStart ||
            currentTracking.latestCompletedWriteId > response.config._readStartWriteId ||
            currentTracking.activeWritesCount > 0);"""

assert old_block in c, "old_block not found in storeApi.js"
assert old_stale in c, "old_stale not found in storeApi.js"

c = c.replace(old_block, new_block).replace(old_stale, new_stale)
with open(path, "w", encoding="utf-8") as f:
    f.write(c)

print("SUCCESS")
