[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/headlamp-plugin-crossplane)](https://artifacthub.io/packages/search?repo=headlamp-plugin-crossplane)

# headlamp-plugin-crossplane

A [Headlamp](https://headlamp.dev) plugin that surfaces
[Crossplane](https://crossplane.io) resources in the Kubernetes UI. Browse
Providers, Functions, Configurations, Composite Resources, Claims, Compositions,
and Managed Resources - all without leaving Headlamp.

## Features

- **Overview dashboard** - health tiles for Providers, Functions,
  Configurations, and every XR kind, plus live Crossplane pod status grouped by
  system/provider/function
- **Composite Resources & Claims** - list and detail views for all
  dynamically-defined XR kinds (Crossplane v1 and v2) and their claims, with
  Ready/Synced status chips and composition linkage; per-kind sidebar entries
  registered dynamically at runtime
- **Compositions** - list and detail pages for all Compositions; the detail
  page includes a visual kro pipeline graph editor for kro-based steps
  (graph/YAML toggle with CEL expression editing and schema-aware port wiring)
- **Managed Resources** - browse ManagedResourceDefinitions with per-kind
  resource list and detail pages; Managed Resource Activation Policy (MRAP)
  list and create dialog
- **Package management** - list and detail pages for Providers, Functions, and
  Configurations including revision history and installed object tables
- **Map integration** - registers a Crossplane map source in Headlamp's map
  view; expands XR resource graphs via BFS, resolving dynamic plural names and
  linking Claims, XRs, Managed Resources, and package resources
- **Resource glances** - Ready/Synced status chips surfaced on any Crossplane
  resource card across the Headlamp UI

## Screenshots

### Overview dashboard

![Overview dashboard](docs/images/overview.png)

### Composite Resources list

![Composite Resources list](docs/images/composite-resources.png)

### Composition map view

![Composition map view](docs/images/map.png)

### Composition detail page

![Composition detail page](docs/images/composition.png)

### Composition graph editor

![Composition graph editor](docs/images/composition-graph.png)

## Installation

### Headlamp plugin catalog

The easiest way — search for **headlamp-plugin-crossplane** in the Headlamp
plugin catalog and install from there.

### Desktop / manual install

1. Download the latest `.tar.gz` from the [Releases](../../releases) page.
2. Extract into your Headlamp plugins directory (`~/.config/Headlamp/plugins/`
   on macOS/Linux).
3. Restart Headlamp.

### Kubernetes (Headlamp plugin manager)

Headlamp's built-in plugin manager (available since Headlamp 0.31.0) can
install and keep plugins up to date automatically. Enable it in the
[Headlamp Helm chart](https://artifacthub.io/packages/helm/headlamp/headlamp)
by adding the following to your values:

```yaml
config:
  watchPlugins: true

pluginsManager:
  enabled: true
  configContent: |
    plugins:
      - name: crossplane
        source: https://artifacthub.io/packages/headlamp/headlamp-plugin-crossplane/crossplane
        version: 0.1.0-rc4
    installOptions:
      parallel: true
```

Replace `version` with the release you want to pin, or omit it to always
install the latest. The plugin manager runs as a sidecar and handles
downloading and reloading without manual intervention.

### Kubernetes (init container)

For Headlamp running in a cluster, use the published container image as an init
container. It copies the plugin files into a shared volume before Headlamp
starts.

Add the following to your Headlamp `Deployment` (or Helm values):

```yaml
volumes:
  - name: headlamp-plugins
    emptyDir: {}

initContainers:
  - name: crossplane-plugin
    image: ghcr.io/builver/headlamp-plugin-crossplane:latest
    volumeMounts:
      - name: headlamp-plugins
        mountPath: /target

containers:
  - name: headlamp
    # ... existing headlamp container config ...
    volumeMounts:
      - name: headlamp-plugins
        mountPath: /headlamp/plugins
```

If you use the [Headlamp Helm chart](https://headlamp.dev/docs/latest/installation/in-cluster/),
the equivalent values are:

```yaml
initContainers:
  - name: crossplane-plugin
    image: ghcr.io/builver/headlamp-plugin-crossplane:latest
    volumeMounts:
      - name: headlamp-plugins
        mountPath: /target

volumeMounts:
  - name: headlamp-plugins
    mountPath: /headlamp/plugins

volumes:
  - name: headlamp-plugins
    emptyDir: {}
```

Images are published to
[ghcr.io/builver/headlamp-plugin-crossplane](https://github.com/builver/headlamp-plugin-crossplane/pkgs/container/headlamp-plugin-crossplane)
and tagged by semver (e.g. `1.0.0`, `1.0`) as well as `latest`.

## Development

```bash
npm install
npm run start    # watch mode - hot reload via Headlamp desktop app
npm run build    # production build into dist/
npm run test     # run vitest tests
npm run lint     # ESLint
```

Hot reload requires the Headlamp desktop app to be running. The plugin directory
it watches is `~/.config/Headlamp/plugins/` (macOS/Linux).

## Resources

- [Headlamp Plugin Docs](https://headlamp.dev/docs/latest/development/plugins/)
- [Crossplane Docs](https://docs.crossplane.io)
- [Headlamp Plugin API Reference](https://headlamp.dev/docs/latest/development/api/)
