/**
 * Static GraphQL documents.
 *
 * These are the ONLY GraphQL documents in the system. They are constants —
 * no string interpolation of user input, ever. All dynamic values travel as
 * GraphQL variables.
 */

const VARIANT_FIELDS = /* GraphQL */ `
  fragment VariantFields on ProductVariant {
    id
    title
    sku
    price
    compareAtPrice
    inventoryQuantity
    availableForSale
    selectedOptions {
      name
      value
    }
  }
`;

const PRODUCT_CORE_FIELDS = /* GraphQL */ `
  fragment ProductCoreFields on Product {
    id
    title
    handle
    description
    vendor
    productType
    tags
    status
    featuredMedia {
      ... on MediaImage {
        image {
          url
          altText
        }
      }
    }
    options {
      id
      name
      values
    }
  }
`;

export const SEARCH_PRODUCTS_QUERY = /* GraphQL */ `
  ${PRODUCT_CORE_FIELDS}
  ${VARIANT_FIELDS}
  query SearchProducts($first: Int!, $after: String, $query: String, $variantsFirst: Int!) {
    products(first: $first, after: $after, query: $query) {
      nodes {
        ...ProductCoreFields
        variants(first: $variantsFirst) {
          nodes {
            ...VariantFields
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

export const GET_PRODUCT_QUERY = /* GraphQL */ `
  ${PRODUCT_CORE_FIELDS}
  ${VARIANT_FIELDS}
  query GetProduct($id: ID!, $variantsFirst: Int!) {
    product(id: $id) {
      ...ProductCoreFields
      totalInventory
      onlineStoreUrl
      variants(first: $variantsFirst) {
        nodes {
          ...VariantFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

/** Used to paginate variants of a single known product. */
export const GET_PRODUCT_VARIANTS_QUERY = /* GraphQL */ `
  ${VARIANT_FIELDS}
  query GetProductVariants($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      id
      title
      handle
      options {
        id
        name
        values
      }
      variants(first: $first, after: $after) {
        nodes {
          ...VariantFields
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

/**
 * Store-wide discounts. Every concrete discount type is spread explicitly —
 * `discount` is a union, so unlisted types come back as `__typename` only.
 * All six fragments below were verified against the live Admin schema.
 */
export const DISCOUNTS_QUERY = /* GraphQL */ `
  query Discounts($first: Int!, $after: String) {
    discountNodes(first: $first, after: $after) {
      nodes {
        id
        discount {
          __typename
          ... on DiscountAutomaticBasic {
            title
            status
            startsAt
            endsAt
            summary
          }
          ... on DiscountAutomaticFreeShipping {
            title
            status
            startsAt
            endsAt
            summary
          }
          ... on DiscountAutomaticBxgy {
            title
            status
            startsAt
            endsAt
            summary
          }
          ... on DiscountCodeBasic {
            title
            status
            startsAt
            endsAt
            summary
            codes(first: 3) {
              nodes {
                code
              }
            }
          }
          ... on DiscountCodeFreeShipping {
            title
            status
            startsAt
            endsAt
            summary
            codes(first: 3) {
              nodes {
                code
              }
            }
          }
          ... on DiscountCodeBxgy {
            title
            status
            startsAt
            endsAt
            summary
            codes(first: 3) {
              nodes {
                code
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/** Cheap connectivity probe for the diagnostics endpoint. */
export const SHOP_PROBE_QUERY = /* GraphQL */ `
  query ShopProbe {
    shop {
      name
      myshopifyDomain
      currencyCode
    }
  }
`;
