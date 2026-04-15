import { describe, expect, it, vi } from 'vitest';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: {
      Deployment: { kind: 'Deployment', apiVersion: 'apps/v1', apiName: 'deployments' },
      Pod: { kind: 'Pod', apiVersion: 'v1', apiName: 'pods' },
      Service: { kind: 'Service', apiVersion: 'v1', apiName: 'services' },
    },
  },
}));

vi.mock('@kinvolk/headlamp-plugin/lib/k8s/cluster', () => ({
  KubeObject: class {},
}));

import { buildGetPath, getGroupVersion, lookupPlural } from './apiPaths';

describe('getGroupVersion', () => {
  it('splits group/version', () => {
    expect(getGroupVersion('apps/v1')).toEqual(['apps', 'v1']);
  });
  it('returns empty group for core API', () => {
    expect(getGroupVersion('v1')).toEqual(['', 'v1']);
  });
  it('handles crossplane group', () => {
    expect(getGroupVersion('apiextensions.crossplane.io/v1')).toEqual([
      'apiextensions.crossplane.io',
      'v1',
    ]);
  });
});

describe('buildGetPath', () => {
  it('builds namespaced path for grouped API', () => {
    expect(buildGetPath('apps/v1', 'deployments', 'my-deploy', 'default')).toBe(
      '/apis/apps/v1/namespaces/default/deployments/my-deploy'
    );
  });
  it('builds cluster-scoped path for grouped API', () => {
    expect(buildGetPath('apps/v1', 'deployments', 'my-deploy')).toBe(
      '/apis/apps/v1/deployments/my-deploy'
    );
  });
  it('builds namespaced path for core API', () => {
    expect(buildGetPath('v1', 'pods', 'my-pod', 'kube-system')).toBe(
      '/api/v1/namespaces/kube-system/pods/my-pod'
    );
  });
  it('builds cluster-scoped path for core API', () => {
    expect(buildGetPath('v1', 'nodes', 'my-node')).toBe('/api/v1/nodes/my-node');
  });
});

describe('lookupPlural', () => {
  it('finds plural for native grouped resource', () => {
    expect(lookupPlural('apps/v1', 'Deployment', null)).toBe('deployments');
  });
  it('finds plural for native core resource', () => {
    expect(lookupPlural('v1', 'Pod', null)).toBe('pods');
  });
  it('falls back to CRD list for custom resources', () => {
    const crds = [
      { jsonData: { spec: { group: 'example.io', names: { kind: 'Foo', plural: 'foos' } } } },
    ] as any;
    expect(lookupPlural('example.io/v1', 'Foo', crds)).toBe('foos');
  });
  it('returns undefined when not found in K8s or CRDs', () => {
    expect(lookupPlural('example.io/v1', 'Unknown', [])).toBeUndefined();
  });
  it('returns undefined when CRDs is null and resource is unknown', () => {
    expect(lookupPlural('example.io/v1', 'Unknown', null)).toBeUndefined();
  });
});
