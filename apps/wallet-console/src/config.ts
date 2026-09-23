export * from './frontendConfig';
import { loadFrontendConfig } from './frontendConfig';

export const FRONTEND_CONFIG = Object.freeze(await loadFrontendConfig(import.meta.env));
