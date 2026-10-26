export function validateDipSelection(selection, displaySize) {
  if (!selection || !displaySize) return null;
  const numbers = [
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    displaySize.width,
    displaySize.height,
  ];
  if (!numbers.every((value) => Number.isFinite(value))) return null;
  const rect = {
    x: Math.round(selection.x),
    y: Math.round(selection.y),
    width: Math.round(selection.width),
    height: Math.round(selection.height),
  };
  const width = Math.round(displaySize.width);
  const height = Math.round(displaySize.height);
  if (width < 8 || height < 8) return null;
  if (rect.width < 8 || rect.height < 8) return null;
  if (rect.x < 0 || rect.y < 0) return null;
  if (rect.x + rect.width > width || rect.y + rect.height > height) return null;
  return rect;
}

export function fullMonitorSelection(displaySize) {
  if (!displaySize) return null;
  return validateDipSelection(
    {
      x: 0,
      y: 0,
      width: displaySize.width,
      height: displaySize.height,
    },
    displaySize,
  );
}

export function selectionForRequest(request, displaySize) {
  if (!request || request.mode === 'full') {
    return request?.mode === 'full' ? fullMonitorSelection(displaySize) : null;
  }
  if (request.mode !== 'region') return null;
  return validateDipSelection(request, displaySize);
}

export function selectionToCrop(selection, displaySize, thumbnailSize) {
  const dip = validateDipSelection(selection, displaySize);
  if (!dip || !thumbnailSize) return null;
  if (
    !Number.isFinite(thumbnailSize.width) ||
    !Number.isFinite(thumbnailSize.height) ||
    thumbnailSize.width < 1 ||
    thumbnailSize.height < 1
  ) {
    return null;
  }
  const scaleX = thumbnailSize.width / displaySize.width;
  const scaleY = thumbnailSize.height / displaySize.height;
  const crop = {
    x: Math.round(dip.x * scaleX),
    y: Math.round(dip.y * scaleY),
    width: Math.max(1, Math.round(dip.width * scaleX)),
    height: Math.max(1, Math.round(dip.height * scaleY)),
  };
  if (crop.x >= thumbnailSize.width || crop.y >= thumbnailSize.height) {
    return null;
  }
  if (crop.x + crop.width > thumbnailSize.width) {
    crop.width = Math.floor(thumbnailSize.width - crop.x);
  }
  if (crop.y + crop.height > thumbnailSize.height) {
    crop.height = Math.floor(thumbnailSize.height - crop.y);
  }
  if (crop.width < 1 || crop.height < 1) return null;
  return crop;
}

export function pairDisplaySources(displays, sources) {
  const remaining = (Array.isArray(sources) ? sources : []).filter(
    (source) =>
      source &&
      source.empty !== true &&
      Number.isFinite(source.width) &&
      Number.isFinite(source.height) &&
      source.width > 0 &&
      source.height > 0,
  );
  const pairs = [];
  const claim = (display, found) => {
    if (!found) return;
    remaining.splice(remaining.indexOf(found), 1);
    pairs.push({
      displayId: String(display.id),
      sourceId: found.id,
    });
  };

  for (const display of displays || []) {
    claim(
      display,
      remaining.find(
        (source) => String(source.displayId) === String(display.id),
      ),
    );
  }

  for (const display of displays || []) {
    if (pairs.some((pair) => pair.displayId === String(display.id))) continue;
    const scale =
      Number(display.scaleFactor) > 0 ? Number(display.scaleFactor) : 1;
    const expectedWidth = Math.round(display.size.width * scale);
    const expectedHeight = Math.round(display.size.height * scale);
    claim(
      display,
      remaining.find(
        (source) =>
          Math.abs(source.width - expectedWidth) <= 4 &&
          Math.abs(source.height - expectedHeight) <= 4,
      ),
    );
  }

  if (displays?.length === 1 && remaining.length === 1 && pairs.length === 0) {
    pairs.push({
      displayId: String(displays[0].id),
      sourceId: remaining[0].id,
    });
  }
  return pairs;
}
