# Implementation Plan - Add Browser Extension Generation Tool

Add a new capability to the AI that allows it to generate a browser extension for blocking websites, based on the logic provided in the Python script.

## Proposed Changes

### [MODIFY] [ToolRegistry.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/ToolRegistry.ts)
- Add `generate_browser_extension` to `ToolRegistry`. This tool will take an `extension_name` and a list of `blocked_domains`.

### [MODIFY] [generalTools.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server/services/generalTools.ts)
- Update the `load_specialized_tool` definition to include `generate_browser_extension` in its `tool_name` enum.

### [MODIFY] [server.ts](file:///C:/Users/niyib/Downloads/ai-marker-hub/server.ts)
- Add a new case in the `executeTool` function within the `generalAssist` endpoint to handle `generate_browser_extension`.
- The implementation will:
    1. Create a unique directory inside `exports/extensions/`.
    2. Generate a `manifest.json` using Manifest V3 standards.
    3. Generate a `rules.json` file containing blocking rules for the specified domains using the `declarativeNetRequest` API.
    4. Return a success message with the location of the generated files.

## Verification Plan

### Automated Tests
- Create a scratch script `verify_extension_gen.ts` to test the file creation logic with mock inputs.

### Manual Verification
- Use the chat interface to trigger the tool: "Generate a browser extension called 'DistractionFree' that blocks tiktok.com and youtube.com".
- Verify that the directory `exports/extensions/DistractionFree/` exists and contains the correct `manifest.json` and `rules.json`.
