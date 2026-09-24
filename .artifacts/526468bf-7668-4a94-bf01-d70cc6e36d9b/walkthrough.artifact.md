# Walkthrough - Fixing ReferenceError in LeftSidebar

Fixed a `ReferenceError: onDeleteSession is not defined` in `LeftSidebar.tsx` that was causing the component to crash when rendering the recent chats list.

## Changes Made

### Components

#### [LeftSidebar.tsx](file:///C:/Users/niyib/Downloads/ai-marker-hub/src/components/LeftSidebar.tsx)
- Added `onDeleteSession` to the props destructuring in the `LeftSidebar` component.
- The prop was already defined in the `LeftSidebarProps` interface and being passed from `App.tsx`, but it was missing from the component's argument list, making it unavailable in the scope.

## Verification Results

### Manual Verification
- Verified that `onDeleteSession` is passed correctly from `App.tsx`.
- Verified that the `LeftSidebar` component now correctly accesses `onDeleteSession` when rendering the chat sessions.
- The error reported in the console (`Uncaught ReferenceError: onDeleteSession is not defined`) should be resolved.
