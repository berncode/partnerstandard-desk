import { describe, expect, it } from 'vitest';
import { inlineLinks } from './inline-links';

describe('inlineLinks', () => {
  it('returns plain text as one part, and nothing for an empty string', () => {
    expect(inlineLinks('Just text.')).toEqual([{ text: 'Just text.' }]);
    expect(inlineLinks('')).toEqual([]);
  });

  it('finds a [text](href) link and keeps the text around it', () => {
    expect(inlineLinks('Read the [Google policy](https://developers.google.com/terms?hl=en), please.')).toEqual([
      { text: 'Read the ' }, { text: 'Google policy', href: 'https://developers.google.com/terms?hl=en' }, { text: ', please.' },
    ]);
  });

  it('finds bold run-in labels and inline code', () => {
    expect(inlineLinks('**Email:** hello (`drive.file`): end')).toEqual([
      { text: 'Email:', strong: true }, { text: ' hello (' }, { text: 'drive.file', code: true }, { text: '): end' },
    ]);
    expect(inlineLinks('**"Service"** means')).toEqual([{ text: '"Service"', strong: true }, { text: ' means' }]);
  });

  it('leaves unmatched markers as text', () => {
    expect(inlineLinks('a ** b [c] (d) `e')).toEqual([{ text: 'a ** b [c] (d) `e' }]);
  });
});
