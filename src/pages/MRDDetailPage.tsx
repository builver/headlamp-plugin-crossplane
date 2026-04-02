import {
  ConditionsTable,
  Link,
  MainInfoSection,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { Box, Chip } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { ManagedResourceDefinition, Provider } from '../resources';

export function MRDDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [mrds] = ManagedResourceDefinition.useList();

  const mrd = mrds?.find(m => m.metadata.name === name) ?? null;
  const scope = mrd?.jsonData?.spec?.scope ?? null;

  const extraInfo = mrd
    ? [
        { name: 'Group', value: mrd.jsonData?.spec?.group ?? '-' },
        { name: 'Kind', value: mrd.jsonData?.spec?.names?.kind ?? '-' },
        { name: 'Plural', value: mrd.jsonData?.spec?.names?.plural ?? '-' },
        { name: 'Scope', value: scope ?? '-' },
        { name: 'State', value: mrd.jsonData?.spec?.state ?? '-' },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={mrd} extraInfo={extraInfo} />
      {scope && (
        <Box mt={1} ml={2}>
          <Chip
            label={scope === 'Namespaced' ? 'Namespaced' : 'Cluster-scoped'}
            color={scope === 'Namespaced' ? 'primary' : 'default'}
            size="small"
          />
        </Box>
      )}
      {mrd && <ConditionsTable resource={mrd.jsonData} />}
    </>
  );
}

export function MRDScopeGroupPage() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  // path: /crossplane/providers/<providerName>/cluster or /namespaced
  const scopeSegment = parts[parts.length - 1];
  const providerName = parts[parts.length - 2];
  const isNamespaced = scopeSegment === 'namespaced';

  const [mrds] = ManagedResourceDefinition.useList();
  const [providers] = Provider.useList();

  const filteredMRDs =
    mrds && providers
      ? mrds.filter(mrd => {
          const ownerRef = mrd.metadata?.ownerReferences?.find(
            (ref: any) => ref.kind === 'Provider'
          );
          if (!ownerRef) return false;
          const ownerProvider = providers.find(p => p.metadata.uid === ownerRef.uid);
          if (!ownerProvider || ownerProvider.metadata.name !== providerName) return false;
          const mrdScope = mrd.jsonData?.spec?.scope ?? 'Cluster';
          return isNamespaced ? mrdScope === 'Namespaced' : mrdScope !== 'Namespaced';
        })
      : null;

  const title = `${isNamespaced ? 'Namespaced' : 'Cluster-scoped'} Resources`;

  return (
    <SectionBox title={title}>
      <Table
        data={filteredMRDs}
        loading={filteredMRDs === null}
        columns={[
          {
            header: 'Kind',
            accessorFn: (item: any) => item.jsonData?.spec?.names?.kind ?? '-',
            Cell: ({ row: { original: item } }: any) => (
              <Link routeName={`crossplane-mrd-detail-${item.metadata.name}`}>
                {item.jsonData?.spec?.names?.kind ?? item.metadata.name}
              </Link>
            ),
          },
          {
            header: 'Group',
            accessorFn: (item: any) => item.jsonData?.spec?.group ?? '-',
          },
          {
            header: 'Plural',
            accessorFn: (item: any) => item.jsonData?.spec?.names?.plural ?? '-',
          },
        ]}
      />
    </SectionBox>
  );
}
