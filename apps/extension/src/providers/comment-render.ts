export interface ProviderCommentRenderContext {
  readonly idNamespace: string;
  readonly state: Map<string, boolean>;
  current(): boolean;
  onMount(callback: () => void): void;
  onDispose(callback: () => void): void;
  onRefresh?(callback: () => void): void;
}
