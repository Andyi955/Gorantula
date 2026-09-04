import React from 'react'
import type { NodeImageAsset } from './nodeImages'

export type NodeDossier = {
    title: string;
    summary: string;
    fullText: string;
    sourceURL?: string;
    origin?: string;
    rabbitTool?: string;
    rabbitPass?: number;
    evidenceRole?: string;
    images?: NodeImageAsset[];
};

export type NodeDossierInput = {
    id?: string;
    title?: string;
    summary?: string;
    fullText?: string;
    sourceURL?: string;
    origin?: string;
    rabbitTool?: string;
    rabbitPass?: number;
    evidenceRole?: string;
    images?: readonly NodeImageAsset[];
};

export type DossierBodyBlock =
    | {
        kind: 'heading';
        text: string;
        level: number;
    }
    | {
        kind: 'paragraph';
        lines: string[];
    }
    | {
        kind: 'list';
        items: string[];
    }
    | {
        kind: 'table';
        hasHeader: boolean;
        rows: string[][];
    }
    | {
        kind: 'excerpt';
        text: string;
    };

const DOSSIER_INLINE_URL_PATTERN = /(https?:\/\/[^\s,)\]]+|vault:\/\/[^\s,)\]]+|timeline:\/\/[^\s,)\]]+|rabbit:\/\/[^\s,)\]]+)/i;
const DOSSIER_ENTITY_PATTERN = /\[([A-Z]+):([^\]]+)]/i;
const DOSSIER_MARKDOWN_BOLD_PATTERN = /\*\*([^*]+)\*\*/i;
const DOSSIER_HEADING_PATTERN = /^(#{1,4}\s*)?[A-Z0-9][A-Z0-9\s:/&().,'"-]{8,}$/;
const DOSSIER_SEPARATOR_PATTERN = /^[-_*]{3,}$/;
const DOSSIER_BULLET_PATTERN = /^\s*[-*+]\s+/;
const DOSSIER_TABLE_ROW_PATTERN = /^\s*\|.*\|\s*$/;
const DOSSIER_EXCERPT_MARKER_PATTERN = /^(?:\.{3}|…|\[Excerpt begins mid-source]|\[Excerpt continues])$/i;
const DOSSIER_EXCERPT_PREFIX_PATTERN = /^\s*(?:\.{3}|…)\s+(?=\S)/;
const DOSSIER_EXCERPT_SUFFIX_PATTERN = /\s+(?:\.{3}|…)\s*$/;
const DOSSIER_METADATA_LINE_PATTERN = /^(?:Rabbit tool|Query|Rationale|Source|Date|Subject|Based on|Content):/i;
const DOSSIER_KEY_SIGNAL_LIMIT = 5;
const DOSSIER_KEY_SIGNAL_MIN_LENGTH = 32;
const DOSSIER_BOILERPLATE_PATTERNS = [
    /^INTEL_REPORT_FULL$/i,
    /^#?\s*Crawler Result Vault\b/i,
    /^EXECUTIVE SUMMARY REPORT TO:/i,
    /^INTELLIGENCE SUMMARY REPORT TO:/i,
];

export const shouldPreserveExistingFullText = (summary?: string, fullText?: string) =>
    Boolean(summary && fullText && summary !== fullText);

export const normalizeDossierText = (text?: string) =>
    (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

export const getDossierBrief = (summary?: string, fullText?: string) => {
    const source = normalizeDossierText(summary) || normalizeDossierText(fullText);
    if (!source) {
        return 'No dossier text has been captured for this evidence card yet.';
    }

    const firstParagraph = source.split(/\n{2,}/)[0] || source;
    const firstSentences = firstParagraph.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.slice(0, 2).join(' ').trim();
    const brief = firstSentences || firstParagraph;

    if (brief.length <= 420) {
        return brief;
    }

    return `${brief.slice(0, 416).trimEnd()}...`;
};

const cleanDossierInlineMarkdown = (text: string) => text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/gi, '$1 $2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(DOSSIER_EXCERPT_PREFIX_PATTERN, '')
    .replace(DOSSIER_EXCERPT_SUFFIX_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();

const cleanDossierPlainFragment = (text: string) => text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\((https?:\/\/[^)]+)\)/gi, '$1 $2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(DOSSIER_EXCERPT_PREFIX_PATTERN, '')
    .replace(DOSSIER_EXCERPT_SUFFIX_PATTERN, '')
    .replace(/\s+/g, ' ');

const cleanDossierHeadingText = (text: string) => cleanDossierInlineMarkdown(text)
    .replace(/^#{1,6}\s*/, '')
    .replace(DOSSIER_BULLET_PATTERN, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/^[-_*]+\s*/, '')
    .trim();

const getDossierExcerptMarkerText = (line: string) => {
    const trimmed = line.trim();
    if (!DOSSIER_EXCERPT_MARKER_PATTERN.test(trimmed)) {
        return '';
    }
    if (/^\[Excerpt begins mid-source]$/i.test(trimmed)) {
        return 'Excerpt begins mid-source';
    }
    if (/^\[Excerpt continues]$/i.test(trimmed) || /^(?:\.{3}|…)$/i.test(trimmed)) {
        return 'Excerpt continues';
    }
    return '';
};

const hasDossierExcerptPrefix = (line: string) => DOSSIER_EXCERPT_PREFIX_PATTERN.test(line);
const hasDossierExcerptSuffix = (line: string) => DOSSIER_EXCERPT_SUFFIX_PATTERN.test(line);
const stripDossierExcerptAffixes = (line: string) => line
    .replace(DOSSIER_EXCERPT_PREFIX_PATTERN, '')
    .replace(DOSSIER_EXCERPT_SUFFIX_PATTERN, '')
    .trim();

const normalizeDossierTableLine = (line: string) => stripDossierExcerptAffixes(line);

const parseDossierTableRow = (line: string) => line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cleanDossierInlineMarkdown(cell))
    .filter(Boolean);

const isDossierTableSeparatorRow = (cells: string[]) =>
    cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s+/g, '')));

const shouldSkipDossierLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || DOSSIER_SEPARATOR_PATTERN.test(trimmed)) {
        return true;
    }

    if (/^Source:\s*(?:https?:\/\/|vault:\/\/|timeline:\/\/|rabbit:\/\/)/i.test(trimmed)) {
        return true;
    }

    return DOSSIER_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(trimmed));
};

export const getDossierBodyBlocks = (fullText?: string): DossierBodyBlock[] => {
    const normalized = normalizeDossierText(fullText);
    if (!normalized) {
        return [];
    }

    const blocks: DossierBodyBlock[] = [];
    let paragraphLines: string[] = [];
    let listItems: string[] = [];
    let tableRows: string[][] = [];
    let tableHasHeader = false;

    const flushParagraph = () => {
        const lines = paragraphLines
            .map(cleanDossierInlineMarkdown)
            .filter(Boolean);

        if (lines.length > 0) {
            blocks.push({ kind: 'paragraph', lines });
        }

        paragraphLines = [];
    };

    const flushList = () => {
        const items = listItems
            .map(cleanDossierInlineMarkdown)
            .filter(Boolean);

        if (items.length > 0) {
            blocks.push({ kind: 'list', items });
        }

        listItems = [];
    };

    const flushTable = () => {
        if (tableRows.length > 0) {
            blocks.push({ kind: 'table', hasHeader: tableHasHeader, rows: tableRows });
        }

        tableRows = [];
        tableHasHeader = false;
    };

    const addExcerptMarker = (text: string) => {
        flushParagraph();
        flushList();
        flushTable();
        blocks.push({ kind: 'excerpt', text });
    };

    normalized.split('\n').forEach((line) => {
        const trimmed = line.trim();
        const explicitExcerptMarker = getDossierExcerptMarkerText(trimmed);
        if (explicitExcerptMarker) {
            addExcerptMarker(explicitExcerptMarker);
            return;
        }

        const excerptPrefix = hasDossierExcerptPrefix(trimmed);
        const excerptSuffix = hasDossierExcerptSuffix(trimmed);
        const displayLine = stripDossierExcerptAffixes(trimmed);

        if (excerptPrefix) {
            addExcerptMarker('Excerpt begins mid-source');
        }

        if (shouldSkipDossierLine(displayLine)) {
            flushParagraph();
            flushList();
            flushTable();
            return;
        }

        const tableLine = normalizeDossierTableLine(displayLine);
        if (DOSSIER_TABLE_ROW_PATTERN.test(tableLine)) {
            flushParagraph();
            flushList();

            const cells = parseDossierTableRow(tableLine);
            if (isDossierTableSeparatorRow(cells)) {
                if (tableRows.length === 1) {
                    tableHasHeader = true;
                }
            } else if (cells.length > 0) {
                tableRows.push(cells);
            }
            if (excerptSuffix) {
                addExcerptMarker('Excerpt continues');
            }
            return;
        }

        const markdownHeadingMatch = displayLine.match(/^(#{1,6})\s*/);
        const heading = cleanDossierHeadingText(displayLine);
        const isHeading = Boolean(markdownHeadingMatch)
            || (
                !DOSSIER_BULLET_PATTERN.test(displayLine)
                && heading.length <= 110
                && DOSSIER_HEADING_PATTERN.test(heading)
            );

        if (isHeading && heading) {
            flushParagraph();
            flushList();
            flushTable();
            blocks.push({ kind: 'heading', text: heading, level: markdownHeadingMatch ? markdownHeadingMatch[1].length : 2 });
            if (excerptSuffix) {
                addExcerptMarker('Excerpt continues');
            }
            return;
        }

        if (DOSSIER_BULLET_PATTERN.test(displayLine)) {
            flushParagraph();
            flushTable();
            listItems.push(displayLine.replace(DOSSIER_BULLET_PATTERN, ''));
            if (excerptSuffix) {
                addExcerptMarker('Excerpt continues');
            }
            return;
        }

        flushList();
        flushTable();
        paragraphLines.push(displayLine);
        if (excerptSuffix) {
            addExcerptMarker('Excerpt continues');
        }
    });

    flushParagraph();
    flushList();
    flushTable();

    return blocks;
};

const normalizeDossierSignalText = (text: string) => cleanDossierInlineMarkdown(text)
    .replace(/^\d+(?:\.\d+)*[.)]\s+/, '')
    .replace(/^[-:#\s]+/, '')
    .trim();

const formatDossierSignalForBrief = (text: string) => {
    const emphasizedSignal = text.match(/^\*\*([^*]+)\*\*\s*[-:]\s*(.+)$/);
    if (!emphasizedSignal) {
        return text;
    }

    const signalDetail = emphasizedSignal[2]
        .replace(/\bremains unresolved\b/i, 'needs follow-up')
        .replace(/\bcreates a\b/i, 'maps to a')
        .trim();

    return `**${emphasizedSignal[1]}** signal: ${signalDetail}`;
};

const shouldUseDossierSignal = (text: string) => {
    const signal = normalizeDossierSignalText(text);
    if (signal.length < DOSSIER_KEY_SIGNAL_MIN_LENGTH) {
        return false;
    }
    if (DOSSIER_METADATA_LINE_PATTERN.test(signal) || DOSSIER_EXCERPT_MARKER_PATTERN.test(signal)) {
        return false;
    }
    if (DOSSIER_TABLE_ROW_PATTERN.test(signal) || isDossierTableSeparatorRow(parseDossierTableRow(signal))) {
        return false;
    }
    return !DOSSIER_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(signal));
};

export const getDossierKeySignals = (summary?: string, fullText?: string) => {
    const signals: string[] = [];
    const seen = new Set<string>();

    const addSignal = (value: string) => {
        const signal = normalizeDossierSignalText(value);
        const displaySignal = formatDossierSignalForBrief(signal);
        const normalizedKey = displaySignal.toLowerCase();
        if (!signal || !shouldUseDossierSignal(signal) || seen.has(normalizedKey)) {
            return;
        }
        seen.add(normalizedKey);
        signals.push(displaySignal);
    };

    getDossierBodyBlocks(fullText).forEach((block) => {
        if (signals.length >= DOSSIER_KEY_SIGNAL_LIMIT) {
            return;
        }

        if (block.kind === 'list') {
            block.items.forEach(addSignal);
            return;
        }

        if (block.kind === 'paragraph') {
            block.lines
                .flatMap((line) => line.match(/[^.!?]+[.!?]+(?:\s|$)/g) || [line])
                .forEach(addSignal);
        }
    });

    if (signals.length === 0) {
        addSignal(getDossierBrief(summary, fullText));
    }

    return signals.slice(0, DOSSIER_KEY_SIGNAL_LIMIT);
};

export const getDossierContextNote = (dossier: NodeDossier) => {
    if (dossier.rabbitTool === 'vault_search' || dossier.sourceURL?.startsWith('vault://')) {
        return 'Based on a vault source excerpt';
    }
    if (dossier.rabbitTool === 'timeline_context' || dossier.sourceURL?.startsWith('timeline://')) {
        return 'Based on generated timeline context';
    }
    if (dossier.rabbitTool === 'web_search') {
        return 'Based on a live web evidence excerpt';
    }
    if (dossier.origin === 'rabbit-hole') {
        return 'Based on a Rabbit Hole evidence excerpt';
    }
    return '';
};

export const getDossierSourceLinks = (dossier: NodeDossier) => {
    const explicitSources = [
        dossier.sourceURL,
        ...(dossier.images || []).map((image) => image.sourceURL || image.path),
    ];
    const textSources = normalizeDossierText(dossier.fullText).match(new RegExp(DOSSIER_INLINE_URL_PATTERN.source, 'gi')) || [];

    return Array.from(new Set(
        [...explicitSources, ...textSources]
            .flatMap((source) => (source || '').split(','))
            .map((source) => source.trim())
            .filter(Boolean)
    ));
};

const isDossierLink = (text: string) => DOSSIER_INLINE_URL_PATTERN.test(text);
export const isDossierExternalLink = (text: string) => /^https?:\/\//i.test(text);
export const isDossierInternalReference = (text: string) => /^(?:vault|timeline|rabbit):\/\//i.test(text);

const getDossierEntityClassName = (type: string) => {
    switch (type.toUpperCase()) {
        case 'PERSON':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-person';
        case 'ORG':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-org';
        case 'LOC':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-loc';
        case 'DATE':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-date';
        case 'TIME':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-time';
        case 'GPE':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-gpe';
        case 'EVENT':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-event';
        case 'PRODUCT':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-product';
        case 'MONEY':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-money';
        case 'PERCENT':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-percent';
        case 'LAW':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-law';
        default:
            return 'forensic-dossier-entity-chip';
    }
};

export const formatDossierMetaLabel = (value?: string | number) =>
    String(value || '')
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());

export const getDossierMetaChips = (dossier: NodeDossier) => [
    dossier.origin ? formatDossierMetaLabel(dossier.origin) : 'Evidence',
    dossier.rabbitTool ? formatDossierMetaLabel(dossier.rabbitTool) : '',
    dossier.rabbitPass ? `Pass ${dossier.rabbitPass}` : '',
    dossier.evidenceRole ? formatDossierMetaLabel(dossier.evidenceRole) : '',
    dossier.images?.length ? `${dossier.images.length} image${dossier.images.length === 1 ? '' : 's'}` : '',
].filter(Boolean);

export const renderDossierTextWithLinks = (text: string): React.ReactNode => {
    const fragments: React.ReactNode[] = [];
    let lastIndex = 0;
    const richTextPattern = new RegExp(
        `(${DOSSIER_INLINE_URL_PATTERN.source}|${DOSSIER_ENTITY_PATTERN.source}|${DOSSIER_MARKDOWN_BOLD_PATTERN.source})`,
        'gi'
    );

    Array.from(text.matchAll(richTextPattern)).forEach((match, index) => {
        const token = match[0];
        const tokenIndex = match.index ?? 0;

        if (tokenIndex > lastIndex) {
            fragments.push(
                <React.Fragment key={`text-${index}-${lastIndex}`}>
                    {cleanDossierPlainFragment(text.slice(lastIndex, tokenIndex))}
                </React.Fragment>
            );
        }

        if (isDossierLink(token)) {
            if (isDossierInternalReference(token)) {
                fragments.push(
                    <span
                        key={`internal-ref-${index}-${tokenIndex}`}
                        className="forensic-dossier-internal-ref"
                        title="Stored Gorantula reference"
                    >
                        {token}
                    </span>
                );
                lastIndex = tokenIndex + token.length;
                return;
            }

            fragments.push(
                <a
                    key={`link-${index}-${tokenIndex}`}
                    href={token}
                    target="_blank"
                    rel="noreferrer"
                    className="forensic-dossier-inline-link"
                >
                    {token}
                </a>
            );
        } else {
            const entityMatch = token.match(DOSSIER_ENTITY_PATTERN);
            if (entityMatch) {
                fragments.push(
                    <span
                        key={`entity-${index}-${tokenIndex}`}
                        className={getDossierEntityClassName(entityMatch[1])}
                    >
                        {entityMatch[2]}
                    </span>
                );
            } else {
                const boldMatch = token.match(DOSSIER_MARKDOWN_BOLD_PATTERN);
                if (boldMatch) {
                    fragments.push(
                        <strong key={`bold-${index}-${tokenIndex}`} className="forensic-dossier-strong">
                            {renderDossierTextWithLinks(boldMatch[1])}
                        </strong>
                    );
                }
            }
        }

        lastIndex = tokenIndex + token.length;
    });

    if (lastIndex < text.length) {
        fragments.push(
            <React.Fragment key={`text-tail-${lastIndex}`}>
                {cleanDossierPlainFragment(text.slice(lastIndex))}
            </React.Fragment>
        );
    }

    if (fragments.length === 0) {
        return text;
    }

    return fragments;
};

export const renderDossierBodyBlock = (block: DossierBodyBlock, index: number) => {
    if (block.kind === 'heading') {
        return (
            <h3
                key={`${block.kind}-${index}`}
                className={block.level >= 3 ? 'forensic-dossier-body-subheading' : 'forensic-dossier-body-heading'}
            >
                {block.text}
            </h3>
        );
    }

    if (block.kind === 'list') {
        return (
            <ul key={`${block.kind}-${index}`} className="forensic-dossier-body-list">
                {block.items.map((item, itemIndex) => (
                    <li key={`${item}-${itemIndex}`}>
                        {renderDossierTextWithLinks(item)}
                    </li>
                ))}
            </ul>
        );
    }

    if (block.kind === 'table') {
        const headerRow = block.hasHeader ? block.rows[0] : null;
        const bodyRows = block.hasHeader ? block.rows.slice(1) : block.rows;

        return (
            <div key={`${block.kind}-${index}`} className="forensic-dossier-body-table-wrap">
                <table className="forensic-dossier-body-table">
                    {headerRow && (
                        <thead>
                            <tr>
                                {headerRow.map((cell, cellIndex) => (
                                    <th key={`${cell}-${cellIndex}`}>
                                        {renderDossierTextWithLinks(cell)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                    )}
                    <tbody>
                        {bodyRows.map((row, rowIndex) => (
                            <tr key={`${row.join('-')}-${rowIndex}`}>
                                {row.map((cell, cellIndex) => (
                                    <td key={`${cell}-${cellIndex}`}>
                                        {renderDossierTextWithLinks(cell)}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    if (block.kind === 'excerpt') {
        return (
            <div key={`${block.kind}-${index}`} className="forensic-dossier-excerpt-marker">
                {block.text}
            </div>
        );
    }

    return (
        <p key={`${block.kind}-${index}`} className="forensic-dossier-body-paragraph">
            {block.lines.map((line, lineIndex) => (
                <React.Fragment key={`${line}-${lineIndex}`}>
                    {lineIndex > 0 && <br />}
                    {renderDossierTextWithLinks(line)}
                </React.Fragment>
            ))}
        </p>
    );
};
