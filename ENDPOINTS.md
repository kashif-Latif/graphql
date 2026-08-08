# Endpoint reference

Every endpoint below was verified against the live store (`45e8a2-44.myshopify.com`).

Start the server first — port 3000 is taken on this machine, so these examples use 3055:

```powershell
$env:PORT="3055"; npm start
```

```powershell
$b = "http://localhost:3055"
$gid = [uri]::EscapeDataString("gid://shopify/Product/8235448008751")
```

| # | Method | Path | LLM? | Purpose |
|---|---|---|---|---|
| 1 | GET | `/api/health` | no | liveness (no Shopify call) |
| 2 | GET | `/api/health/shopify` | no | Shopify connectivity probe |
| 3 | POST/GET | `/api/v1/chat` | **yes** | main integration API — JSON |
| 4 | POST/GET | `/api/v1/chat/raw` | **yes** | reply text only |
| 5 | POST/GET | `/api/v1/chat/html` | **yes** | message + product cards as HTML |
| 6 | GET | `/api/v1/products/search` | no | product search |
| 7 | GET | `/api/v1/discounts` | no | active promotions |
| 8 | POST | `/api/chat` | **yes** | internal chat (used by the console) |
| 9 | POST | `/api/chat/reset` | no | clear a conversation thread |
| 10 | GET | `/api/products/search` | no | product search + `meta` |
| 11 | GET | `/api/products/:productId` | no | one product, full detail |
| 12 | GET | `/api/products/:productId/variants` | no | all variants (paginated) |
| 13 | GET | `/api/products/:productId/inventory` | no | live stock |
| 14 | GET | `/api/discounts` | no | promotions + `cached` flag |
| 15 | GET | `/api/tools` | no | list testable tools |
| 16 | POST | `/api/tools/:toolName` | no | run a tool's service directly |
| 17 | GET | `/` | no | browser test console |

`:productId` must be URL-encoded in the path (`gid%3A%2F%2Fshopify%2FProduct%2F123`).
Tool-tester and console endpoints require `ENABLE_TOOL_TESTER=true`.

---

## 1–2. Health

```powershell
Invoke-RestMethod "$b/api/health"
# status : ok        service : shopify-live-product-search-agent      aiConfigured : True

Invoke-RestMethod "$b/api/health/shopify"
# status : ok        shop : Little Minors      apiVersion : 2026-07
```
```bash
curl "$B/api/health"
curl "$B/api/health/shopify"
```

---

## 3. `POST|GET /api/v1/chat` — main JSON API

Fields: `message` (required), `threadId` (optional — omit and each request is
its own conversation). Append `?debug=true` for the diagnostics block.

```powershell
Invoke-RestMethod -Method Post "$b/api/v1/chat" -ContentType "application/json" `
  -Body '{"threadId":"cust-42","message":"pink baby towel under 500"}' | ConvertTo-Json -Depth 6
```
```bash
curl -X POST "$B/api/v1/chat" -H 'content-type: application/json' \
  -d '{"threadId":"cust-42","message":"pink baby towel under 500"}'

# GET form (browser-friendly)
curl "$B/api/v1/chat?threadId=cust-42&message=pink%20baby%20towel%20under%20500"
```
```json
{
  "success": true,
  "threadId": "cust-42",
  "message": "Here's a pink towel that fits your budget:\n\n1. Soft Baby Towel – Rs 399",
  "products": [
    {
      "id": "gid://shopify/Product/8235448008751",
      "title": "Soft Baby Towel – Premium Cotton Absorbent Kids Bath Towel",
      "handle": "soft-baby-towel-premium-cotton-absorbent-kids-bath-towel-little-minors",
      "url": "/products/soft-baby-towel-premium-cotton-absorbent-kids-bath-towel-little-minors",
      "image": "https://cdn.shopify.com/…",
      "variants": [
        { "id": "gid://shopify/ProductVariant/45199558672431", "title": "Pink / 30*30 Inches", "price": 399, "available": true }
      ]
    }
  ]
}
```

---

## 4. `POST|GET /api/v1/chat/raw` — plain text

```powershell
$r = Invoke-WebRequest "$b/api/v1/chat/raw?threadId=cust-42&message=any%20offers" -UseBasicParsing
$r.Content
$r.Headers['x-thread-id']; $r.Headers['x-product-count']
```
```bash
curl "$B/api/v1/chat/raw?threadId=cust-42&message=any%20offers"
curl -X POST "$B/api/v1/chat/raw" -H 'content-type: application/json' \
  -d '{"threadId":"cust-42","message":"any offers"}'
```
```
Yes, we have a current promotion:

- Free Shipping Above Rs. 3,000 — free shipping on all products with a minimum purchase of Rs 3,000.
```

---

## 5. `POST|GET /api/v1/chat/html` — HTML

Fragment by default; `?full=1` returns a standalone document for an iframe.

```powershell
(Invoke-WebRequest "$b/api/v1/chat/html?threadId=cust-42&message=pink%20towel" -UseBasicParsing).Content
(Invoke-WebRequest "$b/api/v1/chat/html?message=pink%20towel&full=1" -UseBasicParsing).Content
```
```bash
curl "$B/api/v1/chat/html?message=pink%20towel"
curl "$B/api/v1/chat/html?message=pink%20towel&full=1"
```
```html
<div class="sai-response">
  <div class="sai-message"><p>Here's a pink baby towel that fits your budget.</p></div>
  <ol class="sai-products">
    <li class="sai-product" data-product-id="gid://shopify/Product/8235448008751">…</li>
  </ol>
</div>
```

---

## 6. `GET /api/v1/products/search` — no LLM

Filters: `query`, `color`, `size`, `age` (years, `0.5` = 6 months), `minPrice`,
`maxPrice`, `vendor`, `productType`, `category`, `inStock`, `limit` (1–5).

```powershell
Invoke-RestMethod "$b/api/v1/products/search?query=towel&color=pink&maxPrice=500&inStock=true" | ConvertTo-Json -Depth 6
Invoke-RestMethod "$b/api/v1/products/search?query=clothes&color=black&age=2&maxPrice=1500"
Invoke-RestMethod "$b/api/v1/products/search?minPrice=500&maxPrice=1000"
```
```bash
curl "$B/api/v1/products/search?query=towel&color=pink&maxPrice=500&inStock=true"
```

---

## 7. `GET /api/v1/discounts`

```powershell
Invoke-RestMethod "$b/api/v1/discounts"
Invoke-RestMethod "$b/api/v1/discounts?activeOnly=false"
```
```json
{
  "success": true,
  "count": 1,
  "discounts": [
    {
      "id": "gid://shopify/DiscountAutomaticNode/1296416964655",
      "title": "Free Shipping Above Rs. 3,000",
      "summary": "Free shipping on all products • Minimum purchase of Rs3,000.00 • For all countries",
      "status": "ACTIVE",
      "appliesAutomatically": true,
      "codes": [],
      "kind": "free_shipping"
    }
  ]
}
```

---

## 8–9. Internal chat

Same agent as `/api/v1/chat`, but the response carries `diagnostics` in dev.

```powershell
Invoke-RestMethod -Method Post "$b/api/chat" -ContentType "application/json" `
  -Body '{"threadId":"t1","message":"Show me black clothes for a 2 year old under 1500"}'

# follow-ups in the SAME threadId resolve references
Invoke-RestMethod -Method Post "$b/api/chat" -ContentType "application/json" `
  -Body '{"threadId":"t1","message":"What sizes does the first one have?"}'
Invoke-RestMethod -Method Post "$b/api/chat" -ContentType "application/json" `
  -Body '{"threadId":"t1","message":"Is the second one available?"}'

# clear the thread
Invoke-RestMethod -Method Post "$b/api/chat/reset" -ContentType "application/json" -Body '{"threadId":"t1"}'
```

Roman Urdu works the same way — the reply comes back in the same language:

```powershell
Invoke-RestMethod -Method Post "$b/api/chat" -ContentType "application/json" `
  -Body '{"threadId":"u1","message":"salam bhai, pink baby towel hai 500 se kam?"}'
# BOT: Haan, pink baby towel mil raha hai aur Rs 399 mein hai.
```

---

## 10–13. Catalogue (no LLM)

```powershell
# search, with meta (pages fetched, candidates, ms)
Invoke-RestMethod "$b/api/products/search?query=towel&color=pink&maxPrice=500&inStock=true"

# one product
Invoke-RestMethod "$b/api/products/$gid"

# all variants, optional filters
Invoke-RestMethod "$b/api/products/$gid/variants"
Invoke-RestMethod "$b/api/products/$gid/variants?color=pink"

# live inventory
Invoke-RestMethod "$b/api/products/$gid/inventory?color=pink"
Invoke-RestMethod "$b/api/products/$gid/inventory?size=30*30%20Inches"
```
```bash
GID=$(python -c "import urllib.parse;print(urllib.parse.quote('gid://shopify/Product/8235448008751',safe=''))")
curl "$B/api/products/$GID/variants?color=pink"
```

---

## 14. `GET /api/discounts`

```powershell
Invoke-RestMethod "$b/api/discounts"              # active only
Invoke-RestMethod "$b/api/discounts?activeOnly=false"
```

---

## 15–16. Tool tester (dev only)

Runs the service behind each agent tool, with no LLM.

```powershell
Invoke-RestMethod "$b/api/tools"
# search_products, get_product, get_product_variants, check_inventory, compare_products, get_discounts

Invoke-RestMethod -Method Post "$b/api/tools/search_products" -ContentType "application/json" `
  -Body '{"query":"baby","color":"pink","maxPrice":1000,"inStock":true,"limit":5}'

Invoke-RestMethod -Method Post "$b/api/tools/get_product" -ContentType "application/json" `
  -Body '{"productId":"gid://shopify/Product/8235448008751"}'

Invoke-RestMethod -Method Post "$b/api/tools/get_product_variants" -ContentType "application/json" `
  -Body '{"productId":"gid://shopify/Product/8235448008751","color":"pink"}'

Invoke-RestMethod -Method Post "$b/api/tools/check_inventory" -ContentType "application/json" `
  -Body '{"productId":"gid://shopify/Product/8235448008751","color":"pink"}'

Invoke-RestMethod -Method Post "$b/api/tools/compare_products" -ContentType "application/json" `
  -Body '{"productIds":["gid://shopify/Product/8235448008751","gid://shopify/Product/8235443060783"],"requirement":"cheaper for a 2 year old"}'

Invoke-RestMethod -Method Post "$b/api/tools/get_discounts" -ContentType "application/json" `
  -Body '{"activeOnly":true}'
```

---

## 17. `GET /` — browser console

Open <http://localhost:3055/>. Tabs: Chat (AI), Direct search (no AI),
Discounts, Tool tester. Every response shows its diagnostics block.

---

## Error shapes

```powershell
# invalid product id -> 400 JSON
Invoke-RestMethod "$b/api/products/not-a-gid"
# {"success":false,"error":{"code":"validation_error","message":"Invalid Shopify product id: not-a-gid"}}

# missing message on the raw endpoint -> 400 as PLAIN TEXT, not JSON
Invoke-WebRequest "$b/api/v1/chat/raw?threadId=x" -UseBasicParsing
# 400  "Invalid request"
```

| Code | Status | Meaning |
|---|---|---|
| `validation_error` | 400 | bad/missing input |
| `not_found` | 404 | unknown product or endpoint |
| `rate_limited` | 429 | too many requests (chat: 20/min, catalogue: 120/min) |
| `agent_rate_limited` | 429 | the LLM provider throttled us — wait a few seconds |
| `agent_not_configured` | 503 | `AI_API_KEY` missing |
| `shopify_throttled` | 429 | Shopify throttled us |
| `shopify_error` | 502 | Shopify unavailable or rejected the query |

---

## Smoke test everything at once

```powershell
npm run smoke:search   # non-LLM Shopify path, 5 scenarios
npm test               # 70 tests, no network
```
