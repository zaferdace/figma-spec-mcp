import type { CacheMetadata } from "../figma/client.js";

export type { CacheMetadata };

// ─── Shared response envelope ─────────────────────────────────────────────────

export interface ResponseEnvelope<T> {
  schema_version: "0.1.0";
  source: { file_key: string; node_id?: string };
  freshness: { cached: boolean; timestamp: string; ttl_ms: number };
  warnings: string[];
  data: T;
}

// ─── inspect_layout ───────────────────────────────────────────────────────────

export interface InspectLayoutInput {
  file_key: string;
  node_id: string;
  access_token: string;
}

export interface NodeSummary {
  id: string;
  name: string;
  type: string;
  depth: number;
  childCount: number;
  positioningMode: "auto-layout" | "absolute";
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
  accessibilityWarnings: AccessibilityWarning[];
  stats: {
    totalNodes: number;
    autoLayoutNodes: number;
    absoluteNodes: number;
    textNodeCount: number;
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
  value: string;
  hex: string;
  rgba: { r: number; g: number; b: number; a: number };
  opacity: number;
  sourceNodeIds: string[];
}

export interface TypographyToken {
  name: string;
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
