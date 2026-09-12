export const formatCustomerDisplayName = (first, last, fallback = "Guest Customer") => {
  const f = (first || "").trim();
  const l = (last || "").trim();
  if (!f && !l) return fallback;
  if (!l) return f;
  if (!f) return l;
  if (f.toLowerCase() === l.toLowerCase()) return f;
  return `${f} ${l}`;
};

export const parseFirstAndLastName = (body = {}) => {
  const explicitFirst = typeof body.first_name === "string" ? body.first_name.trim() : "";
  const explicitLast = typeof body.last_name === "string" ? body.last_name.trim() : "";
  if (explicitFirst || explicitLast) {
    return { firstName: explicitFirst, lastName: explicitLast };
  }
  const rawName = (typeof body.full_name === "string" ? body.full_name : typeof body.name === "string" ? body.name : "").trim();
  if (!rawName) return { firstName: "", lastName: "" };
  const tokens = rawName.split(/\s+/);
  const firstName = tokens[0] || "";
  const lastName = tokens.length > 1 ? tokens.slice(1).join(" ") : "";
  return { firstName, lastName };
};
