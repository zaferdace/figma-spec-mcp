export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  componentId?: string;
  description?: string;
  children?: FigmaNode[];
  styles?: Record<string, string>;
  absoluteBoundingBox?: BoundingBox;
  constraints?: Constraints;
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  primaryAxisSizingMode?: "FIXED" | "AUTO";
  counterAxisSizingMode?: "FIXED" | "AUTO";
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  fills?: Paint[];
  strokes?: Paint[];
  effects?: Effect[];
  opacity?: number;
  cornerRadius?: number;
  style?: TypeStyle;
  characters?: string;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, TypeStyle>;
  transitionNodeID?: string;
  transitionDuration?: number;
  transitionEasing?: object;
  reactions?: Array<{ action?: { type?: string } }>;
  annotations?: Array<{
    label: string;
    properties: Array<{ type: string; value?: string }>;
  }>;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Constraints {
  horizontal: "LEFT" | "RIGHT" | "CENTER" | "LEFT_RIGHT" | "SCALE";
  vertical: "TOP" | "BOTTOM" | "CENTER" | "TOP_BOTTOM" | "SCALE";
}

export interface Paint {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "GRADIENT_ANGULAR" | "GRADIENT_DIAMOND" | "IMAGE" | "EMOJI";
  opacity?: number;
  color?: Color;
  gradientStops?: ColorStop[];
  blendMode?: string;
  visible?: boolean;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ColorStop {
  position: number;
  color: Color;
}

export interface Effect {
  type: "INNER_SHADOW" | "DROP_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR";
  radius: number;
  visible?: boolean;
  color?: Color;
  offset?: { x: number; y: number };
  spread?: number;
}

export interface TypeStyle {
  fontFamily: string;
  fontPostScriptName?: string;
  fontSize: number;
  fontWeight: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  letterSpacing?: number;
  textAlignHorizontal?: "LEFT" | "RIGHT" | "CENTER" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  italic?: boolean;
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";
}

export interface FigmaFileResponse {
  document: FigmaNode;
  components: Record<string, ComponentMetadata>;
  styles: Record<string, StyleMetadata>;
  name: string;
  lastModified: string;
  version: string;
}

export interface ComponentMetadata {
  key: string;
  name: string;
  description: string;
  documentationLinks?: { uri: string }[];
}

export interface FigmaComponentResponse extends ComponentMetadata {
  file_key: string;
  node_id: string;
}

export interface StyleMetadata {
  key: string;
  name: string;
  description: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
}
