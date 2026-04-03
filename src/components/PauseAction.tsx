import { ActionButton } from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useState } from 'react';

interface PauseActionProps {
  item: KubeObject;
  /** The XRD or MRD that defines this resource — provides group, version, plural. */
  crd: KubeObject;
}

/**
 * Pause / resume reconciliation action for any Crossplane resource.
 * Works for both XRs (backed by an XRD) and managed resources (backed by an MRD)
 * since both share the same spec shape: spec.group, spec.versions, spec.names.plural.
 */
export function PauseAction({ item, crd }: PauseActionProps) {
  const isPaused = item.metadata?.annotations?.['crossplane.io/paused'] === 'true';
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    const spec = crd.jsonData?.spec;
    const group: string = spec?.group ?? '';
    const versions: any[] = (spec?.versions ?? []).filter((v: any) => v.served !== false);
    const version: string = versions[0]?.name ?? 'v1';
    const plural: string = spec?.names?.plural ?? '';
    const { name, namespace } = item.metadata;

    const basePath = `/apis/${group}/${version}`;
    const path = namespace
      ? `${basePath}/namespaces/${namespace}/${plural}/${name}`
      : `${basePath}/${plural}/${name}`;

    const patch = {
      metadata: {
        annotations: { 'crossplane.io/paused': isPaused ? null : 'true' },
      },
    };

    setLoading(true);
    try {
      await ApiProxy.request(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ActionButton
      description={isPaused ? 'Resume reconciliation' : 'Pause reconciliation'}
      icon={isPaused ? 'mdi:play' : 'mdi:pause'}
      onClick={handleClick}
      iconButtonProps={{ disabled: loading }}
    />
  );
}
