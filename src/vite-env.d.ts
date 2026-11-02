/// <reference types="vite/client" />

/** 构建时注入的版本（Dockerfile 的 `APP_VERSION` → `VITE_APP_VERSION`）。 */
declare const __APP_VERSION__: string
