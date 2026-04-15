import { CreateResourceButton, Link, SectionBox, SectionFilterHeader } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Box, Typography } from '@mui/material';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { CompositeResourceDefinition, getXRScope, makeXRClass } from '../../resources';
import { XRTypeSection } from './XRTypeSection';

export function XRListPage() {
  const location = useLocation();
  const plural = location.pathname.split('/').filter(Boolean).pop() ?? '';
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

  const xrd = xrds.find(x => x.jsonData?.spec?.names?.plural === plural) ?? null;

  if (!xrd) {
    return (
      <SectionBox title="Composite Resources">
        <p>No XRD found for resource type "{plural}".</p>
      </SectionBox>
    );
  }

  const kind = xrd.jsonData?.spec?.names?.kind ?? plural;
  const scope = getXRScope(xrd);
  const DynClass = useMemo(() => makeXRClass(xrd), [xrd.metadata.uid]);

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title={kind}
          titleSideActions={[<CreateResourceButton resourceClass={DynClass} resourceName={kind} />]}
        />
      }
    >
      <Box px={2} pb={1}>
        <Typography variant="subtitle2" color="textSecondary">
          XRD:{' '}
          <Link routeName="crossplane-xrd-detail" params={{ name: xrd.metadata.name }}>
            {xrd.metadata.name}
          </Link>
        </Typography>
      </Box>
      <XRTypeSection xrd={xrd} scope={scope} />
    </SectionBox>
  );
}
