import { Icon } from '@iconify/react';
import {
  CreateResourceButton,
  Link,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import type { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Fragment } from 'react';
import { ActivityNameLink } from '../../components/ActivityNameLink';
import { makeCompositeTypeColumn } from '../../components/columns';
import { CompositeResourceDefinition, Composition, CrossplaneFunction } from '../../resources';
import { CompositionDetailPage } from './CompositionDetailPage';

const MAX_VISIBLE_STEPS = 7;

interface PipelineStep {
  step: string;
  functionRef: { name: string };
}

function PipelineSteps({ item, knownFunctions }: { item: KubeObject; knownFunctions: Set<string> }) {
  const theme = useTheme();
  const steps: PipelineStep[] = item.jsonData?.spec?.pipeline ?? [];

  if (steps.length === 0) return <span>-</span>;

  const visible = steps.slice(0, MAX_VISIBLE_STEPS);
  const overflow = steps.slice(MAX_VISIBLE_STEPS);

  return (
    <Box display="flex" alignItems="center" flexWrap="nowrap">
      {visible.map((s, i) => {
        const fnName = s.functionRef?.name;
        const missing = !!fnName && knownFunctions.size > 0 && !knownFunctions.has(fnName);
        const dotColor = missing ? theme.palette.error.main : theme.palette.primary.main;
        const connectorColor = missing ? 'error.main' : 'primary.main';
        return (
          <Fragment key={s.step}>
            {i > 0 && (
              <Box sx={{ width: 14, height: 2, flexShrink: 0, bgcolor: connectorColor, opacity: 0.4 }} />
            )}
            <Tooltip
              title={
                <Box>
                  <div><strong>{s.step}</strong></div>
                  {fnName && (
                    <Link routeName={`crossplane-function-detail-${fnName}`}>
                      <Box display="flex" alignItems="center" gap={0.5} component="span">
                        <Icon icon="mdi:function" width="1em" height="1em" />
                        {fnName}
                      </Box>
                    </Link>
                  )}
                  {missing && (
                    <Box display="flex" alignItems="center" gap={0.5} mt={0.5} color="error.light">
                      <Icon icon="mdi:alert-circle-outline" width="1em" height="1em" />
                      Function not found
                    </Box>
                  )}
                </Box>
              }
            >
              <Box component="span" sx={{ cursor: 'default', lineHeight: 0, flexShrink: 0 }}>
                <Icon
                  icon="mdi:circle"
                  width="0.875rem"
                  height="0.875rem"
                  style={{ color: dotColor }}
                />
              </Box>
            </Tooltip>
          </Fragment>
        );
      })}
      {overflow.length > 0 && (
        <>
          <Box sx={{ width: 14, height: 2, flexShrink: 0, bgcolor: 'primary.main', opacity: 0.4 }} />
          <Tooltip title={overflow.map(s => s.step).join(', ')}>
            <Box
              component="span"
              sx={{
                cursor: 'default',
                fontSize: '0.75rem',
                color: 'primary.main',
                flexShrink: 0,
                lineHeight: 1,
              }}
            >
              +{overflow.length}
            </Box>
          </Tooltip>
        </>
      )}
    </Box>
  );
}

function CompositionNameLink({ item }: { item: KubeObject }) {
  return (
    <ActivityNameLink
      item={item}
      kindLabel="Composition"
      location="full"
      icon={<Icon icon="mdi:layers-outline" width="100%" height="100%" />}
      content={<CompositionDetailPage name={item.metadata.name} />}
    />
  );
}

export function CompositionListPage() {
  const filterFunction = useFilterFunc();
  const [compositions, error] = Composition.useList();
  const [xrds] = CompositeResourceDefinition.useList();
  const [functions] = CrossplaneFunction.useList();
  const knownFunctions = new Set((functions ?? []).map((f: { metadata: { name: string } }) => f.metadata.name));

  if (error?.status === 404) {
    return (
      <SectionBox title="Compositions">
        <p>Compositions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Compositions"
          titleSideActions={[<CreateResourceButton resourceClass={Composition} resourceName="Composition" />]}
        />
      }
    >
      <ResourceTable.default
        data={compositions}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: item => item.metadata.name,
            render: item => <CompositionNameLink item={item} />,
          },
          makeCompositeTypeColumn(xrds),
          {
            label: 'Pipeline',
            getValue: item =>
              (item.jsonData?.spec?.pipeline ?? []).map((s: PipelineStep) => s.step).join(', '),
            render: item => <PipelineSteps item={item} knownFunctions={knownFunctions} />,
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}
