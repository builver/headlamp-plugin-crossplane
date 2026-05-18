import { Icon } from '@iconify/react';
import {
  ConditionsTable,
  DataField,
  Link,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { MatchExpressions } from '@kinvolk/headlamp-plugin/lib/components/common/Resource';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { stringify as yamlStringify } from 'yaml';
import { makeXRNameColumn, readyColumn, syncedColumn } from '../../components/columns';
import { getGroupVersion } from '../../components/map/apiPaths';
import {
  CompositeResourceDefinition,
  Composition,
  getCompositionRef,
  getXRScope,
  makeXRClass,
  ManagedResourceDefinition,
  XRScope,
} from '../../resources';
import { KroStepGraph } from './CompositionNodeEditor';

interface RequiredResource {
  requirementName: string;
  apiVersion: string;
  kind: string;
  name?: string;
  matchLabels?: Record<string, string>;
  namespace?: string;
}

interface RequiredSchema {
  requirementName: string;
  apiVersion: string;
  kind: string;
}

interface PipelineStepRequirements {
  requiredResources?: RequiredResource[];
  requiredSchemas?: RequiredSchema[];
}

interface PipelineStep {
  step: string;
  functionRef: { name: string };
  input?: Record<string, unknown>;
  requirements?: PipelineStepRequirements;
}

function getServedSchema(jsonData: any): any {
  const versions: any[] = jsonData?.spec?.versions ?? [];
  const served = versions.find((v: any) => v.served !== false) ?? versions[0];
  return served?.schema?.openAPIV3Schema ?? null;
}

function isKroStep(s: PipelineStep): boolean {
  return !!(
    s.functionRef?.name?.includes('kro') ||
    (s.input as any)?.kind === 'ResourceGraph'
  );
}

interface ComposedXRsProps {
  xrd: KubeObject;
  compositionName: string;
}

function ComposedXRs({ xrd, compositionName }: ComposedXRsProps) {
  const filterFunction = useFilterFunc();
  const scope: XRScope = getXRScope(xrd);
  const plural = xrd.jsonData?.spec?.names?.plural ?? '';
  const DynClass = useMemo(() => makeXRClass(xrd), [xrd.metadata.uid]);
  const [items] = DynClass.useList();

  const filtered = useMemo(
    () => items?.filter(item => getCompositionRef(item, scope) === compositionName) ?? [],
    [items, compositionName, scope]
  );

  const columns = useMemo(() => [
    makeXRNameColumn(plural, scope),
    ...(scope === 'Namespaced' ? ['namespace' as const] : []),
    readyColumn,
    syncedColumn,
    'age' as const,
  ], [plural, scope]);

  return (
    <SectionBox title="Composite Resources">
      <ResourceTable.default
        data={filtered}
        filterFunction={filterFunction}
        enableRowActions
        columns={columns}
      />
    </SectionBox>
  );
}

export function CompositionDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [comp] = Composition.useGet(name);
  const [xrds] = CompositeResourceDefinition.useList();
  const [mrds] = ManagedResourceDefinition.useList();

  const compTypeRef = comp?.jsonData?.spec?.compositeTypeRef;

  const matchingXrd = useMemo(() => {
    if (!xrds || !compTypeRef) return null;
    const group = getGroupVersion((compTypeRef.apiVersion as string) ?? '')[0];
    return xrds.find(
      x => x.jsonData?.spec?.names?.kind === compTypeRef.kind && x.jsonData?.spec?.group === group
    ) ?? null;
  }, [xrds, compTypeRef]);

  const xrdSchema = useMemo(() => getServedSchema(matchingXrd?.jsonData), [matchingXrd]);
  const xrdScope  = useMemo(() => matchingXrd ? getXRScope(matchingXrd) : undefined, [matchingXrd]);

  const mrdSchemaMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const mrd of mrds ?? []) {
      const group: string = mrd.jsonData?.spec?.group ?? '';
      const kind: string  = mrd.jsonData?.spec?.names?.kind ?? '';
      if (!group || !kind) continue;
      const schema = getServedSchema(mrd.jsonData);
      if (schema) map.set(`${group}/${kind}`, schema);
    }
    return map;
  }, [mrds]);

  let compositeLink: string | JSX.Element = '-';
  if (compTypeRef) {
    compositeLink = matchingXrd
      ? <Link routeName={`crossplane-xr-kind-${matchingXrd.jsonData?.spec?.names?.plural}`}>{compTypeRef.kind}</Link>
      : compTypeRef.kind;
  }

  const extraInfo = comp
    ? [
        {
          name: 'Composite Resource',
          value: compositeLink,
        },
        {
          name: 'Mode',
          value: comp.jsonData?.spec?.mode ?? 'Resources',
        },
        {
          name: 'Composition Revision Policy',
          value: comp.jsonData?.spec?.publishConnectionDetailsWithStoreConfigRef?.name ?? '-',
        },
      ]
    : [];

  const pipeline: PipelineStep[] = comp?.jsonData?.spec?.pipeline ?? [];

  const pipelineInputYaml = useMemo(
    () => new Map(pipeline.filter(s => s.input).map(s => [s.step, yamlStringify(s.input!, { blockQuote: true })])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comp]
  );

  return (
    <>
      <MainInfoSection resource={comp} extraInfo={extraInfo} />
      {comp && <ConditionsTable resource={comp.jsonData} />}
      {pipeline.length > 0 && (
        <SectionBox title="Pipeline">
          {pipeline.map((s, i) => (
            <Accordion key={s.step} defaultExpanded={i === 0}>
              <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
                <Box display="flex" alignItems="center" width="100%" gap={1}>
                  <Typography variant="subtitle1">{s.step}</Typography>
                  {s.functionRef?.name && (
                    <Box ml="auto" mr={1}>
                      <Link routeName={`crossplane-function-detail-${s.functionRef.name}`}>
                        <Chip
                          label={s.functionRef.name}
                          size="small"
                          icon={<Icon icon="mdi:function" />}
                          clickable
                        />
                      </Link>
                    </Box>
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box display="flex" flexDirection="column" gap={1.5}>
                  {s.input && isKroStep(s) ? (
                    <KroStepGraph
                      input={s.input}
                      inputYaml={pipelineInputYaml.get(s.step)}
                      compositionName={comp?.metadata?.name ?? ''}
                      stepIndex={i}
                      xrdSchema={xrdSchema}
                      mrdSchemaMap={mrdSchemaMap}
                      xrdScope={xrdScope}
                    />
                  ) : pipelineInputYaml.has(s.step) ? (
                    <Box>
                      <Typography variant="overline" display="block" gutterBottom>Input</Typography>
                      <DataField
                        label="input.yaml"
                        disableLabel
                        value={pipelineInputYaml.get(s.step)!}
                        onChange={() => {}}
                      />
                    </Box>
                  ) : null}
                  {(s.requirements?.requiredResources?.length ?? 0) > 0 && (
                    <Box>
                      <Typography variant="overline" display="block" gutterBottom>Required Resources</Typography>
                      <Table
                        data={s.requirements!.requiredResources!}
                        columns={[
                          { header: 'Name', accessorKey: 'requirementName' },
                          { header: 'API Version', accessorKey: 'apiVersion' },
                          { header: 'Kind', accessorKey: 'kind' },
                          {
                            header: 'Selector',
                            accessorFn: (r: RequiredResource) =>
                              r.name ?? Object.entries(r.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`).join(', '),
                            Cell: ({ row }: { row: { original: RequiredResource } }) =>
                              row.original.name
                                ? <>{row.original.name}</>
                                : <MatchExpressions matchLabels={row.original.matchLabels} />,
                          },
                          {
                            header: 'Namespace',
                            accessorFn: (r: RequiredResource) => r.namespace ?? '-',
                          },
                        ]}
                      />
                    </Box>
                  )}
                  {(s.requirements?.requiredSchemas?.length ?? 0) > 0 && (
                    <Box>
                      <Typography variant="overline" display="block" gutterBottom>Required Schemas</Typography>
                      <Table
                        data={s.requirements!.requiredSchemas!}
                        columns={[
                          { header: 'Name', accessorKey: 'requirementName' },
                          { header: 'API Version', accessorKey: 'apiVersion' },
                          { header: 'Kind', accessorKey: 'kind' },
                        ]}
                      />
                    </Box>
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
        </SectionBox>
      )}
      {matchingXrd && comp && (
        <ComposedXRs xrd={matchingXrd} compositionName={comp.metadata.name} />
      )}
    </>
  );
}
