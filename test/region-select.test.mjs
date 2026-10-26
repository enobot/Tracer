import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fullMonitorSelection,
  pairDisplaySources,
  selectionForRequest,
  selectionToCrop,
  validateDipSelection,
} from '../src/region-select.mjs';

describe('region selection', () => {
  const hd = { width: 1920, height: 1080 };
  const scaledThumbnail = { width: 2880, height: 1620 };

  it('rejects tiny, inverted, and out-of-bounds drags', () => {
    assert.equal(
      validateDipSelection({ x: 0, y: 0, width: 7, height: 40 }, hd),
      null,
    );
    assert.equal(
      validateDipSelection({ x: -1, y: 0, width: 20, height: 20 }, hd),
      null,
    );
    assert.equal(
      validateDipSelection({ x: 1900, y: 0, width: 40, height: 40 }, hd),
      null,
    );
    assert.equal(
      validateDipSelection({ x: Number.NaN, y: 0, width: 20, height: 20 }, hd),
      null,
    );
  });

  it('maps a DIP drag through a 1.5 scale thumbnail', () => {
    const crop = selectionToCrop(
      { x: 100, y: 80, width: 200, height: 150 },
      hd,
      scaledThumbnail,
    );
    assert.deepEqual(crop, { x: 150, y: 120, width: 300, height: 225 });
  });

  it('keeps a selection local on a monitor that starts left of the origin', () => {
    const crop = selectionToCrop({ x: 10, y: 20, width: 40, height: 30 }, hd, {
      width: 1920,
      height: 1080,
    });
    assert.deepEqual(crop, { x: 10, y: 20, width: 40, height: 30 });
  });

  it('crops a right-click to the whole monitor at that display scale', () => {
    const selection = selectionForRequest({ mode: 'full' }, hd);
    assert.deepEqual(selection, fullMonitorSelection(hd));
    assert.deepEqual(selectionToCrop(selection, hd, scaledThumbnail), {
      x: 0,
      y: 0,
      width: 2880,
      height: 1620,
    });
  });

  it('pairs two monitors by id when their thumbnails arrive reversed', () => {
    const displays = [
      { id: 10, size: { width: 2560, height: 1440 }, scaleFactor: 1 },
      { id: 22, size: hd, scaleFactor: 1.5 },
    ];
    const sources = [
      { id: 'right', displayId: '22', width: 2880, height: 1620 },
      { id: 'left', displayId: '10', width: 2560, height: 1440 },
    ];
    assert.deepEqual(pairDisplaySources(displays, sources), [
      { displayId: '10', sourceId: 'left' },
      { displayId: '22', sourceId: 'right' },
    ]);
    const right = selectionToCrop(
      selectionForRequest(
        { mode: 'region', x: 0, y: 0, width: 100, height: 50 },
        hd,
      ),
      hd,
      { width: 2880, height: 1620 },
    );
    assert.deepEqual(right, { x: 0, y: 0, width: 150, height: 75 });
  });

  it('falls back to physical size when a source has no display id', () => {
    const pairs = pairDisplaySources(
      [
        { id: 1, size: { width: 1280, height: 720 }, scaleFactor: 1 },
        { id: 2, size: hd, scaleFactor: 2 },
      ],
      [
        { id: 'a', displayId: '', width: 3840, height: 2160 },
        { id: 'b', displayId: '', width: 1280, height: 720 },
      ],
    );
    assert.deepEqual(pairs, [
      { displayId: '1', sourceId: 'b' },
      { displayId: '2', sourceId: 'a' },
    ]);
  });
});
