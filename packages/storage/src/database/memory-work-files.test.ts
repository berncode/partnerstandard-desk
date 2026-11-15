import { describe, expect, it } from 'vitest';
import { runWorkFilesContract } from '../work-files.contract';
import { newWorkFileId, WORK_FILE_ID } from './work-files';
import { MemoryWorkFiles } from './memory-work-files';

runWorkFilesContract('memory', () => new MemoryWorkFiles());

describe('newWorkFileId', () => {
  it('is wf_ and 20 hex characters from a UUID', () => {
    expect(newWorkFileId(() => '0123abcd-4567-4890-abcd-ef0123456789')).toBe('wf_0123abcd45674890abcd');
    expect(newWorkFileId()).toMatch(WORK_FILE_ID);
  });

  it('refuses a random source too short or not hex, rather than make a short id', () => {
    expect(() => newWorkFileId(() => 'abc')).toThrow('work_file_id_failed');
    expect(() => newWorkFileId(() => 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toThrow('work_file_id_failed');
  });
});
