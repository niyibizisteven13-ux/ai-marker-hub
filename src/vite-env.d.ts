/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_AI_SCAN?: string;
  readonly VITE_ENABLE_MOCK_ARTIFACTS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
