import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Typography } from '@mui/material';
import { CompositeResourceDefinition, getXRScope, XRScope } from '../../resources';
import { XRDCreatePanel } from './XRDCreateDialog';
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

function launchCreatePanel(cluster?: string) {
  const id = `crossplane-xrd-create-${Date.now()}`;
  Activity.launch({
    id,
    title: 'Create CompositeResourceDefinition',
    hideTitleInHeader: true,
    location: 'split-right',
    cluster,
    icon: <Icon icon="mdi:cube-outline" width="100%" height="100%" />,
    content: (
      <XRDCreatePanel onDone={() => Activity.close(id)} activityId={id} cluster={cluster} />
    ),
  });
}

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

  const headerActions = [
    <ActionButton
      description="Add CompositeResourceDefinition"
      icon="mdi:plus-circle"
      onClick={() => launchCreatePanel(xrds?.[0]?.cluster)}
    />,
  ];

  if (error?.status === 404) {
    return (
      <SectionBox
        title={
          <SectionFilterHeader title="Composite Resources" titleSideActions={headerActions} />
        }
      >
        <p>CompositeResourceDefinitions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  if (!xrds) {
    return (
      <SectionBox
        title={
          <SectionFilterHeader title="Composite Resources" titleSideActions={headerActions} />
        }
      >
        <p>Loading…</p>
      </SectionBox>
    );
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
      <SectionBox
        title={
          <SectionFilterHeader title="Composite Resources" titleSideActions={headerActions} />
        }
      >
        {!hasAny && <p>No CompositeResourceDefinitions found.</p>}
      </SectionBox>
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
