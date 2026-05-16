/**
 * 兼容入口：引擎实现已迁至 scripts/engine/（direct-client / fallback-client / query-orchestrator）。
 */
export { decryptTarget } from './engine/crypto.mjs';
export { classifyError } from './engine/classify-error.mjs';
export { AvsovSearchCore } from './engine/query-orchestrator.mjs';
