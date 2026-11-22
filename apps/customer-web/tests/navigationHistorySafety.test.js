import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, "../src");

test("Navigation History Safety: Addresses.jsx pops history with navigate(-1) and falls back to replace", () => {
  const file = fs.readFileSync(path.join(srcDir, "pages/Addresses.jsx"), "utf8");

  // Back button should pop history when idx > 0 and replace otherwise
  assert.ok(file.includes("if (window.history.state && window.history.state.idx > 0) {\n                navigate(-1);") ||
            file.includes("if (window.history.state && window.history.state.idx > 0) {\r\n                navigate(-1);"));
  assert.ok(file.includes("navigate(getSafeInternalPath(location.state?.from, \"/account\"), { replace: true });"));

  // Address creation and update should pop history when idx > 0 and replace otherwise
  assert.ok(file.includes("const safeTarget = getSafeInternalPath(location.state.from, \"/cart\");"));
});

test("Navigation History Safety: Cart.jsx back button pops history when idx > 0 and falls back to home replace", () => {
  const file = fs.readFileSync(path.join(srcDir, "pages/Cart.jsx"), "utf8");
  assert.ok(file.includes("if (window.history.state && window.history.state.idx > 0) {\n              navigate(-1);\n            } else {\n              navigate(\"/\", { replace: true });\n            }") ||
            file.includes("if (window.history.state && window.history.state.idx > 0) {\r\n              navigate(-1);\r\n            } else {\r\n              navigate(\"/\", { replace: true });\r\n            }"));
});

test("Navigation History Safety: Login.jsx uses replace and preserves return destination", () => {
  const file = fs.readFileSync(path.join(srcDir, "pages/Login.jsx"), "utf8");

  // Forgot password preserves from and uses replace
  assert.ok(file.includes("navigate(\"/forgot-password\", {"));
  assert.ok(file.includes("from: location.state?.from"));

  // Create one now preserves from and uses replace
  assert.ok(file.includes("navigate(\"/register\", {"));
  assert.ok(file.includes("replace: true"));
});

test("Navigation History Safety: RegisterDetailsStep.jsx uses replace when switching to login", () => {
  const file = fs.readFileSync(path.join(srcDir, "components/auth/RegisterDetailsStep.jsx"), "utf8");
  assert.ok(file.includes("navigate(\"/login\", {"));
  assert.ok(file.includes("replace: true"));
  assert.ok(file.includes("from: location.state?.from"));
});

test("Navigation History Safety: ForgotPassword.jsx uses replace and preserves return destination", () => {
  const file = fs.readFileSync(path.join(srcDir, "pages/ForgotPassword.jsx"), "utf8");
  assert.ok(file.includes("navigate(\"/login\", {"));
  assert.ok(file.includes("replace: true"));
  assert.ok(file.includes("from: location.state?.from"));
});

test("Navigation History Safety: ResetPassword.jsx uses replace and preserves return destination", () => {
  const file = fs.readFileSync(path.join(srcDir, "pages/ResetPassword.jsx"), "utf8");
  assert.ok(file.includes("navigate(\"/login\", {"));
  assert.ok(file.includes("navigate(\"/forgot-password\", {"));
  assert.ok(file.includes("replace: true"));
  assert.ok(file.includes("from: location.state?.from"));
});

test("Navigation History Safety: ProfileSetup.jsx exit handlers pop history when idx > 0 and replace otherwise", () => {
  const file = fs.readFileSync(path.join(srcDir, "pages/ProfileSetup.jsx"), "utf8");
  assert.ok(file.includes("const handleExitSetup = () => {"));
  assert.ok(file.includes("navigate(-1)"));
  assert.ok(file.includes("navigate(getSafeInternalPath(location.state?.from, \"/\"), { replace: true });"));
});
