import type { Node } from 'reactflow';
import type {
  PersistedTimelineDatePrecision,
  PersistedTimelineEvent,
  PersistedTimelineEventProvenance,
  PersistedTimelineSnapshot,
} from './hierarchicalCanvas';

interface DateParseResult {
  parsedDate: number | null;
  datePrecision: PersistedTimelineDatePrecision;
}

interface DateCandidate {
  timestamp: string;
  start: number;
  end: number;
  provenance: PersistedTimelineEventProvenance;
}

const DATE_TAG_REGEX = /\[DATE:([^\]]+)\]/gi;
const ISO_DATE_REGEX = /\b(?:18|19|20)\d{2}-\d{2}-\d{2}\b/g;
const MONTH_NAME_REGEX = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+(?:18|19|20)\d{2}\b/gi;
const YEAR_REGEX = /\b(?:18|19|20)\d{2}\b/g;

const sanitizeText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const normalizeWhitespace = (value: string) =>
  value
    .replace(DATE_TAG_REGEX, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;,.!?-]+/, '')
    .trim();

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const parseTimelineDate = (timestamp: string): DateParseResult => {
  const value = timestamp.trim();
  if (!value || value.toLowerCase().includes('unknown')) {
    return { parsedDate: null, datePrecision: 'unknown' };
  }

  if (/^(?:18|19|20)\d{2}$/.test(value)) {
    return { parsedDate: Date.UTC(Number(value), 0, 1), datePrecision: 'year' };
  }

  if (/^(?:18|19|20)\d{2}-\d{2}$/.test(value)) {
    const parsedMonth = Date.parse(`${value}-01T00:00:00.000Z`);
    return {
      parsedDate: Number.isNaN(parsedMonth) ? null : parsedMonth,
      datePrecision: Number.isNaN(parsedMonth) ? 'unknown' : 'month',
    };
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return { parsedDate: parsed, datePrecision: 'day' };
  }

  const yearMatch = value.match(/\b(?:18|19|20)\d{2}\b/);
  if (yearMatch) {
    return { parsedDate: Date.UTC(Number(yearMatch[0]), 0, 1), datePrecision: 'year' };
  }

  return { parsedDate: null, datePrecision: 'unknown' };
};

const rangesOverlap = (a: Pick<DateCandidate, 'start' | 'end'>, b: Pick<DateCandidate, 'start' | 'end'>) =>
  a.start < b.end && b.start < a.end;

const collectDateCandidates = (text: string): DateCandidate[] => {
  const candidates: DateCandidate[] = [];

  const addRegexMatches = (
    regex: RegExp,
    provenance: PersistedTimelineEventProvenance,
    getTimestamp: (match: RegExpExecArray) => string,
  ) => {
    regex.lastIndex = 0;
    let match = regex.exec(text);
    while (match) {
      const candidate = {
        timestamp: getTimestamp(match).trim(),
        start: match.index,
        end: match.index + match[0].length,
        provenance,
      };
      if (candidate.timestamp && !candidates.some((existing) => rangesOverlap(existing, candidate))) {
        candidates.push(candidate);
      }
      match = regex.exec(text);
    }
  };

  addRegexMatches(DATE_TAG_REGEX, 'date-tag', (match) => match[1]);
  addRegexMatches(ISO_DATE_REGEX, 'text-date', (match) => match[0]);
  addRegexMatches(MONTH_NAME_REGEX, 'text-date', (match) => match[0]);
  addRegexMatches(YEAR_REGEX, 'text-date', (match) => match[0]);

  return candidates.sort((a, b) => a.start - b.start);
};

const extractSentenceAround = (text: string, start: number, end: number) => {
  const beforePunctuation = Math.max(
    text.lastIndexOf('.', start - 1),
    text.lastIndexOf('!', start - 1),
    text.lastIndexOf('?', start - 1),
    text.lastIndexOf('\n', start - 1),
  );
  const afterCandidates = ['.', '!', '?', '\n']
    .map((marker) => text.indexOf(marker, end))
    .filter((index) => index !== -1);
  const sentenceStart = beforePunctuation === -1 ? 0 : beforePunctuation + 1;
  const sentenceEnd = afterCandidates.length === 0 ? text.length : Math.min(...afterCandidates) + 1;
  return normalizeWhitespace(text.slice(sentenceStart, sentenceEnd));
};

const buildEventId = (event: Omit<PersistedTimelineEvent, 'id'>) =>
  `timeline-${hashString([
    event.timestamp.toLowerCase(),
    event.event.toLowerCase(),
    event.sourceNodeId,
    event.provenance,
  ].join('|'))}`;

const sortTimelineEvents = (events: PersistedTimelineEvent[]) => [...events].sort((a, b) => {
  if (a.parsedDate !== null && b.parsedDate !== null) {
    return a.parsedDate - b.parsedDate;
  }
  if (a.parsedDate !== null) return -1;
  if (b.parsedDate !== null) return 1;
  return a.timestamp.localeCompare(b.timestamp) || a.event.localeCompare(b.event);
});

const uniqueTimelineEvents = (events: PersistedTimelineEvent[]) => {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key = `${event.timestamp.trim().toLowerCase()}|${event.event.trim().toLowerCase()}|${event.sourceNodeId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const buildTimelineEvent = (
  input: Omit<PersistedTimelineEvent, 'id' | 'parsedDate' | 'datePrecision'>,
): PersistedTimelineEvent | null => {
  const timestamp = sanitizeText(input.timestamp);
  const eventText = normalizeWhitespace(input.event);
  const sourceNodeId = sanitizeText(input.sourceNodeId);
  const sourceTitle = sanitizeText(input.sourceTitle) || 'Unknown Source';
  if (!timestamp || !eventText || !sourceNodeId) {
    return null;
  }

  const parsed = parseTimelineDate(timestamp);
  const eventWithoutId = {
    timestamp,
    event: eventText,
    sourceNodeId,
    sourceTitle,
    provenance: input.provenance,
    parsedDate: parsed.parsedDate,
    datePrecision: parsed.datePrecision,
  };

  return {
    id: buildEventId(eventWithoutId),
    ...eventWithoutId,
  };
};

export const extractTimelineEventsFromNodes = (nodes: Node[]): PersistedTimelineEvent[] => {
  const events: PersistedTimelineEvent[] = [];

  nodes.forEach((node) => {
    const sourceNodeId = node.id;
    const sourceTitle = sanitizeText(node.data?.title) || 'Unknown Source';
    const insights = Array.isArray(node.data?.personaInsights) ? node.data?.personaInsights : [];

    insights.forEach((insight: unknown) => {
      const timelineEvents = insight && typeof insight === 'object' && Array.isArray((insight as { timelineEvents?: unknown }).timelineEvents)
        ? (insight as { timelineEvents: unknown[] }).timelineEvents
        : [];
      timelineEvents.forEach((timelineEvent) => {
        if (!timelineEvent || typeof timelineEvent !== 'object') {
          return;
        }
        const candidate = timelineEvent as { timestamp?: unknown; event?: unknown; sourceNodeId?: unknown };
        const event = buildTimelineEvent({
          timestamp: sanitizeText(candidate.timestamp),
          event: sanitizeText(candidate.event),
          sourceNodeId: sanitizeText(candidate.sourceNodeId) || sourceNodeId,
          sourceTitle,
          provenance: 'persona',
        });
        if (event) {
          events.push(event);
        }
      });
    });

    const searchableText = [node.data?.summary, node.data?.fullText]
      .map(sanitizeText)
      .filter(Boolean)
      .join('\n');
    collectDateCandidates(searchableText).forEach((candidate) => {
      const context = extractSentenceAround(searchableText, candidate.start, candidate.end);
      const event = buildTimelineEvent({
        timestamp: candidate.timestamp,
        event: context || `${sourceTitle} references ${candidate.timestamp}.`,
        sourceNodeId,
        sourceTitle,
        provenance: candidate.provenance,
      });
      if (event) {
        events.push(event);
      }
    });
  });

  return sortTimelineEvents(uniqueTimelineEvents(events));
};

export const computeTimelineSourceFingerprint = (nodes: Node[]) => {
  const sourcePayload = [...nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => ({
      id: node.id,
      title: sanitizeText(node.data?.title),
      summary: sanitizeText(node.data?.summary),
      fullText: sanitizeText(node.data?.fullText),
      sourceURL: sanitizeText(node.data?.sourceURL),
      personaInsights: Array.isArray(node.data?.personaInsights)
        ? node.data?.personaInsights.map((insight: unknown) => {
          const timelineEvents = insight && typeof insight === 'object' && Array.isArray((insight as { timelineEvents?: unknown }).timelineEvents)
            ? (insight as { timelineEvents: unknown[] }).timelineEvents
            : [];
          return timelineEvents.map((timelineEvent) => {
            const candidate = timelineEvent as { timestamp?: unknown; event?: unknown; sourceNodeId?: unknown };
            return {
              timestamp: sanitizeText(candidate.timestamp),
              event: sanitizeText(candidate.event),
              sourceNodeId: sanitizeText(candidate.sourceNodeId),
            };
          });
        })
        : [],
    }));

  return `tl-${hashString(JSON.stringify(sourcePayload))}`;
};

export const buildTimelineSnapshotFromNodes = (
  nodes: Node[],
  generatedAt = new Date().toISOString(),
): PersistedTimelineSnapshot => ({
  generatedAt,
  sourceFingerprint: computeTimelineSourceFingerprint(nodes),
  events: extractTimelineEventsFromNodes(nodes),
});
