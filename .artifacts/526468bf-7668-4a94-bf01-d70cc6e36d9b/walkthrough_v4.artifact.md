# Walkthrough: Upgrade Plans & Integrated Payments

I have implemented the "Upgrade to Pro" flow, including the pricing tiers and the initial payment integration for both Stripe and MTN MoMo.

## Changes Made

### Upgrade & Pricing (`UpgradeModal.tsx`)
- **[Pro Tier Selection]**: Created a dedicated `UpgradeModal` displaying the benefits of the "Pro" plan, such as unlimited marking, deep reasoning AI, and advanced analytics.
- **[Unified Entry Points]**: Added "Upgrade to Pro" triggers in the **Left Sidebar**, **Top Navbar**, and the **Create Studio** immersive workspace.

### Integrated Payments
- **[Stripe Checkout]**: Added backend support in `PaymentService.ts` and `paymentRoutes.ts` to create Stripe Checkout Sessions for subscription upgrades.
- **[Mobile Money (MTN MoMo)]**: Maintained support for MoMo payments as an alternative method.
- **[Frontend Wiring]**: Implemented `handleUpgrade` in `App.tsx` to handle the redirection to payment gateways.

### Share Logic Refinement
- **[Gated Sharing]**: Moved the "Share" functionality into the 3-dot dropdown menu.
- **[Context Awareness]**: The "Share" button is now context-aware:
    - If no application form has been generated in the chat, the button is disabled with the label *"Share (create form first)"*.
    - Once a form is generated, it enables and allows sharing the specific `/apply/:formId` link.

## Verification Results

### Interaction Flows
- Verified that clicking "**Upgrade**" in any part of the UI correctly launches the pricing modal.
- Verified that the "**Share**" menu item correctly transitions from a disabled to an enabled state based on the `activeFormId`.
- Verified the simulated redirect to Stripe Checkout when selecting the Pro plan.

> [!IMPORTANT]
> The Stripe integration uses a mock implementation for the checkout URL. You will need to provide your real `STRIPE_SECRET_KEY` in the environment variables to go live.
