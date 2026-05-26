import { SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Typography } from '@mui/material';
import { CompositeResourceDefinition, getXRScope, XRScope } from '../../resources';
import { XRTypeSection } from './XRTypeSection';

const SCOPE_LABELS: Record<XRScope, string> = {
  Namespaced: 'Namespaced Composite Resources',
  Cluster: 'Cluster-Scoped Composite Resources',
  LegacyCluster: 'Legacy Composite Resources',
};

const SCOPE_DESCRIPTIONS: Record<XRScope, string> = {
  Namespaced: 'XRs that live directly in a namespace. No claims.',
  Cluster: 'XRs that are cluster-scoped. No claims.',
  LegacyCluster: 'Cluster-scoped XRs from v1 XRDs. Claims may also exist.',
};

interface ScopeSectionProps {
  title: string;
  description: string;
  xrds: KubeObject[];
  scope: XRScope;
}

function ScopeSection({ title, description, xrds, scope }: ScopeSectionProps) {
  if (!xrds.length) return null;

  return (
    <SectionBox title={title}>
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2, px: 1 }}>
        {description}
      </Typography>
      {xrds.map(xrd => (
        <XRTypeSection key={xrd.metadata.uid} xrd={xrd} scope={scope} />
      ))}
    </SectionBox>
  );
}

export function XRDListPage() {
  const [xrds, error] = CompositeResourceDefinition.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Composite Resources">
        <p>CompositeResourceDefinitions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  if (!xrds) {
    return <SectionBox title="Composite Resources"><p>Loading…</p></SectionBox>;
  }

  const byScope: Record<XRScope, KubeObject[]> = {
    Namespaced: [],
    Cluster: [],
    LegacyCluster: [],
  };

  for (const xrd of xrds) {
    byScope[getXRScope(xrd)].push(xrd);
  }

  const hasAny = xrds.length > 0;

  return (
    <>
      {!hasAny && (
        <SectionBox title="Composite Resources">
          <p>No CompositeResourceDefinitions found.</p>
        </SectionBox>
      )}
      {(['Namespaced', 'Cluster', 'LegacyCluster'] as XRScope[]).map(scope => (
        <ScopeSection
          key={scope}
          title={SCOPE_LABELS[scope]}
          description={SCOPE_DESCRIPTIONS[scope]}
          xrds={byScope[scope]}
          scope={scope}
        />
      ))}
    </>
  );
}
