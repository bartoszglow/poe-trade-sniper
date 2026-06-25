import type {
  CaptureSource,
  DesktopPlatform,
  InputController,
  PermissionProbe,
  TradeVision,
  UserInputWatcher,
} from './ports.js';
import { PushedPermissionProbe } from './pushed-permission-probe.js';

/** Every capability inert — the default for web, CLI, dev (Vite), and tests. */
const noopPermissionProbe: PermissionProbe = {
  query: () => 'unsupported',
  request: () => Promise.resolve(),
  openSettingsPane: () => {},
};

const noopCaptureSource: CaptureSource = {
  capture: () => Promise.resolve({ width: 0, height: 0, pixels: new Uint8Array(0) }),
  focusGameWindow: () => Promise.resolve(false),
  isGameWindowFocused: () => Promise.resolve(false),
  windowCenter: () => Promise.resolve(null),
  frameToScreen: (point) => point,
};

const noopTradeVision: TradeVision = {
  analyze: () => ({ shopOpen: false, item: null }),
};

const noopInputController: InputController = {
  moveHumanLike: () => Promise.resolve(),
  placeCursor: () => Promise.resolve(),
};

const noopUserInputWatcher: UserInputWatcher = {
  onRealInput: () => () => {},
};

/**
 * The platform used whenever no real desktop bridge is supplied. Keeps the
 * server fully functional (and `pnpm verify`-able) without any native addon —
 * capture/vision/input are inert, so a gated action simply finds nothing/no grant.
 */
export function createNoopPlatform(): DesktopPlatform {
  return {
    permissionProbe: noopPermissionProbe,
    captureSource: noopCaptureSource,
    tradeVision: noopTradeVision,
    inputController: noopInputController,
    userInputWatcher: noopUserInputWatcher,
  };
}

/**
 * The standalone DEV server's platform: no-op everywhere except a pushable
 * permission probe, so the Electron main can feed it real macOS TCC status and
 * the gate behaves the same in `pnpm dev` as in the packaged app (dev↔prod
 * parity). Capture/vision/input stay no-op — their native execution needs the
 * in-process Electron server + real hardware.
 */
export function createDevPlatform(): DesktopPlatform {
  return { ...createNoopPlatform(), permissionProbe: new PushedPermissionProbe() };
}
