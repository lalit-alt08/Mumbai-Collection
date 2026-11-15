import { useState, useEffect } from "react";
import axios from "axios";
import API_URL from "../../config/api.js";
import safeStorage from "../../utils/safeStorage.js";

export function useCheckoutAddresses({
  user,
  isAuthenticated,
  handleSessionExpired,
  locationState,
  setError,
}) {
  const [addresses, setAddresses] = useState(() => {
    try {
      if (!user?.id) return [];
      const key = `saved_addresses_cache_${user.id}`;
      const cached = safeStorage.getJSON(key, []);
      return Array.isArray(cached) ? cached : [];
    } catch {
      return [];
    }
  });

  const [selectedAddressId, setSelectedAddressId] = useState(() => {
    try {
      if (!user?.id) return null;
      const idKey = `selected_address_id_${user.id}`;
      const cachedId = safeStorage.getItem(idKey);
      if (cachedId) return String(cachedId);
      const addrKey = `saved_addresses_cache_${user.id}`;
      const cached = safeStorage.getJSON(addrKey, []);
      return cached && cached[0] ? String(cached[0].id) : null;
    } catch {
      return null;
    }
  });

  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [addressLoadFailed, setAddressLoadFailed] = useState(false);
  const [addressRetry, setAddressRetry] = useState(0);
  const [addressSignInRequired, setAddressSignInRequired] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setAddresses([]);
      setSelectedAddressId(null);
      setAddressLoadFailed(false);
      setLoadingAddresses(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const currentUserId = user.id;
    const addressCacheKey = `saved_addresses_cache_${currentUserId}`;
    const selectedAddressKey = `selected_address_id_${currentUserId}`;

    const loadAddresses = async () => {
      try {
        setLoadingAddresses(true);
        setAddressLoadFailed(false);
        setError("");

        const response = await axios.get(`${API_URL}/addresses`, {
          withCredentials: true,
          signal: controller.signal,
          timeout: 12000,
        });

        if (!isMounted || user?.id !== currentUserId) return;

        if (!Array.isArray(response.data?.addresses)) throw new Error("Invalid address response");
        const savedAddresses = response.data.addresses;
        setAddressSignInRequired(false);

        setAddresses(savedAddresses);
        safeStorage.setJSON(addressCacheKey, savedAddresses);
        safeStorage.removeItem("saved_addresses_cache");
        safeStorage.removeItem("selected_address_id");

        if (savedAddresses.length > 0) {
          const targetId = locationState?.selectedAddressId;
          const targetExists = targetId && savedAddresses.some((a) => String(a.id) === String(targetId));

          setSelectedAddressId((prev) => {
            if (targetExists) {
              const targetStr = String(targetId);
              safeStorage.setItem(selectedAddressKey, targetStr);
              return targetStr;
            }
            const stillValid = prev && savedAddresses.some((a) => String(a.id) === String(prev));
            const nextId = stillValid ? String(prev) : String(savedAddresses[0].id);
            safeStorage.setItem(selectedAddressKey, nextId);
            return nextId;
          });
        } else {
          setSelectedAddressId(null);
          safeStorage.removeItem(selectedAddressKey);
        }
      } catch (error) {
        if (!isMounted || user?.id !== currentUserId) return;
        setAddresses([]);
        setSelectedAddressId(null);
        if (error.response?.status === 401) {
          setAddressSignInRequired(true);
          setAddressLoadFailed(false);
          setError("");
          handleSessionExpired?.({ checkout: true });
        } else {
          setAddressLoadFailed(true);
        }
      } finally {
        if (isMounted && user?.id === currentUserId) {
          setLoadingAddresses(false);
        }
      }
    };

    loadAddresses();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [isAuthenticated, user?.id, locationState?.selectedAddressId, addressRetry]);

  const selectedAddress = addresses.find(
    (address) => String(address.id) === String(selectedAddressId)
  );

  return {
    addresses,
    setAddresses,
    selectedAddressId,
    setSelectedAddressId,
    selectedAddress,
    loadingAddresses,
    addressLoadFailed,
    setAddressRetry,
    addressSignInRequired,
    setAddressSignInRequired,
  };
}
