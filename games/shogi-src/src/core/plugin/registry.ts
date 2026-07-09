export type PluginName = string;

const registry = new Map<PluginName, unknown>();

export function register<T>(name: PluginName, plugin: T): void {
  registry.set(name, plugin);
}

export function get<T>(name: PluginName): T | undefined {
  return registry.get(name) as T | undefined;
}

export function has(name: PluginName): boolean {
  return registry.has(name);
}

export function clear(): void {
  registry.clear();
}
