# Walkthrough: Final Pricing & Monetization

I have implemented the final pricing strategy and USSD-based intake system, aligning the application with your monetization master plan.

## Changes Made

### 1. New Pricing & Plans (`UpgradeModal.tsx`)
- **[Product A: AI Exam Grading]**: Introduced a batch-based pricing model with 4 distinct tiers:
    - **Up to 50 papers**: $0.20 (Anchor: *"Less than the cost of a single sheet of paper."*)
    - **Up to 100 papers**: $0.41
    - **Up to 300 papers**: $1.10
    - **Up to 500 papers**: $1.84
- **[Product B: AI Selection Scoring]**: Positioned as **FREE ($0)** for the launch phase to build trust and adoption.
- **[USD-Only Display]**: Ensured all prices shown to the user are in USD, as per the master plan.

### 2. USSD Intake Sharing (`App.tsx`)
- **[USSD Instructions]**: Updated the "Share" functionality to provide applicants with USSD dialing instructions instead of a web link.
- **[Action Trigger]**: Clicking "**Share USSD Instructions**" in the menu now copies a message like: *"Apply via USSD: Dial *801*11# and enter code: [FormID]"*.

### 3. Payment & Currency Backend
- **[Server-side Conversion]**: Updated `PaymentService.ts` to automatically convert USD amounts to RWF at a fixed rate of **1:1470** for MTN MoMo transactions.
- **[One-time Batch Payments]**: Wired the `UpgradeModal` to `handleUpgrade` in `App.tsx`, which now prompts for an MTN phone number and initiates a "Request to Pay" for the selected batch tier.

## Verification Results

### UI/UX Consistency
- The **Upgrade Modal** clearly distinguishes between the two products and uses relatable anchor lines for pricing.
- The **3-dot menu** correctly labels the sharing action as "Share USSD Instructions".

### Functional Testing
- **Sharing**: Verified that the clipboard output contains the USSD dial string and the unique form code.
- **Payment Initiation**: Verified that selecting a batch tier triggers a MoMo payment flow, passing the USD-to-RWF converted amount to the backend.

> [!TIP]
> This structure maximizes competitiveness by offering near-zero price resistance for grading and a completely free entry point for institutional selection rounds.
