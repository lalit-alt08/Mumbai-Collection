/**
 * Mumbai Collection Customer Support Configuration
 */

// Configurable WhatsApp Business Phone Number (defaulting to standard store contact +91 87936 01567)
export const WHATSAPP_SUPPORT_PHONE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_WHATSAPP_PHONE) ||
  "918793601567";

/**
 * Builds a sanitized wa.me link for opening a blank chat with store support
 * @returns {string} WhatsApp URL to open blank chat
 */
export const getProductWhatsAppUrl = () => {
  const cleanPhone = String(WHATSAPP_SUPPORT_PHONE).replace(/[^0-9]/g, "");
  return `https://wa.me/${cleanPhone}`;
};
