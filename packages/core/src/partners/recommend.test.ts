import { expect, test } from 'vitest';
import { FOUR_C } from '@partner-desk/method';
import { confirmedRecommendation, deskRecommendation } from './recommend';
import type { Score, Scores } from './types';

const S = (a: (Score | null)[]) => Object.fromEntries(FOUR_C.map((c, i) => [c, a[i]])) as Scores;

test('desk', () => {
  expect(deskRecommendation(S([null, null, null, null]))).toBeNull();
  expect(deskRecommendation(S([2, 0, null, null]))).toMatchObject({ kind: 'skip', failing: ['credibility'], text: 'Skip: Credibility fails' });
  expect(deskRecommendation(S([1, 2, null, null]))).toMatchObject({ kind: 'call', text: 'Worth a discovery call' });
});

test('desk names every failing C', () => {
  expect(deskRecommendation(S([0, 2, null, 0]))).toMatchObject({
    kind: 'skip', failing: ['customerBase', 'commitment'], text: 'Skip: Customer base and Commitment fail',
  });
});

test('confirmed', () => {
  expect(confirmedRecommendation(S([3, 2, 2, null]))).toBeNull();
  expect(confirmedRecommendation(S([3, 0, 2, 2]))).toMatchObject({ kind: 'stop', failing: ['credibility'] });
  expect(confirmedRecommendation(S([2, 2, 3, 2]))).toMatchObject({ kind: 'proceed' });
  expect(confirmedRecommendation(S([2, 1, 3, 1]))).toMatchObject({ kind: 'not_now', low: ['credibility', 'commitment'],
    text: 'Not now, or follow up to fill the gaps: Credibility, Commitment' });
});
