import { TOPICS, TOPIC_TITLES, type Topic } from '@partner-desk/method';
import { TEXT_MAX } from '../shared/schemas';

type Section = Topic | 'notes';

const normalize = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();

const TITLE_TO_TOPIC = new Map<string, Topic>(TOPICS.map((t) => [normalize(TOPIC_TITLES[t]), t]));

const EMPHASIS_EDGE = /^(?:\*\*|__|\*|_)+|(?:\*\*|__|\*|_)+$/g;

function stripLead(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(?:[-*•]\s+)/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

function topicOf(head: string): Topic | undefined {
  const cleaned = head.trim().replace(EMPHASIS_EDGE, '').replace(/:\s*$/, '').replace(EMPHASIS_EDGE, '');
  return TITLE_TO_TOPIC.get(normalize(cleaned));
}

type Parsed = { kind: 'topic'; topic: Topic; rest: string } | { kind: 'unknown' } | { kind: 'text' };

function classify(line: string): Parsed {
  const body = stripLead(line);
  const whole = topicOf(body);
  if (whole) return { kind: 'topic', topic: whole, rest: '' };
  const colon = body.indexOf(':');
  if (colon > 0) {
    const topic = topicOf(body.slice(0, colon));
    if (topic) {
      const rest = body.slice(colon + 1).trim().replace(/^(?:\*\*|__)\s*/, '').trim();
      return { kind: 'topic', topic, rest };
    }
  }
  const trimmed = line.trim();
  if (/^#{1,6}(\s|$)/.test(trimmed)) return { kind: 'unknown' };
  if (/^(?:\*\*[^*]+\*\*|__[^_]+__):?$/.test(trimmed)) return { kind: 'unknown' };
  return { kind: 'text' };
}

const trimBlankLines = (lines: string[]) => lines.join('\n').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');

export function sortNotes(text: string): {
  topics: Record<Topic, string>;
  notes: string;
  foundHeadings: boolean;
  tooLong: Topic | 'notes' | null;
} {
  const blocks: Record<Section, string[]> = {
    notes: [],
    ...(Object.fromEntries(TOPICS.map((t) => [t, []])) as unknown as Record<Topic, string[]>),
  };
  let foundHeadings = false;
  let current: Section = 'notes';
  let lines: string[] = [];
  const flush = () => {
    const block = trimBlankLines(lines);
    if (block) blocks[current].push(block);
    lines = [];
  };

  for (const line of text.split(/\r\n|\r|\n/)) {
    const parsed = classify(line);
    if (parsed.kind === 'text') {
      lines.push(line);
      continue;
    }
    flush();
    if (parsed.kind === 'topic') {
      foundHeadings = true;
      current = parsed.topic;
      if (parsed.rest) lines.push(parsed.rest);
    } else {
      current = 'notes';
      lines.push(line);
    }
  }
  flush();

  const joined = (s: Section) => blocks[s].join('\n\n');
  const topics = Object.fromEntries(TOPICS.map((t) => [t, joined(t)])) as Record<Topic, string>;
  const notes = joined('notes');
  const order: Section[] = [...TOPICS, 'notes'];
  const tooLong = order.find((s) => (s === 'notes' ? notes : topics[s]).length > TEXT_MAX) ?? null;
  return { topics, notes, foundHeadings, tooLong };
}
