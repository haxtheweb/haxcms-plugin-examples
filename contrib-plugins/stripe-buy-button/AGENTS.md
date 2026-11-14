# AGENTS.md (stripe-buy-button)

## Purpose
Front-end-only element pack: a Stripe Buy Button block with a Payment Link fallback.

## Rules
- Never store, log or render a secret or restricted Stripe key (sk_, rk_). Publishable keys (pk_) are public by design.
- The Payment Link fallback renders before Stripe's script loads; the block must keep working without it.
- Load js.stripe.com only from the block, only near the viewport and never in the HAX editor.
- Tags start with stripe-checkout- (tagPrefix). Stripe's own script defines stripe-buy-button; never define that tag.
- Use DDD tokens for spacing, borders and color.

## Build, test, validate
`hax plugin validate`; element tests with `npx web-test-runner "test/**/*.test.js" --node-resolve`.
