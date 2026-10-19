/**
 * Password validation utilities
 * Enforces strong passwords:
 * - At least 8 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one number (0-9)
 * - At least one special character (e.g. !@#$%^&*)
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,256}$/;

export function getPasswordRuleChecks(password = "") {
  const str = typeof password === "string" ? password : "";
  return {
    length: str.length >= PASSWORD_MIN_LENGTH,
    uppercase: /[A-Z]/.test(str),
    lowercase: /[a-z]/.test(str),
    number: /[0-9]/.test(str),
    special: /[^A-Za-z0-9]/.test(str),
  };
}

export function validatePassword(password) {
  if (!password || typeof password !== "string") {
    return { isValid: false, message: "Password is required." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { isValid: false, message: "Password must be at least 8 characters long." };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { isValid: false, message: "Password is too long (maximum 256 characters)." };
  }
  if (!/[A-Z]/.test(password)) {
    return { isValid: false, message: "Password must include at least one uppercase letter (A-Z)." };
  }
  if (!/[a-z]/.test(password)) {
    return { isValid: false, message: "Password must include at least one lowercase letter (a-z)." };
  }
  if (!/[0-9]/.test(password)) {
    return { isValid: false, message: "Password must include at least one number (0-9)." };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { isValid: false, message: "Password must include at least one special character (e.g. !@#$%^&*)." };
  }
  return { isValid: true, message: "" };
}

export function isValidPassword(password) {
  return validatePassword(password).isValid;
}
