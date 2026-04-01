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

### Dynamic Claims

Crossplane Claims are not fixed-kind resources — each XRD generates its own CRD. The pattern to handle this: query `CustomResourceDefinition` objects, filter by Crossplane-owned groups, then instantiate resource classes at runtime.

### Local references

Bundled inside `node_modules/@kinvolk/headlamp-plugin/`:
- `examples/` — sidebar, tables, details-view, resource-charts, pod-counter, custom-theme, ui-panels
- `official-plugins/` — cert-manager, flux, keda, karpenter, prometheus, opencost, ai-assistant, app-catalog

Most relevant for this plugin:
- `official-plugins/cert-manager/src/resources/` — canonical CRD class + list/detail page pattern
- `official-plugins/flux/src/` — multi-CRD plugin with condition-based status (closest analog)
- `official-plugins/keda/src/mapView.tsx` — graph view of resource relationships using `makeKubeToKubeEdge` (useful for Crossplane topology: Composition → XR → Claim → ManagedResource)

### Planned structure

```
src/
├── index.tsx           # registration only (sidebar, routes)
├── resources/          # KubeObject subclasses per Crossplane resource type
├── pages/              # full-page React components per route
└── components/         # shared UI (e.g. ConditionChip for status.conditions[])
```

### Crossplane resource groups

- `apiextensions.crossplane.io/v1` — XRDs, Compositions
- `pkg.crossplane.io/v1` — Providers, Functions, Configurations
- `pkg.crossplane.io/v1beta1` — ProviderConfig, etc.
- Claims/XRs — dynamic, defined by each XRD's `spec.group`
