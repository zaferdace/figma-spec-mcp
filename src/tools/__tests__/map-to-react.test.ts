import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildNormalizedUIAST, inferSemantic, rgbaToHex, mapAlignment } from "../../../dist/tools/normalized-ui-ast.js";

// ---------------------------------------------------------------------------
// Minimal FigmaNode factory
// ---------------------------------------------------------------------------

function makeNode(overrides: Record<string, unknown> = {}): Parameters<typeof buildNormalizedUIAST>[0] {
  return {
    id: "1:1",
    name: "node",
    type: "FRAME",
    fills: [],
    strokes: [],
    effects: [],
    children: [],
    ...overrides,
  } as Parameters<typeof buildNormalizedUIAST>[0];
}

// ---------------------------------------------------------------------------
// rgbaToHex
// ---------------------------------------------------------------------------

describe("rgbaToHex", () => {
  it("converts opaque red to #FF0000FF", () => {
    assert.equal(rgbaToHex({ r: 1, g: 0, b: 0 }), "#FF0000FF");
  });

  it("converts black with 50% alpha to #00000080", () => {
    assert.equal(rgbaToHex({ r: 0, g: 0, b: 0, a: 0.5 }), "#00000080");
  });

  it("converts opaque white to #FFFFFFFF", () => {
    assert.equal(rgbaToHex({ r: 1, g: 1, b: 1, a: 1 }), "#FFFFFFFF");
  });

  it("handles missing alpha channel as fully opaque", () => {
    const hex = rgbaToHex({ r: 0, g: 1, b: 0 });
    assert.equal(hex, "#00FF00FF");
  });

  it("applies opacity multiplier when provided", () => {
    // r=1,g=0,b=0,a=1 with opacity=0 → alpha channel = 0
    assert.equal(rgbaToHex({ r: 1, g: 0, b: 0, a: 1 }, 0), "#FF000000");
  });
});

// ---------------------------------------------------------------------------
// inferSemantic
// ---------------------------------------------------------------------------

describe("inferSemantic", () => {
  it("returns 'text' for TEXT nodes", () => {
    assert.equal(inferSemantic(makeNode({ type: "TEXT" })), "text");
  });

  it("returns 'icon' for small VECTOR nodes (< 48×48)", () => {
    assert.equal(
      inferSemantic(makeNode({ type: "VECTOR", absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 } })),
      "icon"
    );
  });

  it("returns 'image' for large VECTOR nodes (>= 48 in either dimension)", () => {
    assert.equal(
      inferSemantic(makeNode({ type: "VECTOR", absoluteBoundingBox: { x: 0, y: 0, width: 64, height: 64 } })),
      "image"
    );
  });

  it("returns 'divider' for thin RECTANGLE (height < 4)", () => {
    assert.equal(
      inferSemantic(
        makeNode({
          type: "RECTANGLE",
          fills: [],
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 1 },
        })
      ),
      "divider"
    );
  });

  it("returns 'divider' for thin RECTANGLE (width < 4)", () => {
    assert.equal(
      inferSemantic(
        makeNode({
          type: "RECTANGLE",
          fills: [],
          absoluteBoundingBox: { x: 0, y: 0, width: 2, height: 200 },
        })
      ),
      "divider"
    );
  });

  it("returns 'button' for FRAME named 'button'", () => {
    assert.equal(inferSemantic(makeNode({ type: "FRAME", name: "button" })), "button");
  });

  it("returns 'button' for FRAME named 'Primary Button'", () => {
    assert.equal(inferSemantic(makeNode({ type: "FRAME", name: "Primary Button" })), "button");
  });

  it("returns 'input' for FRAME named 'input field'", () => {
    assert.equal(inferSemantic(makeNode({ type: "FRAME", name: "input field" })), "input");
  });

  it("returns 'input' for FRAME named 'Search Field'", () => {
    assert.equal(inferSemantic(makeNode({ type: "FRAME", name: "Search Field" })), "input");
  });

  it("returns 'container' for generic FRAME", () => {
    assert.equal(inferSemantic(makeNode({ type: "FRAME", name: "Card" })), "container");
  });

  it("returns 'unknown' for unsupported node type", () => {
    assert.equal(inferSemantic(makeNode({ type: "GROUP" })), "unknown");
  });

  it("returns 'image' for RECTANGLE with IMAGE fill", () => {
    assert.equal(
      inferSemantic(
        makeNode({
          type: "RECTANGLE",
          fills: [{ type: "IMAGE", visible: true }],
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      ),
      "image"
    );
  });
});

// ---------------------------------------------------------------------------
// mapAlignment
// ---------------------------------------------------------------------------

describe("mapAlignment", () => {
  it("maps MIN → start", () => {
    assert.equal(mapAlignment("MIN"), "start");
  });

  it("maps CENTER → center", () => {
    assert.equal(mapAlignment("CENTER"), "center");
  });

  it("maps MAX → end", () => {
    assert.equal(mapAlignment("MAX"), "end");
  });

  it("maps SPACE_BETWEEN → space-between", () => {
    assert.equal(mapAlignment("SPACE_BETWEEN"), "space-between");
  });

  it("maps STRETCH → stretch", () => {
    assert.equal(mapAlignment("STRETCH"), "stretch");
  });

  it("defaults to start for unknown value", () => {
    assert.equal(mapAlignment("WHATEVER"), "start");
  });

  it("defaults to start for undefined", () => {
    assert.equal(mapAlignment(undefined), "start");
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — basic structure
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — basic structure", () => {
  it("returns a node with correct name and figmaId", () => {
    const node = makeNode({ id: "42:7", name: "MyFrame" });
    const result = buildNormalizedUIAST(node);
    assert.equal(result.name, "MyFrame");
    assert.equal(result.figmaId, "42:7");
    assert.equal(result.figmaType, "FRAME");
  });

  it("defaults opacity to 1 when not set", () => {
    const result = buildNormalizedUIAST(makeNode());
    assert.equal(result.opacity, 1);
  });

  it("respects explicit opacity", () => {
    const result = buildNormalizedUIAST(makeNode({ opacity: 0.5 }));
    assert.equal(result.opacity, 0.5);
  });

  it("defaults cornerRadius to 0 when not specified", () => {
    const result = buildNormalizedUIAST(makeNode());
    assert.equal(result.cornerRadius, 0);
  });

  it("maps numeric cornerRadius correctly", () => {
    const result = buildNormalizedUIAST(makeNode({ cornerRadius: 8 }));
    assert.equal(result.cornerRadius, 8);
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — layout
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — layout", () => {
  it("maps HORIZONTAL layoutMode to 'row'", () => {
    const result = buildNormalizedUIAST(makeNode({ layoutMode: "HORIZONTAL" }));
    assert.equal(result.layout.direction, "row");
  });

  it("maps VERTICAL layoutMode to 'column'", () => {
    const result = buildNormalizedUIAST(makeNode({ layoutMode: "VERTICAL" }));
    assert.equal(result.layout.direction, "column");
  });

  it("maps missing layoutMode to 'none'", () => {
    const result = buildNormalizedUIAST(makeNode());
    assert.equal(result.layout.direction, "none");
  });

  it("captures itemSpacing as gap", () => {
    const result = buildNormalizedUIAST(makeNode({ layoutMode: "HORIZONTAL", itemSpacing: 16 }));
    assert.equal(result.layout.gap, 16);
  });

  it("captures padding values", () => {
    const result = buildNormalizedUIAST(
      makeNode({ paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16 })
    );
    assert.deepEqual(result.layout.padding, { top: 8, right: 16, bottom: 8, left: 16 });
  });

  it("maps primaryAxisAlignItems to mainAxisAlignment", () => {
    const result = buildNormalizedUIAST(makeNode({ primaryAxisAlignItems: "CENTER" }));
    assert.equal(result.layout.mainAxisAlignment, "center");
  });

  it("maps counterAxisAlignItems to crossAxisAlignment", () => {
    const result = buildNormalizedUIAST(makeNode({ counterAxisAlignItems: "MAX" }));
    assert.equal(result.layout.crossAxisAlignment, "end");
  });

  it("maps BASELINE crossAxis to 'start'", () => {
    const result = buildNormalizedUIAST(makeNode({ counterAxisAlignItems: "BASELINE" }));
    assert.equal(result.layout.crossAxisAlignment, "start");
  });

  it("marks wrap=true when layoutWrap is WRAP", () => {
    const result = buildNormalizedUIAST(makeNode({ layoutWrap: "WRAP" } as Record<string, unknown>));
    assert.equal(result.layout.wrap, true);
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — sizing
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — sizing", () => {
  it("extracts width and height from absoluteBoundingBox", () => {
    const result = buildNormalizedUIAST(makeNode({ absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 64 } }));
    assert.equal(result.sizing.width, 320);
    assert.equal(result.sizing.height, 64);
  });

  it("uses null when absoluteBoundingBox is absent", () => {
    const result = buildNormalizedUIAST(makeNode());
    assert.equal(result.sizing.width, null);
    assert.equal(result.sizing.height, null);
  });

  it("maps FILL sizing mode", () => {
    const result = buildNormalizedUIAST(
      makeNode({
        layoutSizingHorizontal: "FILL",
        layoutSizingVertical: "HUG",
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 40 },
      } as Record<string, unknown>)
    );
    assert.equal(result.sizing.widthMode, "fill");
    assert.equal(result.sizing.heightMode, "hug");
  });

  it("includes minWidth and maxWidth when present", () => {
    const result = buildNormalizedUIAST(makeNode({ minWidth: 80, maxWidth: 400 } as Record<string, unknown>));
    assert.equal(result.sizing.minWidth, 80);
    assert.equal(result.sizing.maxWidth, 400);
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — fills
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — fills", () => {
  it("maps a SOLID fill to hex color", () => {
    const result = buildNormalizedUIAST(
      makeNode({
        fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
      })
    );
    assert.equal(result.fills.length, 1);
    assert.equal(result.fills[0]?.type, "solid");
    assert.equal(result.fills[0]?.color, "#FF0000FF");
  });

  it("skips invisible fills", () => {
    const result = buildNormalizedUIAST(
      makeNode({
        fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 }, visible: false }],
      })
    );
    assert.equal(result.fills.length, 0);
  });

  it("maps an IMAGE fill to type 'image'", () => {
    const result = buildNormalizedUIAST(makeNode({ fills: [{ type: "IMAGE", visible: true }] }));
    assert.equal(result.fills[0]?.type, "image");
  });

  it("maps a GRADIENT_LINEAR fill with stops", () => {
    const result = buildNormalizedUIAST(
      makeNode({
        fills: [
          {
            type: "GRADIENT_LINEAR",
            visible: true,
            gradientStops: [
              { color: { r: 1, g: 0, b: 0, a: 1 }, position: 0 },
              { color: { r: 0, g: 0, b: 1, a: 1 }, position: 1 },
            ],
          },
        ],
      })
    );
    assert.equal(result.fills[0]?.type, "gradient");
    assert.equal(result.fills[0]?.gradientStops?.length, 2);
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — typography
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — typography", () => {
  it("extracts typography from a TEXT node", () => {
    const textNode = makeNode({
      type: "TEXT",
      name: "Label",
      characters: "Hello World",
      style: {
        fontFamily: "Inter",
        fontSize: 14,
        fontWeight: 400,
        lineHeightPx: 20,
        letterSpacing: 0,
        textAlignHorizontal: "LEFT",
        textDecoration: "NONE",
      },
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, visible: true }],
    });

    const result = buildNormalizedUIAST(textNode);
    assert.ok(result.typography, "typography should be defined");
    assert.equal(result.typography?.content, "Hello World");
    assert.equal(result.typography?.fontFamily, "Inter");
    assert.equal(result.typography?.fontSize, 14);
    assert.equal(result.typography?.fontWeight, 400);
    assert.equal(result.typography?.lineHeight, 20);
    assert.equal(result.typography?.textAlign, "left");
  });

  it("does not set typography for non-TEXT nodes", () => {
    const result = buildNormalizedUIAST(makeNode({ type: "FRAME" }));
    assert.equal(result.typography, undefined);
  });

  it("maps CENTER text alignment", () => {
    const textNode = makeNode({
      type: "TEXT",
      characters: "Hi",
      style: {
        fontFamily: "Roboto",
        fontSize: 16,
        fontWeight: 700,
        textAlignHorizontal: "CENTER",
      },
      fills: [],
    });
    const result = buildNormalizedUIAST(textNode);
    assert.equal(result.typography?.textAlign, "center");
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — effects
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — effects", () => {
  it("maps DROP_SHADOW effect", () => {
    const result = buildNormalizedUIAST(
      makeNode({
        effects: [
          {
            type: "DROP_SHADOW",
            visible: true,
            radius: 8,
            spread: 0,
            color: { r: 0, g: 0, b: 0, a: 0.2 },
            offset: { x: 0, y: 4 },
          },
        ],
      })
    );
    assert.equal(result.effects.length, 1);
    assert.equal(result.effects[0]?.type, "drop-shadow");
    assert.equal(result.effects[0]?.radius, 8);
    assert.deepEqual(result.effects[0]?.offset, { x: 0, y: 4 });
  });

  it("maps LAYER_BLUR effect to type 'blur'", () => {
    const result = buildNormalizedUIAST(makeNode({ effects: [{ type: "LAYER_BLUR", visible: true, radius: 4 }] }));
    assert.equal(result.effects[0]?.type, "blur");
    assert.equal(result.effects[0]?.radius, 4);
  });

  it("skips invisible effects", () => {
    const result = buildNormalizedUIAST(makeNode({ effects: [{ type: "DROP_SHADOW", visible: false, radius: 8 }] }));
    assert.equal(result.effects.length, 0);
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — children
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — children", () => {
  it("recursively builds child nodes", () => {
    const node = makeNode({
      type: "FRAME",
      name: "Parent",
      children: [makeNode({ id: "2:1", name: "Child", type: "TEXT", children: [] })],
    });
    const result = buildNormalizedUIAST(node);
    assert.equal(result.children.length, 1);
    assert.equal(result.children[0]?.name, "Child");
    assert.equal(result.children[0]?.semantic, "text");
  });

  it("respects maxDepth limit", () => {
    const deep = makeNode({
      id: "3:1",
      name: "Level3",
      type: "FRAME",
      children: [],
    });
    const mid = makeNode({
      id: "2:1",
      name: "Level2",
      type: "FRAME",
      children: [deep],
    });
    const root = makeNode({
      id: "1:1",
      name: "Level1",
      type: "FRAME",
      children: [mid],
    });

    const result = buildNormalizedUIAST(root, 1);
    assert.equal(result.children.length, 1);
    assert.equal(result.children[0]?.children.length, 0);
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — componentInfo & variantProperties
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — componentInfo & variantProperties", () => {
  it("sets componentInfo.isInstance=true for INSTANCE nodes", () => {
    const result = buildNormalizedUIAST(makeNode({ type: "INSTANCE", name: "Button/Primary" }));
    assert.ok(result.componentInfo);
    assert.equal(result.componentInfo?.isInstance, true);
    assert.equal(result.componentInfo?.componentName, "Button/Primary");
  });

  it("does not set componentInfo for non-INSTANCE nodes", () => {
    const result = buildNormalizedUIAST(makeNode({ type: "FRAME" }));
    assert.equal(result.componentInfo, undefined);
  });

  it("extracts variantProperties from componentProperties", () => {
    const node = makeNode({
      type: "INSTANCE",
      name: "Button",
      componentProperties: {
        "Size#123": { type: "VARIANT", value: "Large" },
        "State#456": { type: "VARIANT", value: "Default" },
      },
    } as Record<string, unknown>);
    const result = buildNormalizedUIAST(node);
    assert.deepEqual(result.componentInfo?.variantProperties, {
      Size: "Large",
      State: "Default",
    });
  });

  it("parses variant properties from comma-separated name when no componentProperties", () => {
    const node = makeNode({
      type: "INSTANCE",
      name: "Size=Large, State=Default",
    });
    const result = buildNormalizedUIAST(node);
    assert.deepEqual(result.componentInfo?.variantProperties, {
      Size: "Large",
      State: "Default",
    });
  });

  it("does not set variantProperties when INSTANCE has no component properties or name pairs", () => {
    const result = buildNormalizedUIAST(makeNode({ type: "INSTANCE", name: "PlainButton" }));
    assert.ok(result.componentInfo);
    assert.equal(result.componentInfo?.variantProperties, undefined);
  });
});

// ---------------------------------------------------------------------------
// buildNormalizedUIAST — full mock node tree
// ---------------------------------------------------------------------------

describe("buildNormalizedUIAST — full mock node tree", () => {
  it("produces a complete normalized tree from a realistic mock", () => {
    const mockTree = makeNode({
      id: "root:1",
      name: "Card",
      type: "FRAME",
      layoutMode: "VERTICAL",
      itemSpacing: 12,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
      primaryAxisAlignItems: "MIN",
      counterAxisAlignItems: "STRETCH",
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
      cornerRadius: 12,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 }, visible: true }],
      strokes: [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, visible: true }],
      strokeWeight: 1,
      effects: [
        {
          type: "DROP_SHADOW",
          visible: true,
          radius: 8,
          spread: 0,
          color: { r: 0, g: 0, b: 0, a: 0.1 },
          offset: { x: 0, y: 2 },
        },
      ],
      children: [
        makeNode({
          id: "child:1",
          name: "Title",
          type: "TEXT",
          characters: "Welcome",
          style: {
            fontFamily: "Inter",
            fontSize: 20,
            fontWeight: 700,
            lineHeightPx: 28,
            letterSpacing: 0,
            textAlignHorizontal: "LEFT",
          },
          fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 }, visible: true }],
          children: [],
        }),
        makeNode({
          id: "child:2",
          name: "submit button",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
          fills: [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 1, a: 1 }, visible: true }],
          children: [
            makeNode({
              id: "child:3",
              name: "Label",
              type: "TEXT",
              characters: "Submit",
              style: {
                fontFamily: "Inter",
                fontSize: 14,
                fontWeight: 600,
                textAlignHorizontal: "CENTER",
              },
              fills: [],
              children: [],
            }),
          ],
        }),
      ],
    });

    const result = buildNormalizedUIAST(mockTree);

    // Root assertions
    assert.equal(result.name, "Card");
    assert.equal(result.figmaId, "root:1");
    assert.equal(result.layout.direction, "column");
    assert.equal(result.layout.gap, 12);
    assert.deepEqual(result.layout.padding, { top: 16, right: 16, bottom: 16, left: 16 });
    assert.equal(result.layout.mainAxisAlignment, "start");
    assert.equal(result.layout.crossAxisAlignment, "stretch");
    assert.equal(result.sizing.width, 300);
    assert.equal(result.sizing.height, 200);
    assert.equal(result.cornerRadius, 12);
    assert.equal(result.fills.length, 1);
    assert.equal(result.fills[0]?.color, "#FFFFFFFF");
    assert.equal(result.strokes.length, 1);
    assert.equal(result.effects.length, 1);
    assert.equal(result.effects[0]?.type, "drop-shadow");

    // Children
    assert.equal(result.children.length, 2);
    const title = result.children[0];
    assert.ok(title);
    assert.equal(title.semantic, "text");
    assert.equal(title.typography?.content, "Welcome");
    assert.equal(title.typography?.fontSize, 20);
    assert.equal(title.typography?.fontWeight, 700);

    const button = result.children[1];
    assert.ok(button);
    assert.equal(button.semantic, "button");
    assert.equal(button.children.length, 1);
    assert.equal(button.children[0]?.typography?.content, "Submit");
  });
});
