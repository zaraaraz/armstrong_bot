import { PluginDependencyResolver } from './plugin-dependency.resolver';
import { PluginRegistry } from './plugin-registry';
import { PluginErrorCode } from '../errors/plugin.errors';
import { PluginStatus, PluginScope } from '../contracts/plugin.enums';
import type { PluginManifest } from '../contracts/plugin-manifest.interface';
import { z } from 'zod';

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    displayName: 'Test',
    description: 'Test plugin',
    author: 'test',
    scope: PluginScope.Guild,
    sdkRange: '>=1.0.0 <2.0.0',
    dependencies: [],
    permissions: [],
    services: [],
    configSchema: z.object({}),
    i18nNamespaces: [],
    ...overrides,
  };
}

describe('PluginDependencyResolver', () => {
  let registry: PluginRegistry;
  let resolver: PluginDependencyResolver;

  beforeEach(() => {
    registry = new PluginRegistry();
    resolver = new PluginDependencyResolver(registry);
  });

  describe('validateSdkRange', () => {
    it('accepts matching sdk range', () => {
      const manifest = makeManifest({ sdkRange: '>=1.0.0 <2.0.0' });
      expect(() => resolver.validateSdkRange(manifest, '1.5.0')).not.toThrow();
    });

    it('rejects out-of-range sdk version', () => {
      const manifest = makeManifest({ sdkRange: '>=2.0.0' });
      expect(() => resolver.validateSdkRange(manifest, '1.5.0')).toThrow(
        expect.objectContaining({ code: PluginErrorCode.SdkIncompatible }),
      );
    });
  });

  describe('validateDependencies', () => {
    it('passes when all required deps are loaded with compatible versions', () => {
      registry.set('dep-a', {
        plugin: {
          manifest: makeManifest({ name: 'dep-a', version: '2.1.0' }),
          onEnable: vi.fn(),
          onDisable: vi.fn(),
        },
        status: PluginStatus.Enabled,
        enabledGuilds: new Set(),
        registeredCommandIds: [],
        disposers: [],
      });
      const manifest = makeManifest({
        dependencies: [{ name: 'dep-a', range: '^2.0.0' }],
      });
      expect(() => resolver.validateDependencies(manifest)).not.toThrow();
    });

    it('throws DependencyMissing when required dep is absent', () => {
      const manifest = makeManifest({
        dependencies: [{ name: 'missing-dep', range: '^1.0.0' }],
      });
      expect(() => resolver.validateDependencies(manifest)).toThrow(
        expect.objectContaining({ code: PluginErrorCode.DependencyMissing }),
      );
    });

    it('throws DependencyIncompatible when version out of range', () => {
      registry.set('dep-a', {
        plugin: {
          manifest: makeManifest({ name: 'dep-a', version: '3.0.0' }),
          onEnable: vi.fn(),
          onDisable: vi.fn(),
        },
        status: PluginStatus.Enabled,
        enabledGuilds: new Set(),
        registeredCommandIds: [],
        disposers: [],
      });
      const manifest = makeManifest({
        dependencies: [{ name: 'dep-a', range: '^2.0.0' }],
      });
      expect(() => resolver.validateDependencies(manifest)).toThrow(
        expect.objectContaining({
          code: PluginErrorCode.DependencyIncompatible,
        }),
      );
    });

    it('skips optional missing deps', () => {
      const manifest = makeManifest({
        dependencies: [
          { name: 'optional-dep', range: '^1.0.0', required: false },
        ],
      });
      expect(() => resolver.validateDependencies(manifest)).not.toThrow();
    });
  });

  describe('topologicalOrder', () => {
    it('returns single manifest unchanged', () => {
      const m = makeManifest();
      expect(resolver.topologicalOrder([m])).toEqual([m]);
    });

    it('orders dependencies before dependents', () => {
      const depA = makeManifest({ name: 'dep-a', dependencies: [] });
      const depB = makeManifest({
        name: 'dep-b',
        dependencies: [{ name: 'dep-a', range: '*' }],
      });
      const result = resolver.topologicalOrder([depB, depA]);
      const names = result.map((m) => m.name);
      expect(names.indexOf('dep-a')).toBeLessThan(names.indexOf('dep-b'));
    });

    it('detects dependency cycles', () => {
      const a = makeManifest({
        name: 'a',
        dependencies: [{ name: 'b', range: '*' }],
      });
      const b = makeManifest({
        name: 'b',
        dependencies: [{ name: 'a', range: '*' }],
      });
      expect(() => resolver.topologicalOrder([a, b])).toThrow(
        expect.objectContaining({ code: PluginErrorCode.DependencyCycle }),
      );
    });
  });
});
