import { describe, expect, it } from 'vitest';
import { createNoopPlatform } from './noop-platform.js';
import { PlatformModule } from './platform.module.js';
import {
  CAPTURE_SOURCE,
  INPUT_CONTROLLER,
  PERMISSION_PROBE,
  TRADE_VISION,
  USER_INPUT_WATCHER,
} from './platform.tokens.js';

const ALL_TOKENS = [
  PERMISSION_PROBE,
  CAPTURE_SOURCE,
  TRADE_VISION,
  INPUT_CONTROLLER,
  USER_INPUT_WATCHER,
];

function providerValue(
  dynamicModule: ReturnType<typeof PlatformModule.register>,
  token: symbol,
): unknown {
  const providers = (dynamicModule.providers ?? []) as Array<{
    provide?: unknown;
    useValue?: unknown;
  }>;
  return providers.find((provider) => provider.provide === token)?.useValue;
}

describe('PlatformModule.register (boot contract)', () => {
  it('wires every port token to the supplied platform adapter (no typo, no missing token)', () => {
    const platform = createNoopPlatform();
    const dynamicModule = PlatformModule.register(platform);
    expect(providerValue(dynamicModule, PERMISSION_PROBE)).toBe(platform.permissionProbe);
    expect(providerValue(dynamicModule, CAPTURE_SOURCE)).toBe(platform.captureSource);
    expect(providerValue(dynamicModule, TRADE_VISION)).toBe(platform.tradeVision);
    expect(providerValue(dynamicModule, INPUT_CONTROLLER)).toBe(platform.inputController);
    expect(providerValue(dynamicModule, USER_INPUT_WATCHER)).toBe(platform.userInputWatcher);
  });

  it('is global and exports every port token (consumers resolve without importing it)', () => {
    const dynamicModule = PlatformModule.register(createNoopPlatform());
    expect(dynamicModule.global).toBe(true);
    for (const token of ALL_TOKENS) {
      expect(dynamicModule.exports).toContain(token);
    }
  });
});
