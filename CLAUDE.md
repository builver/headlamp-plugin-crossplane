# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start          # watch mode — hot reload in Headlamp desktop app
npm run build          # production build into dist/
npm run test           # vitest tests
npm run lint           # ESLint
npm run lint-fix       # ESLint with auto-fix
npm run tsc            # TypeScript type-check only
npm run format         # Prettier
npm run package        # creates .tar.gz for distribution
npm run storybook      # Storybook for component development
npm run i18n           # extract translatable strings
```

All scripts delegate to the `headlamp-plugin` CLI (the only dev dependency: `@kinvolk/headlamp-plugin`).

Hot reload during development requires the **Headlamp desktop app** running. The plugin directory it watches is `~/.config/Headlamp/plugins/` (macOS/Linux).

## Architecture

This is a Headlamp plugin that surfaces Crossplane resources in the Kubernetes UI. Headlamp plugins are webpack bundles — all registration happens at module load time in `src/index.tsx`, not inside React components.

### Key constraints

- **Shared dependencies** — React, MUI, Redux, etc. are provided by Headlamp at runtime. Do NOT add them to `package.json`. Only `@kinvolk/headlamp-plugin` is a dev dependency.
- **Entry point** — `src/index.tsx` calls registration functions at the top level. The `dist/` output must contain exactly `main.js` and `package.json`.
- **No Crossplane plugin exists yet in the official ecosystem** — use the [Flux plugin](https://github.com/headlamp-k8s/plugins/tree/main/flux) as the canonical reference (same pattern: suite of CRDs, condition-based status).

### Plugin registration API

Import from `@kinvolk/headlamp-plugin/lib`:

```typescript
registerSidebarEntry(config)          // left-nav menu item
registerRoute(config)                 // React component at a URL path
registerDetailsViewSection(fn)        // inject section into any resource detail page
registerResourceTableColumnsProcessor(fn)  // add/modify list table columns
registerAppBarAction(component)       // top-right app bar
registerPluginSettings(name, component, isConfigured)  // user settings panel
```

### Custom resource classes

All Crossplane resources extend `KubeObject` with 4 static fields:

```typescript
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/lib/k8s/cluster';

export class CompositeResourceDefinition extends KubeObject {
  static kind = 'CompositeResourceDefinition';
  static apiName = 'compositeresourcedefinitions';  // plural
  static apiVersion = 'apiextensions.crossplane.io/v1';
  static isNamespaced = false;  // cluster-scoped
}
```

Inherited hooks: `.useList()`, `.useGet(name, namespace?)` — React hooks returning `[items, error]`.

### Dynamic resource classes (XRs, Claims, MRs)

XRs, Claims, and Managed Resources are not fixed-kind — each XRD/MRD generates its own CRD. Use the factory helpers in `src/resources/index.ts`:

```typescript
makeXRClass(xrd)      // dynamic class for Composite Resources defined by an XRD
makeClaimClass(xrd)   // dynamic class for Claims (returns null if XRD has no claimNames)
makeMRClass(mrd)      // dynamic class for Managed Resources defined by an MRD
```

All three return a class compatible with `.useList()` / `.useGet()`. Always wrap in `useMemo(() => makeXRClass(xrd), [xrd.metadata.uid])` to avoid recreating on every render.

### Source structure

```
src/
├── index.tsx                    # registration only (sidebar, routes)
├── resources/
│   ├── index.ts                 # KubeObject subclasses + shared helpers
│   └── types.ts                 # shared TypeScript interfaces
├── pages/                       # full-page React components per route
│   ├── OverviewPage.tsx
│   ├── CompositeResourcesPage.tsx / XRKindPage.tsx / XRDetailPage.tsx / XRDDetailPage.tsx
│   ├── ClaimsPage.tsx
│   ├── CompositionListPage.tsx
│   ├── ProviderListPage.tsx / FunctionListPage.tsx / ConfigurationListPage.tsx
│   ├── MRDDetailPage.tsx / MRInstancePage.tsx
│   └── ...
└── components/
    ├── columns.tsx              # shared ResourceTable column definitions (readyColumn, syncedColumn, packageResourceColumns, makeXRNameColumn)
    ├── ConditionStatus.tsx      # ReadyStatus, SyncedStatus, InstalledStatus, HealthyStatus chips
    ├── XRTypeSection.tsx        # renders one XR type table (one useList() call per instance)
    ├── ComposedResources.tsx    # fetches + displays composed managed resources for an XR
    └── PauseAction.tsx          # pause/resume action for XRs
```

### Shared helpers (`src/resources/index.ts`)

```typescript
// XR scope — v1 XRDs have no spec.scope → treated as LegacyCluster
getXRScope(xrd): XRScope         // 'Namespaced' | 'Cluster' | 'LegacyCluster'

// Composition reference — location differs between v1 and v2 XRs
getCompositionRef(item, scope)   // spec.compositionRef.name (LegacyCluster) or spec.crossplane.compositionRef.name

// Condition accessors — return the full condition object (use ?.status ?? '-')
getReadyCondition(item)
getSyncedCondition(item)
getInstalledCondition(item)      // pkg resources (Provider, Function, Configuration)
getHealthyCondition(item)        // pkg resources
```

### Crossplane resource groups

- `apiextensions.crossplane.io/v1` (+ v2) — XRDs, Compositions
- `pkg.crossplane.io/v1` — Providers, Functions, Configurations
- `apiextensions.crossplane.io/v1alpha1` — ManagedResourceDefinitions, EnvironmentConfigs
- Claims/XRs — dynamic, defined by each XRD's `spec.group`

### Crossplane XR resource ref locations

- `LegacyCluster` scope (v1): `spec.compositionRef.name`, `spec.resourceRefs[]`
- `Namespaced`/`Cluster` scope (v2): `spec.crossplane.compositionRef.name`, `spec.crossplane.resourceRefs[]`
- For `Namespaced` XRs, `ref.namespace` is often unset — resolve with `ref.namespace ?? xr.metadata.namespace`
- XRD and MRD share the same spec shape (`spec.group`, `spec.versions`, `spec.names.plural`) — components that patch/fetch either can be shared

### UI component patterns

**`ResourceTable` — namespace export, must use `.default`:**
```typescript
import { ResourceTable } from '@kinvolk/headlamp-plugin/lib/components/common';
// Use as:
<ResourceTable.default data={items} filterFunction={filterFunction} enableRowActions columns={columns} />
```
Column format: `{ label, getValue, render? }` — NOT the MRT format (`header`, `accessorFn`, `Cell`).
Built-in column shorthands: `'name'`, `'namespace'`, `'age'`, `'cluster'` as string literals.

**`Table` — raw MRT table for structured data (not Kubernetes resources):**
```typescript
import { Table } from '@kinvolk/headlamp-plugin/lib/components/common';
// Column format: { header, accessorKey?, accessorFn?, Cell? }
```

**`DataField` — Monaco editor (YAML/JSON), language inferred from label extension:**
```typescript
import { DataField } from '@kinvolk/headlamp-plugin/lib/components/common';
<DataField label="config.yaml" disableLabel value={yamlString} onChange={() => {}} />
// .yaml → YAML syntax, .json → JSON syntax. Omit onSave for read-only.
```

**`MatchExpressions` — non-standard import path:**
```typescript
import { MatchExpressions } from '@kinvolk/headlamp-plugin/lib/components/common/Resource';
// Props: matchLabels?, matchExpressions?
```

**YAML serialization — use `yaml` package (not `js-yaml`) for block scalar output:**
```typescript
import { stringify as yamlStringify } from 'yaml';
yamlStringify(obj, { blockQuote: true })  // multiline strings → | block literal style
```

### Local references

Bundled inside `node_modules/@kinvolk/headlamp-plugin/`:
- `examples/` — sidebar, tables, details-view, resource-charts, pod-counter, custom-theme, ui-panels
- `official-plugins/` — cert-manager, flux, keda, karpenter, prometheus, opencost, ai-assistant, app-catalog

Most relevant for this plugin:
- `official-plugins/cert-manager/src/resources/` — canonical CRD class + list/detail page pattern
- `official-plugins/flux/src/` — multi-CRD plugin with condition-based status (closest analog)
- `official-plugins/keda/src/mapView.tsx` — graph view of resource relationships using `makeKubeToKubeEdge` (useful for Crossplane topology: Composition → XR → Claim → ManagedResource)
