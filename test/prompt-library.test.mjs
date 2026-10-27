import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearPast,
  deletePrompt,
  emptyLibrary,
  listFavorites,
  normalizeLibrary,
  recordSubmission,
  savePrompt,
  setFavorite,
  setHistoryEnabled,
  updatePrompt,
} from '../src/prompt-library.mjs';

describe('prompt library', () => {
  it('saves once, renames, favorites, and drops image fields', () => {
    const saved = savePrompt(
      emptyLibrary(),
      'Translate this',
      '2026-10-25T00:00:00.000Z',
      'a',
    );
    assert.equal(saved.status, 'saved');
    assert.equal(
      savePrompt(saved.state, 'Translate this', '2026-10-25T00:00:01.000Z', 'b')
        .status,
      'duplicate',
    );
    const renamed = updatePrompt(
      saved.state,
      'a',
      { title: 'Vietnamese', text: 'Translate this to Vietnamese' },
      '2026-10-25T00:00:02.000Z',
    );
    assert.equal(renamed.status, 'saved');
    const favorite = setFavorite(renamed.state, 'a', true);
    assert.equal(listFavorites(favorite)[0].title, 'Vietnamese');
    const stored = normalizeLibrary({
      ...favorite,
      saved: [{ ...favorite.saved[0], image: 'data:image/png;base64,aaaa' }],
    });
    assert.equal(JSON.stringify(stored).includes('data:image'), false);
    assert.equal(deletePrompt(stored, 'a').saved.length, 0);
  });

  it('records past prompts only while history is enabled', () => {
    let library = recordSubmission(
      emptyLibrary(),
      'First question',
      '2026-10-25T00:00:00.000Z',
      'p1',
    );
    library = setFavorite(library, 'p1', true);
    library = recordSubmission(
      library,
      'First question',
      '2026-10-25T00:00:02.000Z',
      'p2',
    );
    assert.equal(library.past.length, 1);
    assert.equal(library.past[0].favorite, true);
    assert.equal(library.past[0].id, 'p1');
    library = setHistoryEnabled(library, false);
    library = recordSubmission(
      library,
      'Second question',
      '2026-10-25T00:00:03.000Z',
      'p3',
    );
    assert.equal(library.past.length, 1);
    assert.equal(clearPast(library).past.length, 0);
  });

  it('unfavorites every copy of a prompt so Favorites does not show a hidden twin', () => {
    let library = savePrompt(
      emptyLibrary(),
      'Explain this error',
      '2026-10-25T00:00:00.000Z',
      'saved-1',
    ).state;
    library = recordSubmission(
      library,
      'explain this error',
      '2026-10-25T00:00:01.000Z',
      'past-1',
    );
    library = setFavorite(library, 'past-1', true);
    assert.deepEqual(
      listFavorites(library).map((item) => item.id),
      ['saved-1'],
    );
    library = setFavorite(library, 'saved-1', false);
    assert.deepEqual(listFavorites(library), []);
    assert.equal(
      library.past[0].favorite,
      false,
      'the past copy was cleared too',
    );
  });
});
