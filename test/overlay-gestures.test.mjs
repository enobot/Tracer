import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSelectionGesture } from '../src/overlay-gestures.mjs';

describe('selection mouse controls', () => {
  it('captures a left-button drag and ignores a second release', () => {
    const gesture = createSelectionGesture();
    assert.equal(
      gesture.pointerDown({ button: 0, x: 10, y: 12 }).type,
      'begin',
    );
    assert.equal(gesture.pointerMove({ x: 180, y: 140 }).type, 'move');
    const chosen = gesture.pointerUp({ button: 0, x: 180, y: 140 });
    assert.deepEqual(chosen, {
      type: 'region',
      rect: { x: 10, y: 12, width: 170, height: 128 },
    });
    assert.equal(
      gesture.pointerUp({ button: 0, x: 180, y: 140 }).type,
      'ignore',
    );
  });

  it('uses the mouse-release point when move events were skipped', () => {
    const gesture = createSelectionGesture();
    gesture.pointerDown({ button: 0, x: 10, y: 10 });
    assert.deepEqual(gesture.pointerUp({ button: 0, x: 80, y: 60 }), {
      type: 'region',
      rect: { x: 10, y: 10, width: 70, height: 50 },
    });
  });

  it('cancels a tiny left drag without a region', () => {
    const gesture = createSelectionGesture();
    gesture.pointerDown({ button: 0, x: 4, y: 4 });
    assert.equal(gesture.pointerUp({ button: 0, x: 8, y: 6 }).type, 'cancel');
  });

  it('captures the whole monitor on an immediate right-click', () => {
    const gesture = createSelectionGesture();
    assert.deepEqual(gesture.contextMenu(), { prevent: true });
    assert.equal(gesture.pointerDown({ button: 2, x: 20, y: 20 }).type, 'full');
    assert.equal(gesture.pointerUp({ button: 2, x: 20, y: 20 }).type, 'ignore');
    assert.equal(gesture.pointerDown({ button: 0, x: 1, y: 1 }).type, 'ignore');
  });

  it('lets a right-click replace an in-progress drag', () => {
    const gesture = createSelectionGesture();
    gesture.pointerDown({ button: 0, x: 5, y: 5 });
    gesture.pointerMove({ x: 90, y: 90 });
    assert.equal(gesture.pointerDown({ button: 2, x: 90, y: 90 }).type, 'full');
    assert.equal(gesture.pointerUp({ button: 0, x: 90, y: 90 }).type, 'ignore');
  });

  it('clamps a drag that leaves the monitor to the overlay edge', () => {
    // Pointer capture keeps reporting positions after the cursor crosses
    // onto the next monitor, so clientX can exceed this overlay's width.
    const gesture = createSelectionGesture(() => ({
      width: 1920,
      height: 1080,
    }));
    gesture.pointerDown({ button: 0, x: 1800, y: 100 });
    gesture.pointerMove({ x: 2400, y: -40 });
    assert.deepEqual(gesture.pointerUp({ button: 0, x: 2500, y: -60 }), {
      type: 'region',
      rect: { x: 1800, y: 0, width: 120, height: 100 },
    });
  });

  it('cancels on Escape and ignores a later click', () => {
    const gesture = createSelectionGesture();
    gesture.pointerDown({ button: 0, x: 15, y: 15 });
    assert.equal(gesture.cancel().type, 'cancel');
    assert.equal(gesture.cancel().type, 'ignore');
    assert.equal(gesture.pointerUp({ button: 0, x: 80, y: 80 }).type, 'ignore');
  });
});
