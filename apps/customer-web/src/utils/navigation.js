import WORDPRESS_URL from "../config/wordpress";

export const goToLogin = () => {
  window.location.href = `${WORDPRESS_URL}/my-account/`;
};

export const goToCheckout = () => {
  window.location.href = `${WORDPRESS_URL}/checkout/`;
};

export const goToAccount = () => {
  window.location.href = `${WORDPRESS_URL}/my-account/`;
};