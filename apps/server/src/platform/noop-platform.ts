import type {
  CaptureSource,
  DesktopPlatform,
  InputController,
  PermissionProbe,
  TradeVision,
  UserInputWatcher,
} from './ports.js';

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
};

const noopTradeVision: TradeVision = {
  detectTradeWindow: () => Promise.resolve(null),
  locateItem: () => Promise.resolve(null),
};

const noopInputController: InputController = {
  moveHumanLike: () => Promise.resolve(),
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
