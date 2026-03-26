export interface AnalyzeFrameInput {
  file_key: string;
  node_id: string;
  access_token: string;
}

export interface ComponentInfo {
  id: string;
  name: string;
  type: string;
  isComponent: boolean;
  isInstance: boolean;
  componentKey?: string;
}

export interface LayoutInfo {
  mode: "none" | "horizontal" | "vertical";
  primaryAxisAlign: string;
  counterAxisAlign: string;
  padding: { top: number; right: number; bottom: number; left: number };
  gap: number;
  sizing: { width: string; height: string };
}

export interface ConstraintInfo {
  horizontal: string;
  vertical: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface AccessibilityWarning {
  nodeId: string;
  nodeName: string;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface AnalyzeFrameResult {
  frameId: string;
  frameName: string;
  dimensions: { width: number; height: number };
  components: ComponentInfo[];
  layouts: Record<string, LayoutInfo>;
  constraints: Record<string, ConstraintInfo>;
  accessibilityWarnings: AccessibilityWarning[];
  stats: {
    totalNodes: number;
    componentCount: number;
    instanceCount: number;
    textNodeCount: number;
    imageNodeCount: number;
  };
}

export interface ExtractDesignTokensInput {
  file_key: string;
  access_token: string;
  export_format?: "style-dictionary" | "css-variables" | "tailwind";
  include_styles?: boolean;
}

export interface ColorToken {
  name: string;
  value: string;
  hex: string;
  rgba: { r: number; g: number; b: number; a: number };
  opacity: number;
}

export interface TypographyToken {
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number | undefined;
  letterSpacing: number | undefined;
  italic: boolean;
}

export interface SpacingToken {
  name: string;
  value: number;
  unit: "px";
}

export interface ExtractDesignTokensResult {
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
  exported: string;
  format: "style-dictionary" | "css-variables" | "tailwind";
}

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
  type: "HorizontalLayoutGroup" | "VerticalLayoutGroup" | "GridLayoutGroup";
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
  layoutGroup?: UnityLayoutGroup;
  components: string[];
  children: UnityNode[];
}

export interface MapToUnityResult {
  rootNode: UnityNode;
  canvasSize: { width: number; height: number };
  notes: string[];
  warnings: string[];
}
