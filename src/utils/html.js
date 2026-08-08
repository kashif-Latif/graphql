/**
 * HTML rendering for the embeddable chat endpoint.
 *
 * The LLM never produces HTML — it writes plain text, and the backend renders
 * the structured product data around it. Every interpolated value is escaped,
 * including values that came from Shopify.
 */

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]
  );
}

/** Only http(s) and site-relative URLs may reach an href/src attribute. */
function safeUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("/")) return escapeHtml(raw);
  if (/^https?:\/\//i.test(raw)) return escapeHtml(raw);
  return null;
}

function money(value) {
  return typeof value === "number" ? `Rs ${value.toLocaleString("en-PK")}` : "";
}

function renderVariants(variants = []) {
  if (!variants.length) return "";
  const items = variants
    .map(
      (variant) => `
        <li class="sai-variant">
          <span class="sai-variant-title">${escapeHtml(variant.title || "")}</span>
          <span class="sai-variant-price">${escapeHtml(money(variant.price))}</span>
          <span class="sai-variant-stock ${variant.available ? "is-in" : "is-out"}">${
            variant.available ? "In stock" : "Out of stock"
          }</span>
        </li>`
    )
    .join("");
  return `<ul class="sai-variants">${items}</ul>`;
}

function renderProduct(product, index, { storeDomain } = {}) {
  const path = safeUrl(product.url);
  const href = path && storeDomain && path.startsWith("/") ? `https://${storeDomain}${path}` : path;
  const image = safeUrl(product.image);

  return `
    <li class="sai-product" data-product-id="${escapeHtml(product.id)}">
      <span class="sai-product-index">${index + 1}</span>
      ${image ? `<img class="sai-product-image" src="${image}" alt="${escapeHtml(product.title || "")}" loading="lazy" />` : ""}
      <div class="sai-product-body">
        <h3 class="sai-product-title">${escapeHtml(product.title || "")}</h3>
        ${renderVariants(product.variants)}
        ${href ? `<a class="sai-product-link" href="${href}">View product</a>` : ""}
      </div>
    </li>`;
}

/**
 * An HTML fragment: the assistant's message plus product cards.
 * Class-name prefixed with `sai-` so it can be dropped into any page and
 * styled by the host application.
 */
export function renderChatFragment({ message, products = [] }, options = {}) {
  const paragraphs = String(message ?? "")
    .split(/\n{2,}/)
    .filter((block) => block.trim())
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("");

  return `<div class="sai-response">
  <div class="sai-message">${paragraphs}</div>
  ${
    products.length
      ? `<ol class="sai-products">${products
          .map((product, index) => renderProduct(product, index, options))
          .join("")}</ol>`
      : ""
  }
</div>`;
}

const PAGE_STYLES = `
  .sai-response { font: 15px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1b1f24; max-width: 760px; }
  .sai-message p { margin: 0 0 10px; white-space: pre-wrap; }
  .sai-products { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 12px; }
  .sai-product { display: flex; gap: 12px; align-items: flex-start; border: 1px solid #e3e6ea; border-radius: 12px; padding: 12px; }
  .sai-product-index { font-size: 12px; color: #667085; min-width: 16px; }
  .sai-product-image { width: 84px; height: 84px; object-fit: cover; border-radius: 8px; flex: 0 0 auto; background: #f2f4f7; }
  .sai-product-title { font-size: 15px; margin: 0 0 6px; font-weight: 600; }
  .sai-variants { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .sai-variant { display: flex; gap: 10px; padding: 1px 0; }
  .sai-variant-price { font-weight: 600; }
  .sai-variant-stock.is-in { color: #12805c; }
  .sai-variant-stock.is-out { color: #b42318; }
  .sai-product-link { font-size: 13px; color: #2f6feb; display: inline-block; margin-top: 6px; }
  @media (prefers-color-scheme: dark) {
    .sai-response { color: #e8eaed; }
    .sai-product { border-color: #2c3238; }
    .sai-product-index { color: #98a2b3; }
    .sai-variant-stock.is-in { color: #4ac09a; }
    .sai-variant-stock.is-out { color: #f97066; }
    .sai-product-link { color: #6aa0ff; }
  }`;

/** A complete standalone document, for iframes or a quick browser check. */
export function renderChatPage(payload, options = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Shopping assistant</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
${renderChatFragment(payload, options)}
</body>
</html>`;
}

export { PAGE_STYLES };
