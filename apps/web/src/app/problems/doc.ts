import { API_PROBLEMS } from '@partner-desk/copy';
import type { LegalDoc } from '@/content/legal/types';

/** The API's error codes as a document: each code a heading with its own anchor (/problems#conflict). */
export function problemsDoc(): Omit<LegalDoc, 'effective'> {
  return {
    title: API_PROBLEMS.title,
    intro: [API_PROBLEMS.intro],
    sections: API_PROBLEMS.entries.map((entry) => ({
      heading: entry.code,
      blocks: [`${API_PROBLEMS.status(entry.status, entry.also)} ${entry.text}`],
    })),
  };
}
