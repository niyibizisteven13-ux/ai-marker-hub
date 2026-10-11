# Implementation Plan - Advanced Admin Dashboard Enterprise Features

## Goal
Implement key enterprise UX and productivity enhancements in the Admin Dashboard (`AdminPage.tsx`):
1. **Live Sidebar Count Badges**: Display live item counts (datasets, knowledge bases, models, fine-tune jobs) on sidebar navigation items.
2. **Dataset Search & Status Filtering**: Add instant search and status filter pills (All, Approved, Pending, Rejected) in the Dataset Inspector.
3. **Bulk Dataset Actions**: Add multi-select checkboxes for dataset examples to enable bulk approval and bulk rejection.
4. **Shimmer Loading Skeletons**: Replace plain text loading states with polished shimmering skeleton cards across all views.

## Proposed Changes

### Frontend (`src/pages/AdminPage.tsx`)
#### [MODIFY] [AdminPage.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/pages/AdminPage.tsx)
- Add sidebar count badges for key navigation items.
- Add search input and status filter pills to dataset examples inspection.
- Add multi-select selection state and bulk action toolbar (Bulk Approve / Bulk Reject).
- Implement professional shimmering loading skeleton components.

## Verification Plan

### Manual Verification
- Test sidebar badges, dataset search/filtering, bulk example selection, and shimmer loading states in the Admin Console.
