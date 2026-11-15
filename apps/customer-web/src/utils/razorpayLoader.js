export const loadRazorpayScript = () => {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.Razorpay) {
      return resolve(true);
    }
    if (typeof document === "undefined") {
      return resolve(false);
    }
    const existingScript = document.getElementById("razorpay-checkout-script");
    if (existingScript) {
      if (window.Razorpay) {
        return resolve(true);
      }
      existingScript.addEventListener("load", () => resolve(true), { once: true });
      existingScript.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "razorpay-checkout-script";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};
