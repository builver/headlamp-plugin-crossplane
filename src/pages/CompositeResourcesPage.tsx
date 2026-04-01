import { Icon } from '@iconify/react';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Typography,
} from '@mui/material';
import { XRTypeSection } from '../components/XRTypeSection';
import { CompositeResourceDefinition, getXRScope, XRScope } from '../resources';

const SCOPE_LABELS: Record<XRScope, string> = {
  Namespaced: 'Namespaced Composite Resources (v2)',
  Cluster: 'Cluster-Scoped Composite Resources (v2)',
  LegacyCluster: 'Legacy Composite Resources (v1)',
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
      {xrds.map(xrd => {
        const kind = xrd.jsonData?.spec?.names?.kind ?? xrd.metadata.name;
        const plural = xrd.jsonData?.spec?.names?.plural ?? '';
        const group = xrd.jsonData?.spec?.group ?? '';
        return (
          <Accordion key={xrd.metadata.uid} defaultExpanded>
            <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
              <Box display="flex" alignItems="center" gap={1}>
                <Typography fontWeight={500}>{kind}</Typography>
                <Typography variant="body2" color="textSecondary">
                  {plural}.{group}
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <XRTypeSection xrd={xrd} scope={scope} />
            </AccordionDetails>
          </Accordion>
        );
      })}
    </SectionBox>
  );
}

export function CompositeResourcesPage() {
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
