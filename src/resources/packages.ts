import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

// ── pkg.crossplane.io/v1 ────────────────────────────────────────────────────

export class Provider extends KubeObject {
  static kind = 'Provider';
  static apiName = 'providers';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;

  static getBaseObject() {
    return { ...super.getBaseObject(), spec: { package: '' } };
  }
}

export class ProviderRevision extends KubeObject {
  static kind = 'ProviderRevision';
  static apiName = 'providerrevisions';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}

export class Configuration extends KubeObject {
  static kind = 'Configuration';
  static apiName = 'configurations';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;

  static getBaseObject() {
    return { ...super.getBaseObject(), spec: { package: '' } };
  }
}

export class ConfigurationRevision extends KubeObject {
  static kind = 'ConfigurationRevision';
  static apiName = 'configurationrevisions';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}

export class CrossplaneFunction extends KubeObject {
  static kind = 'Function';
  static apiName = 'functions';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;

  static getBaseObject() {
    return { ...super.getBaseObject(), spec: { package: '' } };
  }
}

export class FunctionRevision extends KubeObject {
  static kind = 'FunctionRevision';
  static apiName = 'functionrevisions';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}
