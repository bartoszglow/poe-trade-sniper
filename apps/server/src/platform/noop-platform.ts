import type { DesktopPlatform, PermissionProbe } from './ports.js';

/** Every capability inert — the default for web, CLI, dev (Vite), and tests. */
const noopPermissionProbe: PermissionProbe = {
  query: () => 'unsupported',
  request: async () => {},
  openSettingsPane: () => {},
};

/**
 * The platform used whenever no real desktop bridge is supplied. Keeps the
 * server fully functional (and `pnpm verify`-able) without any native addon.
 */
export function createNoopPlatform(): DesktopPlatform {
  return { permissionProbe: noopPermissionProbe };
}
