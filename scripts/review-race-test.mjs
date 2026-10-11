const h = {
  "Content-Type": "application/json",
  Cookie: process.env.TEST_COOKIE,
  Origin: process.env.TEST_ORIGIN,
  "X-Mumbai-Panel": "customer",
};
const out = await Promise.all(
  Array.from({ length: Number(process.env.N || 5) }, (_, i) =>
    fetch(process.env.URL, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ rating: 5, review: "race test " + i }),
    }).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      return r.status + " " + (b.code || b.message || "");
    })
  )
);
console.log(out.join("\n"));
