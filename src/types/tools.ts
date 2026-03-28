import type { CacheMetadata } from "../figma/client.js";

export type { CacheMetadata };

// ─── Shared response envelope ─────────────────────────────────────────────────

export interface ResponseEnvelope<T> {
  schema_version: "0.1.0";
  source: { file_key: string; node_id?: string };
  freshness: { fresh: boolean; timestamp: string; ttl_ms: number };
  warnings: string[];
  data: T;
}

// ─── inspect_layout ───────────────────────────────────────────────────────────

export interface InspectLayoutInput {
  file_key: string;
  node_id: string;
  access_token: string;
  max_depth?: number | undefined;
  framework?: string | undefined;
}

export interface TextRun {
  text: string;
  style: Partial<import("./figma.js").TypeStyle>;
  startIndex: number;
  endIndex: number;
}

export interface AnnotationInfo {
  nodeId: string;
  nodeName: string;
  label: string;
  properties: Array<{ type: string; value?: string }>;
}

export interface NodeSummary {
  id: string;
  name: string;
  type: string;
  depth: number;
  childCount: number;
  positioningMode: "auto-layout" | "absolute";
  textRuns?: TextRun[] | undefined;
  frameworkHints?: Record<string, string> | undefined;
}

export interface LayoutInfo {
  nodeId: string;
  nodeName: string;
  mode: "horizontal" | "vertical";
  primaryAxisAlign: string;
  counterAxisAlign: string;
  padding: { top: number; right: number; bottom: number; left: number };
  gap: number;
  sizing: { width: "hug" | "fixed" | "fill"; height: "hug" | "fixed" | "fill" };
}

export interface ConstraintInfo {
  nodeId: string;
  nodeName: string;
  horizontal: string;
  vertical: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface AccessibilityWarning {
  nodeId: string;
  nodeName: string;
  rule: "min-touch-target" | "min-font-size" | "missing-fill";
  severity: "error" | "warning" | "info";
  message: string;
  evidence: string;
}

export interface InspectLayoutData {
  frameId: string;
  frameName: string;
  dimensions: { width: number; height: number };
  hierarchy: NodeSummary[];
  autoLayouts: LayoutInfo[];
  constraints: ConstraintInfo[];
  annotations: AnnotationInfo[];
  accessibilityWarnings: AccessibilityWarning[];
  stats: {
    totalNodes: number;
    autoLayoutNodes: number;
    absoluteNodes: number;
    textNodeCount: number;
    truncatedAtDepth: boolean;
  };
  cache: CacheMetadata;
}

export type InspectLayoutResult = ResponseEnvelope<InspectLayoutData>;

// ─── extract_design_tokens ────────────────────────────────────────────────────

export interface ExtractDesignTokensInput {
  file_key: string;
  access_token: string;
  export_format?: "style-dictionary" | "css-variables" | "tailwind";
}

export interface ColorToken {
  name: string;
  figmaStyleName?: string | undefined;
  value: string;
  hex: string;
  rgba: { r: number; g: number; b: number; a: number };
  opacity: number;
  sourceNodeIds: string[];
}

export interface TypographyToken {
  name: string;
  figmaStyleName?: string | undefined;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | undefined;
  letterSpacing: number | undefined;
  italic: boolean;
  sourceNodeIds: string[];
}

export interface SpacingToken {
  name: string;
  value: number;
  unit: "px";
  sourceNodeIds: string[];
}

export interface ExtractDesignTokensData {
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
  exported: string;
  format: "style-dictionary" | "css-variables" | "tailwind";
  cache: CacheMetadata;
}

export type ExtractDesignTokensResult = ResponseEnvelope<ExtractDesignTokensData>;

// ─── map_to_unity ─────────────────────────────────────────────────────────────

export interface MapToUnityInput {
  file_key: string;
  node_id: string;
  access_token: string;
  canvas_width?: number;
  canvas_height?: number;
}

export interface UnityRectTransform {
  anchorMin: { x: number; y: number };
  anchorMax: { x: number; y: number };
  anchoredPosition: { x: number; y: number };
  sizeDelta: { x: number; y: number };
  pivot: { x: number; y: number };
}

export interface UnityLayoutGroup {
  type: "HorizontalLayoutGroup" | "VerticalLayoutGroup";
  spacing: number;
  padding: { top: number; right: number; bottom: number; left: number };
  childAlignment: string;
  controlWidth: boolean;
  controlHeight: boolean;
}

export interface UnityNode {
  name: string;
  figmaId: string;
  figmaType: string;
  rectTransform: UnityRectTransform;
  layoutGroup: UnityLayoutGroup | undefined;
  suggestedComponents: string[];
  confidence: "high" | "medium" | "low";
  children: UnityNode[];
}

export interface MapToUnityData {
  rootNode: UnityNode;
  canvasSize: { width: number; height: number };
  notes: string[];
  cache: CacheMetadata;
}

export type MapToUnityResult = ResponseEnvelope<MapToUnityData>;

// ─── resolve_components ──────────────────────────────────────────────────────

export interface ResolveComponentsInput {
  file_key: string;
  access_token: string;
  node_id?: string | undefined;
}

export interface ResolvedComponent {
  instanceNodeId: string;
  componentName: string;
  componentKey: string;
  sourceFileKey: string;
  sourceNodeId: string;
  description: string;
}

export interface ResolveComponentsData {
  components: ResolvedComponent[];
  cache: CacheMetadata;
}

export type ResolveComponentsResult = ResponseEnvelope<ResolveComponentsData>;

// ─── extract_flows ───────────────────────────────────────────────────────────

export interface ExtractFlowsInput {
  file_key: string;
  access_token: string;
  node_id: string;
}

export interface FlowConnection {
  fromNodeId: string;
  fromNodeName: string;
  toNodeId: string;
  toNodeName: string;
  trigger: string;
  transitionType: string;
}

export interface ExtractFlowsData {
  flows: FlowConnection[];
  flowOrder: string[];
  cache: CacheMetadata;
}

export type ExtractFlowsResult = ResponseEnvelope<ExtractFlowsData>;

// ─── bridge_to_codebase ──────────────────────────────────────────────────────

export interface BridgeToCodebaseInput {
  file_key: string;
  access_token: string;
  project_path: string;
  file_extensions?: string[] | undefined;
}

export interface CodebaseMapping {
  figmaComponentName: string;
  figmaComponentId: string;
  matchedFile: string | null;
  matchType: "exact" | "case-insensitive" | "partial" | "none";
  confidence: number;
}

export interface BridgeToCodebaseData {
  mappings: CodebaseMapping[];
  cache: CacheMetadata;
}

export type BridgeToCodebaseResult = ResponseEnvelope<BridgeToCodebaseData>;

// ─── diff_versions ───────────────────────────────────────────────────────────

export interface DiffVersionsInput {
  file_key: string;
  access_token: string;
  version_a: string;
  version_b: string;
}

export interface NodeChange {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  changes?: string[] | undefined;
}

export interface DiffVersionsData {
  added: NodeChange[];
  removed: NodeChange[];
  modified: NodeChange[];
  cache: { versionA: CacheMetadata; versionB: CacheMetadata };
}

export type DiffVersionsResult = ResponseEnvelope<DiffVersionsData>;

// ─── extract_variants ────────────────────────────────────────────────────────

export interface ExtractVariantsInput {
  file_key: string;
  access_token: string;
  node_id: string;
}

export interface VariantInfo {
  name: string;
  properties: Record<string, string>;
  dimensions: { width: number; height: number };
  layoutInfo: {
    layoutMode: string;
    itemSpacing: number;
    padding: { top: number; right: number; bottom: number; left: number };
  };
  styles: {
    fills: import("./figma.js").Paint[];
    typography?: Partial<import("./figma.js").TypeStyle> | undefined;
  };
}

export interface ExtractVariantsData {
  componentSetName: string;
  variants: VariantInfo[];
  cache: CacheMetadata;
}

export type ExtractVariantsResult = ResponseEnvelope<ExtractVariantsData>;

// ─── export_images ───────────────────────────────────────────────────────────

export interface ExportImagesInput {
  file_key: string;
  access_token: string;
  node_ids: string[];
  format?: "png" | "jpg" | "svg" | "pdf";
  scale?: number;
}

export interface ExportedImage {
  nodeId: string;
  nodeName: string;
  imageUrl: string | null;
  format: "png" | "jpg" | "svg" | "pdf";
  scale: number;
}

export type ExportImagesResult = ResponseEnvelope<{
  images: ExportedImage[];
  cache: CacheMetadata;
}>;

// ─── audit_accessibility ─────────────────────────────────────────────────────

export interface AuditAccessibilityInput {
  file_key: string;
  access_token: string;
  node_id: string;
}

export interface AccessibilityAuditIssue {
  nodeId: string;
  nodeName: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  details: string;
}

export type AuditAccessibilityResult = ResponseEnvelope<{
  issues: AccessibilityAuditIssue[];
  summary: { errors: number; warnings: number; info: number; score: number };
  cache: CacheMetadata;
}>;

// ─── simplify_context ────────────────────────────────────────────────────────

export interface SimplifyContextInput {
  file_key: string;
  access_token: string;
  node_id: string;
  max_tokens?: number | undefined;
  framework?: "web" | "react" | "unity" | "swiftui" | undefined;
}

export interface SimplifiedNode {
  id: string;
  name: string;
  type: string;
  text?: string | undefined;
  layout?: Record<string, number | string> | undefined;
  style?: Record<string, string | number> | undefined;
  size?: { width: number; height: number } | undefined;
  hints?: string[] | undefined;
  count?: number | undefined;
  children?: SimplifiedNode[] | undefined;
}

export interface SimplifyContextData {
  framework?: "web" | "react" | "unity" | "swiftui" | undefined;
  truncated: boolean;
  estimated_tokens: number;
  tree: SimplifiedNode | null;
  cache: CacheMetadata;
}

export type SimplifyContextResult = ResponseEnvelope<SimplifyContextData>;
