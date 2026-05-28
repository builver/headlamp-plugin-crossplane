import { Icon } from '@iconify/react';
import { Activity, K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Accordion, AccordionDetails, AccordionSummary, Box, Chip, Link as MuiLink, Typography } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { linkSx } from '../../components/ActivityNameLink';
import { ReadyStatus } from '../../components/ConditionStatus';
import { Provider } from '../../resources';
import { ConfigCRDInfo, getOrCreateClass } from '../../resources/crdClassCache';
import { ProviderConfigDetailInner } from './ProviderConfigDetailPage';

function useProviderConfigCRDs(): {
  configs: ConfigCRDInfo[];
  loading: boolean;
} {
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();

  return useMemo(() => {
    if (!crds) return { configs: [], loading: true };

    const configs: ConfigCRDInfo[] = [];
    for (const crd of crds) {
      const spec = crd.jsonData?.spec;
      const kind = spec?.names?.kind;
      if (kind !== 'ProviderConfig' && kind !== 'ClusterProviderConfig') continue;

      const group = spec.group;
      const plural = spec.names.plural;
      const versions = (spec.versions ?? [])
        .filter((v: any) => v.served !== false)
        .map((v: any) => ({ group, version: v.name }));

      configs.push({
        crdName: crd.metadata.name,
        group,
        kind,
        plural,
        versions,
        isNamespaced: spec.scope === 'Namespaced',
      });
    }

    return { configs, loading: false };
  }, [crds]);
}

interface TaggedItem {
  item: KubeObject;
  cfg: ConfigCRDInfo;
}

/** Invisible component that fetches items for one CRD and reports them to the parent. */
function CRDItemsFetcher({ cfg, onItems }: { cfg: ConfigCRDInfo; onItems: (crdName: string, items: KubeObject[]) => void }) {
  const Cls = getOrCreateClass(cfg);
  const [items] = Cls.useList();
  const prevRef = useRef<KubeObject[] | null>(null);
  useEffect(() => {
    if (items !== prevRef.current) {
      prevRef.current = items;
      onItems(cfg.crdName, items ?? []);
    }
  }, [items, cfg.crdName, onItems]);
  return null;
}

function mergedColumns() {
  return [
    {
      header: 'Name',
      accessorFn: (row: TaggedItem) => row.item.metadata.name,
      Cell: ({ row: { original: row } }: any) => {
        const { item, cfg } = row as TaggedItem;
        const launch = () => {
          Activity.launch({
            id: `crossplane-providerconfig-${cfg.crdName}-${item.metadata.name}`,
            title: `${cfg.kind} ${item.metadata.name}`,
            hideTitleInHeader: true,
            location: 'split-right',
            cluster: item.cluster,
            content: <ProviderConfigDetailInner crdName={cfg.crdName} name={item.metadata.name} />,
          });
        };
        return (
          <MuiLink component="button" onClick={launch} sx={linkSx}>
            {item.metadata.name}
          </MuiLink>
        );
      },
    },
    {
      header: 'Kind',
      accessorFn: (row: TaggedItem) => row.cfg.kind,
    },
    {
      header: 'API Version',
      accessorFn: (row: TaggedItem) => row.item.jsonData?.apiVersion ?? '-',
    },
    {
      header: 'Users',
      accessorFn: (row: TaggedItem) => row.item.jsonData?.status?.users ?? 0,
    },
    {
      header: 'Ready',
      accessorFn: (row: TaggedItem) => {
        const cond = row.item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Ready');
        return cond?.status ?? '-';
      },
      Cell: ({ row: { original: row } }: any) => <ReadyStatus item={(row as TaggedItem).item} />,
    },
    {
      header: 'Age',
      accessorFn: (row: TaggedItem) => row.item.metadata.creationTimestamp ?? '',
      Cell: ({ row: { original: row } }: any) => (
        <DateLabel date={(row as TaggedItem).item.metadata.creationTimestamp} format="mini" />
      ),
    },
  ];
}

function ProviderAccordion({ provider, cfgs }: { provider: string; cfgs: ConfigCRDInfo[] }) {
  const [itemsByKey, setItemsByKey] = useState<Record<string, KubeObject[]>>({});
  const onItems = useCallback((crdName: string, items: KubeObject[]) => {
    setItemsByKey(prev => (prev[crdName] === items ? prev : { ...prev, [crdName]: items }));
  }, []);

  const cfgMap = useMemo(() => new Map(cfgs.map(c => [c.crdName, c])), [cfgs]);

  const merged: TaggedItem[] = useMemo(() => {
    const all: TaggedItem[] = [];
    for (const [crdName, items] of Object.entries(itemsByKey)) {
      const cfg = cfgMap.get(crdName);
      if (cfg) {
        for (const item of items) {
          all.push({ item, cfg });
        }
      }
    }
    return all;
  }, [itemsByKey, cfgMap]);

  const columns = useMemo(() => mergedColumns(), []);

  return (
    <Accordion disableGutters elevation={0} sx={{ '&:before': { display: 'none' } }}>
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="h6">{provider}</Typography>
          <Chip label={merged.length} size="small" />
        </Box>
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {cfgs.map(cfg => <CRDItemsFetcher key={cfg.crdName} cfg={cfg} onItems={onItems} />)}
        {merged.length > 0 ? (
          <Table data={merged} columns={columns} />
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ pl: 2, pb: 1 }}>
            No instances
          </Typography>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export function ProviderConfigListPage() {
  const { configs, loading } = useProviderConfigCRDs();
  const [providers] = Provider.useList();

  const byProvider = useMemo(() => {
    const map = new Map<string, ConfigCRDInfo[]>();
    for (const cfg of configs) {
      let providerName: string | null = null;
      if (providers) {
        const groupFirst = cfg.group.split('.')[0];
        if (groupFirst) {
          providerName = providers.find(
            (p) => (p.metadata.name as string).includes(groupFirst)
          )?.metadata.name as string | undefined ?? null;
        }
      }
      const key = providerName ?? cfg.group;
      const list = map.get(key) ?? [];
      list.push(cfg);
      map.set(key, list);
    }
    return map;
  }, [providers, configs]);

  if (loading) {
    return (
      <SectionBox title="Provider Configs">
        <Typography>Loading…</Typography>
      </SectionBox>
    );
  }

  if (configs.length === 0) {
    return (
      <SectionBox title="Provider Configs">
        <Typography>No ProviderConfig or ClusterProviderConfig CRDs found.</Typography>
      </SectionBox>
    );
  }

  const sortedProviders = [...byProvider.keys()].sort();

  return (
    <>
      <SectionBox title={<SectionFilterHeader title="Provider Configs" />} />
      {sortedProviders.map(provider => (
        <ProviderAccordion
          key={provider}
          provider={provider}
          cfgs={byProvider.get(provider)!}
        />
      ))}
    </>
  );
}
