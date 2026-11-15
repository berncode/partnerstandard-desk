import type { Page, Response } from '@playwright/test';

/**
 * Resolves with the answer of the next server action whose arguments contain `text`: a save's own answer. Start it
 * before the change that saves, and await it before the test leaves the page or reads the saved state elsewhere.
 * Many screens show a change at once (a dialog closes, a row or card shows or goes) and save it in the background, so
 * what is on screen says nothing about whether the save is done.
 */
export const actionAnswer = (page: Page, text: string): Promise<Response> => page.waitForResponse((response) => {
  const request = response.request();
  return request.method() === 'POST' && request.headers()['next-action'] !== undefined && (request.postData() ?? '').includes(text);
});
