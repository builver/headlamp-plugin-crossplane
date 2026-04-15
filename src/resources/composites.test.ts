import { describe, expect, it } from 'vitest';
// helpers.ts has no headlamp-plugin dependency — no mocking required.
import {
  getCompositionRef,
  getHealthyCondition,
  getInstalledCondition,
  getReadyCondition,
  getSyncedCondition,
  getXRScope,
} from './helpers';

function fakeItem(jsonData: object) {
  return { jsonData } as any;
}

describe('getXRScope', () => {
  it('returns Namespaced for v2 Namespaced XRD', () => {
    expect(getXRScope(fakeItem({ spec: { scope: 'Namespaced' } }))).toBe('Namespaced');
  });
  it('returns Cluster for v2 Cluster XRD', () => {
    expect(getXRScope(fakeItem({ spec: { scope: 'Cluster' } }))).toBe('Cluster');
  });
  it('returns LegacyCluster when scope is absent (v1 XRD)', () => {
    expect(getXRScope(fakeItem({ spec: {} }))).toBe('LegacyCluster');
  });
  it('returns LegacyCluster when spec is absent', () => {
    expect(getXRScope(fakeItem({}))).toBe('LegacyCluster');
  });
});

describe('getCompositionRef', () => {
  it('reads from spec.compositionRef for LegacyCluster', () => {
    const item = fakeItem({ spec: { compositionRef: { name: 'my-comp' } } });
    expect(getCompositionRef(item, 'LegacyCluster')).toBe('my-comp');
  });
  it('returns "-" when LegacyCluster compositionRef is missing', () => {
    expect(getCompositionRef(fakeItem({ spec: {} }), 'LegacyCluster')).toBe('-');
  });
  it('reads from spec.crossplane.compositionRef for Namespaced', () => {
    const item = fakeItem({ spec: { crossplane: { compositionRef: { name: 'v2-comp' } } } });
    expect(getCompositionRef(item, 'Namespaced')).toBe('v2-comp');
  });
  it('reads from spec.crossplane.compositionRef for Cluster', () => {
    const item = fakeItem({ spec: { crossplane: { compositionRef: { name: 'v2-comp' } } } });
    expect(getCompositionRef(item, 'Cluster')).toBe('v2-comp');
  });
  it('returns "-" when v2 compositionRef is missing', () => {
    expect(getCompositionRef(fakeItem({ spec: {} }), 'Namespaced')).toBe('-');
  });
});

describe('condition accessors', () => {
  const item = fakeItem({
    status: {
      conditions: [
        { type: 'Ready', status: 'True', reason: 'Available' },
        { type: 'Synced', status: 'False', reason: 'ReconcileError' },
        { type: 'Installed', status: 'True' },
        { type: 'Healthy', status: 'True' },
      ],
    },
  });

  it('getReadyCondition returns the Ready condition', () => {
    expect(getReadyCondition(item)).toEqual({ type: 'Ready', status: 'True', reason: 'Available' });
  });
  it('getSyncedCondition returns the Synced condition', () => {
    expect(getSyncedCondition(item)).toEqual({
      type: 'Synced',
      status: 'False',
      reason: 'ReconcileError',
    });
  });
  it('getInstalledCondition returns the Installed condition', () => {
    expect(getInstalledCondition(item)).toEqual({ type: 'Installed', status: 'True' });
  });
  it('getHealthyCondition returns the Healthy condition', () => {
    expect(getHealthyCondition(item)).toEqual({ type: 'Healthy', status: 'True' });
  });
  it('returns null when condition type is not present', () => {
    const empty = fakeItem({ status: { conditions: [] } });
    expect(getReadyCondition(empty)).toBeNull();
  });
  it('returns null when status is absent', () => {
    expect(getReadyCondition(fakeItem({}))).toBeNull();
  });
});
