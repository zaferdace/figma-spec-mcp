# Figma to Unity Rules

## Group-as-Image with Text Extraction

When a `GROUP` or `FRAME` mixes direct `TEXT` children with direct non-text children, `map_to_unity` should treat that node as a single exported image plus extracted text overlays.

### Detection

- The node type is `GROUP` or `FRAME`
- `layoutMode` is missing or `NONE`
- At least one visible direct child is `TEXT`
- At least `groupAsImage.minNonTextChildren` visible direct children are non-text
- `groupAsImage.enabled` is `true`

### Mapping Output

- Set `exportAsImage: true` on the parent `UnityNode`
- Add `Image` to the parent's suggested Unity components
- Populate `extractedTexts` with one entry per direct text child
- Keep only the direct text children in the mapped Unity hierarchy so visual children are not duplicated in Unity

### Extracted Text Fields

Each extracted text entry includes:

- `name`
- `content`
- `position` relative to the exported parent group: `x`, `y`, `width`, `height`
- `fontSize`
- `fontFamily`
- `fontWeight`
- `color` as hex
- `alignment.horizontal`
- `alignment.vertical`

### Export Behavior

`map_to_unity` does not call the Figma image export API. It only marks eligible nodes so the Unity-side workflow can export the group PNG with text temporarily hidden and then rebuild the text as `TextMeshProUGUI` children.
