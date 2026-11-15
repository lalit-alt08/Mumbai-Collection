import safeStorage from "./safeStorage.js";
import { getIndianStateCode } from "../data/indianStates.js";

export function buildCheckoutAddresses(selectedAddress, user) {
  let firstName = (selectedAddress.first_name || "").trim();
  let lastName = (selectedAddress.last_name || "").trim();

  if (!firstName || !lastName) {
    const nameParts = (selectedAddress.full_name || "").trim().split(/\s+/);
    if (!firstName) firstName = nameParts[0] || "";
    if (!lastName) lastName = nameParts.slice(1).join(" ");
  }

  if (!firstName) {
    firstName = (user?.first_name || (user?.name || "").trim().split(/\s+/)[0] || "Customer").trim();
  }
  if (!lastName) {
    lastName = (user?.last_name || (user?.name || "").trim().split(/\s+/).slice(1).join(" ") || "").trim();
  }

  const stateCode = getIndianStateCode(selectedAddress.state);
  const cachedEmail = safeStorage.getJSON("user", {})?.email || "";

  const userEmail = (user?.email || selectedAddress.email || cachedEmail || "").trim();
  if (!userEmail) {
    return { error: "Please ensure your account has a valid email address before placing an order." };
  }

  const rawPhone = (selectedAddress.phone || user?.phone || "").replace(/\D/g, "");
  const cleanPhone = rawPhone.length === 12 && rawPhone.startsWith("91") ? rawPhone.slice(2) : rawPhone;
  if (!cleanPhone || cleanPhone.length < 10) {
    return { error: "Please enter a valid 10-digit mobile number on your delivery address so our courier can deliver your order." };
  }
  const userPhone = cleanPhone;
  const rawPrimaryPhone = String(user?.phone || "").replace(/\D/g, "");
  const primaryPhone = rawPrimaryPhone.length === 12 && rawPrimaryPhone.startsWith("91") ? rawPrimaryPhone.slice(2) : rawPrimaryPhone;
  const cleanPincode = (selectedAddress.pincode || "").replace(/\D/g, "") || "";

  if (!selectedAddress.address_line1?.trim() || !selectedAddress.city?.trim()) {
    return { error: "Please update your delivery address before placing your order." };
  }

  const billingAddress = {
    first_name: firstName,
    last_name: lastName,
    email: userEmail,
    phone: /^[6-9]\d{9}$/.test(primaryPhone) ? primaryPhone : userPhone,
    address_1: selectedAddress.address_line1.trim(),
    address_2: selectedAddress.address_line2 || "",
    city: selectedAddress.city.trim(),
    state: stateCode,
    postcode: cleanPincode,
    country: "IN",
  };

  const shippingAddress = {
    first_name: firstName,
    last_name: lastName,
    phone: userPhone,
    address_1: selectedAddress.address_line1.trim(),
    address_2: selectedAddress.address_line2 || "",
    city: selectedAddress.city.trim(),
    state: stateCode,
    postcode: cleanPincode,
    country: "IN",
  };

  return { billingAddress, shippingAddress };
}
