import { describe, expect, it } from 'vitest';
import { createRemapId, validateExportFile } from '../exportFile';

function validSection() {
  return {
    pluginId: 'fs.sovereign.tasks',
    schemaVersion: 1,
    data: { lists: [], userListPrefs: [], views: [], items: [], notificationPrefs: null },
  };
}

describe('validateExportFile', () => {
  it('accepts a well-formed export section', () => {
    const section = validSection();
    expect(validateExportFile(section)).toBe(section);
  });

  it('rejects non-object input', () => {
    expect(validateExportFile(null)).toEqual({ error: expect.any(String) });
    expect(validateExportFile('a string')).toEqual({ error: expect.any(String) });
    expect(validateExportFile(42)).toEqual({ error: expect.any(String) });
  });

  it('rejects a file exported by a different plugin', () => {
    const result = validateExportFile({ ...validSection(), pluginId: 'fs.sovereign.plainwrite' });
    expect(result).toEqual({ error: expect.stringContaining('different app') });
  });

  it('rejects an unrecognized schema version', () => {
    const result = validateExportFile({ ...validSection(), schemaVersion: 99 });
    expect(result).toEqual({ error: expect.stringContaining('incompatible version') });
  });

  it('rejects a malformed data payload', () => {
    const result = validateExportFile({ ...validSection(), data: { lists: 'not-an-array' } });
    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe('createRemapId', () => {
  it('is stable for the same original id across calls', () => {
    const remapId = createRemapId();
    const first = remapId('original-1');
    expect(remapId('original-1')).toBe(first);
  });

  it('mints a different id for a different original id', () => {
    const remapId = createRemapId();
    expect(remapId('a')).not.toBe(remapId('b'));
  });

  it('is independent across separate instances', () => {
    expect(createRemapId()('same')).not.toBe(createRemapId()('same'));
  });
});
