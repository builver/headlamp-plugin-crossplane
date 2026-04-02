import {
  ConditionsTable,
  Link,
  MainInfoSection,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { Box, FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { useMemo, useState } from 'react';
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
{mrd && <ConditionsTable resource={mrd.jsonData} />}
    </>
  );
}

export function MRDListPage() {
  const [mrds] = ManagedResourceDefinition.useList();
  const [providers] = Provider.useList();
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedScope, setSelectedScope] = useState<string>('');

  const providerNames: string[] = useMemo(() => {
    if (!mrds || !providers) return [];
    const names = new Set<string>();
    for (const mrd of mrds) {
      const ownerRef = mrd.metadata?.ownerReferences?.find((r: any) => r.kind === 'Provider');
      const p = providers.find(p => p.metadata.uid === ownerRef?.uid);
      if (p?.metadata.name) names.add(p.metadata.name);
    }
    return [...names].sort();
  }, [mrds, providers]);

  const filtered = useMemo(() => {
    if (!mrds || !providers) return null;
    return mrds.filter(mrd => {
      if (selectedProvider) {
        const ownerRef = mrd.metadata?.ownerReferences?.find((r: any) => r.kind === 'Provider');
        const p = providers.find(p => p.metadata.uid === ownerRef?.uid);
        if (p?.metadata.name !== selectedProvider) return false;
      }
      if (selectedScope) {
        const scope = mrd.jsonData?.spec?.scope ?? 'Cluster';
        if (selectedScope === 'Namespaced' && scope !== 'Namespaced') return false;
        if (selectedScope === 'Cluster' && scope === 'Namespaced') return false;
      }
      return true;
    });
  }, [mrds, providers, selectedProvider, selectedScope]);

  return (
    <SectionBox title="Managed Resources">
      <Box display="flex" gap={2} mb={2}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Provider</InputLabel>
          <Select
            value={selectedProvider}
            label="Provider"
            onChange={e => setSelectedProvider(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            {providerNames.map(n => (
              <MenuItem key={n} value={n}>
                {n}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Scope</InputLabel>
          <Select
            value={selectedScope}
            label="Scope"
            onChange={e => setSelectedScope(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="Cluster">Cluster</MenuItem>
            <MenuItem value="Namespaced">Namespaced</MenuItem>
          </Select>
        </FormControl>
      </Box>
      <Table
        data={filtered}
        loading={filtered === null}
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
          {
            header: 'Provider',
            accessorFn: (item: any) => {
              const ownerRef = item.metadata?.ownerReferences?.find(
                (r: any) => r.kind === 'Provider'
              );
              return ownerRef?.name ?? '-';
            },
          },
          {
            header: 'Scope',
            accessorFn: (item: any) => item.jsonData?.spec?.scope ?? 'Cluster',
          },
        ]}
      />
    </SectionBox>
  );
}
