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

// ─── lint_handoff_readiness ──────────────────────────────────────────────────

export interface LintHandoffReadinessInput {
  file_key: string;
  node_id?: string | undefined;
  access_token: string;
  ruleset?: "web" | "mobile" | "game-ui" | undefined;
}

export interface HandoffLintFinding {
  rule: string;
  severity: "error" | "warning" | "info";
  nodeId: string;
  nodeName: string;
  message: string;
  fixHint: string;
}

export interface LintHandoffReadinessData {
  findings: HandoffLintFinding[];
  score: number;
  summary: { errors: number; warnings: number; info: number };
  cache: CacheMetadata;
}

export type LintHandoffReadinessResult = ResponseEnvelope<LintHandoffReadinessData>;

// ─── generate_implementation_contract ───────────────────────────────────────

export interface GenerateImplementationContractInput {
  file_key: string;
  node_id: string;
  access_token: string;
  target?: "frontend" | "mobile" | "game-ui" | undefined;
}

export interface ImplementationScope {
  totalNodes: number;
  maxDepth: number;
  uniqueNodeTypes: string[];
  nodeTypeCounts: Array<{ type: string; count: number }>;
}

export interface ImplementationAsset {
  nodeId: string;
  nodeName: string;
  assetType: "VECTOR" | "BOOLEAN_OPERATION" | "IMAGE";
  exportHint: string;
}

export interface DetectedState {
  state: string;
  nodeIds: string[];
  nodeNames: string[];
}

export interface ImplementationInteraction {
  fromNodeId: string;
  fromNodeName: string;
  toNodeId: string;
  toNodeName: string;
  trigger: string;
  transitionType: string;
}

export interface ImplementationDependency {
  componentId: string;
  componentName: string;
  instanceCount: number;
  instanceNodeIds: string[];
}

export interface TypographyUsage {
  fontFamily: string;
  fontSize: number;
  usageCount: number;
}

export interface ColorUsage {
  hex: string;
  usageCount: number;
}

export interface GenerateImplementationContractData {
  scope: ImplementationScope;
  assets: ImplementationAsset[];
  states: DetectedState[];
  interactions: ImplementationInteraction[];
  dependencies: ImplementationDependency[];
  typography: TypographyUsage[];
  colors: ColorUsage[];
  acceptanceCriteria: string[];
  edgeCases: string[];
  cache: CacheMetadata;
}

export type GenerateImplementationContractResult = ResponseEnvelope<GenerateImplementationContractData>;

// ─── extract_missing_states ──────────────────────────────────────────────────

export interface ExtractMissingStatesInput {
  file_key: string;
  node_id: string;
  access_token: string;
}

export interface MissingStateComponent {
  name: string;
  nodeId: string;
  presentStates: string[];
  missingStates: string[];
  confidence: number;
}

export interface ExtractMissingStatesData {
  components: MissingStateComponent[];
  cache: CacheMetadata;
}

export type ExtractMissingStatesResult = ResponseEnvelope<ExtractMissingStatesData>;

// ─── flow_to_test_cases ──────────────────────────────────────────────────────

export interface FlowToTestCasesInput {
  file_key: string;
  node_id: string;
  access_token: string;
}

export interface FlowTestCase {
  title: string;
  preconditions: string;
  steps: string[];
  expected: string;
}

export interface FlowCoverage {
  totalFrames: number;
  connectedFrames: number;
  deadEnds: number;
  orphans: number;
}

export interface FlowToTestCasesData {
  testCases: FlowTestCase[];
  edgeCaseGaps: string[];
  flowCoverage: FlowCoverage;
  cache: CacheMetadata;
}

export type FlowToTestCasesResult = ResponseEnvelope<FlowToTestCasesData>;

// ─── map_to_react ────────────────────────────────────────────────────────────

export interface MapToReactInput {
  access_token: string;
  file_key: string;
  node_id: string;
  style_format: "tailwind" | "css_modules" | "styled_components" | "inline";
  component_library: "shadcn" | "mui" | "chakra" | "radix" | "plain";
  include_assets: boolean;
  include_prop_types: boolean;
  max_depth: number;
}

export interface ReactNode {
  element: string;
  componentSuggestion?: ComponentSuggestion;
  className?: string;
  style?: Record<string, string | number>;
  cssRule?: { selector: string; properties: Record<string, string> };
  text?: string;
  children: ReactNode[];
  figmaNodeName: string;
  figmaId: string;
  notes: string[];
}

export interface ComponentSuggestion {
  library: string;
  component: string;
  props?: Record<string, string>;
  import?: string;
}

export interface AssetHint {
  figmaId: string;
  suggestedName: string;
  suggestedFormat: "svg" | "png";
  dimensions: { width: number; height: number };
}

export interface PropTypeDefinition {
  componentName: string;
  props: Array<{
    name: string;
    type: string;
    required: boolean;
    defaultValue?: string;
  }>;
  typescript: string;
}

export interface MapToReactData {
  rootNode: ReactNode;
  style_format: string;
  component_library: string;
  assets: AssetHint[];
  propTypes: PropTypeDefinition[];
  notes: string[];
  cache: CacheMetadata;
}

export type MapToReactResult = ResponseEnvelope<MapToReactData>;

// ─── map_to_react_native ─────────────────────────────────────────────────────

export interface MapToReactNativeInput {
  access_token: string;
  file_key: string;
  node_id: string;
  component_library: "react_native_paper" | "native_base" | "plain";
  include_assets: boolean;
  include_prop_types: boolean;
  max_depth: number;
}

export interface ReactNativeNode {
  element: string;
  componentSuggestion?: ComponentSuggestion;
  style: Record<string, string | number | { width: number; height: number }>;
  text?: string;
  children: ReactNativeNode[];
  figmaNodeName: string;
  figmaId: string;
  notes: string[];
}

export interface MapToReactNativeData {
  rootNode: ReactNativeNode;
  component_library: string;
  assets: AssetHint[];
  propTypes: PropTypeDefinition[];
  notes: string[];
  cache: CacheMetadata;
}

export type MapToReactNativeResult = ResponseEnvelope<MapToReactNativeData>;

// ─── map_to_flutter ──────────────────────────────────────────────────────────

export interface MapToFlutterInput {
  access_token: string;
  file_key: string;
  node_id: string;
  component_library: "material" | "cupertino" | "plain";
  include_assets: boolean;
  include_theme_data: boolean;
  max_depth: number;
}

export interface FlutterNode {
  widget: string;
  componentSuggestion?: ComponentSuggestion;
  properties: Record<string, string>;
  text?: string;
  children: FlutterNode[];
  figmaNodeName: string;
  figmaId: string;
  notes: string[];
}

export interface FlutterThemeData {
  colors: string[];
  fontFamilies: string[];
  fontSizes: number[];
  themeData: string;
}

export interface MapToFlutterData {
  rootNode: FlutterNode;
  component_library: string;
  assets: AssetHint[];
  theme?: FlutterThemeData;
  notes: string[];
  cache: CacheMetadata;
}

export type MapToFlutterResult = ResponseEnvelope<MapToFlutterData>;

// ─── map_to_swiftui ──────────────────────────────────────────────────────────

export interface MapToSwiftUIInput {
  access_token: string;
  file_key: string;
  node_id: string;
  include_assets: boolean;
  include_color_assets: boolean;
  max_depth: number;
}

export interface SwiftUINode {
  view: string;
  modifiers: string[];
  text?: string;
  children: SwiftUINode[];
  figmaNodeName: string;
  figmaId: string;
  notes: string[];
}

export interface SwiftUIColorAsset {
  name: string;
  hex: string;
  swift: string;
}

export interface MapToSwiftUIData {
  rootNode: SwiftUINode;
  assets: AssetHint[];
  colorAssets: SwiftUIColorAsset[];
  notes: string[];
  cache: CacheMetadata;
}

export type MapToSwiftUIResult = ResponseEnvelope<MapToSwiftUIData>;
