import { Icon } from '@iconify/react';
import {
  ConditionsTable,
  Link,
  MainInfoSection,
  ResourceTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { readyColumn, syncedColumn } from '../../components/columns';
import { ReadyStatus, SyncedStatus } from '../../components/ConditionStatus';
import {
  CompositeResourceDefinition,
  getXRScope,
  makeClaimClass,
} from '../../resources';

// ── Claim type section (one per XRD) ─────────────────────────────────────────

interface ClaimTypeSectionProps {
  xrd: KubeObject;
}

function ClaimTypeSection({ xrd }: ClaimTypeSectionProps) {
  const filterFunction = useFilterFunc();
  const spec = xrd.jsonData?.spec;
  const plural = spec?.claimNames?.plural ?? '';

  // Component is only rendered for XRDs with claimNames, so makeClaimClass is non-null here
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const ClaimClass = useMemo(() => makeClaimClass(xrd)!, [xrd.metadata.uid]);
  const [items] = ClaimClass.useList();

  if (!items?.length) return null;

  return (
    <ResourceTable.default
      data={items}
      filterFunction={filterFunction}
      enableRowActions
      columns={[
        {
          label: 'Name',
          getValue: (item: KubeObject) => item.metadata.name,
          render: (item: KubeObject) => (
            <Link
              routeName="crossplane-claim-detail"
              params={{
                plural,
                namespace: item.metadata.namespace,
                name: item.metadata.name,
              }}
            >
              {item.metadata.name}
            </Link>
          ),
        },
        'namespace',
        {
          label: 'XR Ref',
          getValue: (item: KubeObject) => item.jsonData?.spec?.resourceRef?.name ?? '-',
        },
        readyColumn,
        syncedColumn,
        'age',
      ]}
    />
  );
}

// ── Claims list page ──────────────────────────────────────────────────────────

export function ClaimsPage() {
  const [xrds, error] = CompositeResourceDefinition.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Claims">
        <p>CompositeResourceDefinitions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  if (!xrds) return <SectionBox title="Claims"><p>Loading…</p></SectionBox>;

  const legacyXRDs = xrds.filter(
    xrd => getXRScope(xrd) === 'LegacyCluster' && xrd.jsonData?.spec?.claimNames?.kind
  );

  if (!legacyXRDs.length) {
    return (
      <SectionBox title="Claims">
        <p>No legacy XRDs with claims found. Claims are only supported by v1 (LegacyCluster) XRDs.</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox title="Claims">
      <Typography variant="body2" color="textSecondary" sx={{ mb: 2, px: 1 }}>
        Claims are namespace-scoped proxies for cluster-scoped Composite Resources. Only
        available for v1 (LegacyCluster) XRDs.
      </Typography>
      {legacyXRDs.map(xrd => {
        const claimKind = xrd.jsonData?.spec?.claimNames?.kind ?? xrd.metadata.name;
        const claimPlural = xrd.jsonData?.spec?.claimNames?.plural ?? '';
        const group = xrd.jsonData?.spec?.group ?? '';
        return (
          <Accordion key={xrd.metadata.uid} defaultExpanded>
            <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
              <Box display="flex" alignItems="center" gap={1}>
                <Typography fontWeight={500}>{claimKind}</Typography>
                <Typography variant="body2" color="textSecondary">
                  {claimPlural}.{group}
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ p: 0 }}>
              <ClaimTypeSection xrd={xrd} />
            </AccordionDetails>
          </Accordion>
        );
      })}
    </SectionBox>
  );
}

// ── Claim detail page ─────────────────────────────────────────────────────────

export function ClaimDetailPage() {
  const { plural, namespace, name } = useParams<{
    plural: string;
    namespace: string;
    name: string;
  }>();
  const [xrds] = CompositeResourceDefinition.useList();
  const xrd =
    xrds?.find(x => x.jsonData?.spec?.claimNames?.plural === plural) ?? null;

  if (!xrds) return <SectionBox title="Claim"><p>Loading…</p></SectionBox>;
  if (!xrd)
    return (
      <SectionBox title="Claim">
        <p>No XRD found for claim type "{plural}".</p>
      </SectionBox>
    );

  return <ClaimDetailInner xrd={xrd} namespace={namespace} name={name} />;
}

interface ClaimDetailInnerProps {
  xrd: KubeObject;
  namespace: string;
  name: string;
}

function ClaimDetailInner({ xrd, namespace, name }: ClaimDetailInnerProps) {
  // Component is only rendered when XRD has claimNames, so makeClaimClass is non-null here
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const ClaimClass = useMemo(() => makeClaimClass(xrd)!, [xrd.metadata.uid]);
  const [item] = ClaimClass.useGet(name, namespace);

  const extraInfo = item
    ? [
        { name: 'Ready', value: <ReadyStatus item={item} /> },
        { name: 'Synced', value: <SyncedStatus item={item} /> },
        {
          name: 'Composite Resource',
          value: item.jsonData?.spec?.resourceRef?.name ?? '-',
        },
        {
          name: 'Composition',
          value: item.jsonData?.spec?.compositionRef?.name ?? '-',
        },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={item} extraInfo={extraInfo} backLink={null} />
      {item && <ConditionsTable resource={item.jsonData} />}
    </>
  );
}
