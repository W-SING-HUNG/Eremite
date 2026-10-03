const layers: string[] = [];

export function registerOverlay(id: string) {
  const existing = layers.indexOf(id);
  if (existing >= 0) layers.splice(existing, 1);
  layers.push(id);
  return () => {
    const index = layers.lastIndexOf(id);
    if (index >= 0) layers.splice(index, 1);
  };
}

export function isTopOverlay(id: string) {
  return layers.at(-1) === id;
}

export function overlayDepth(id: string) {
  const index = layers.indexOf(id);
  return index < 0 ? 0 : index + 1;
}

export function clearOverlayStackForTests() {
  layers.splice(0, layers.length);
}
