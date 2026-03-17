export type RelationshipPattern =
    | 'solid'
    | 'dashed'
    | 'dotted'
    | 'long-dash'
    | 'sparse-dash'
    | 'dash-dot';

export interface TagStyle {
    color: string;
    pattern: RelationshipPattern;
}

export interface RelationshipEdgeVisuals {
    animated: boolean;
    strokeDasharray?: string;
    strokeLinecap?: 'butt' | 'round' | 'square';
    strokeWidth?: number;
}

export const SUPPORTED_RELATIONSHIP_PATTERNS: RelationshipPattern[] = [
    'solid',
    'dashed',
    'dotted',
    'long-dash',
    'sparse-dash',
    'dash-dot',
];

const DEFAULT_TAG_COLOR = '#bc13fe';

// Legacy saved boards can contain partial or stale style data, so normalize each entry before use.
export const sanitizeTagStyles = (rawValue: unknown): Record<string, TagStyle> => {
    if (!rawValue || typeof rawValue !== 'object') {
        return {};
    }

    return Object.entries(rawValue as Record<string, unknown>).reduce<Record<string, TagStyle>>((acc, [tag, value]) => {
        if (!value || typeof value !== 'object') {
            return acc;
        }

        const candidate = value as Partial<TagStyle>;
        acc[tag] = {
            color: typeof candidate.color === 'string' && candidate.color.trim() ? candidate.color : DEFAULT_TAG_COLOR,
            pattern: normalizeRelationshipPattern(candidate.pattern),
        };
        return acc;
    }, {});
};

export const normalizeRelationshipPattern = (pattern: unknown): RelationshipPattern =>
    SUPPORTED_RELATIONSHIP_PATTERNS.includes(pattern as RelationshipPattern)
        ? pattern as RelationshipPattern
        : 'solid';

export const createTagStyle = (tag: string): TagStyle => {
    let hash = 0;
    for (let i = 0; i < tag.length; i += 1) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }

    const r = (Math.abs(hash) % 156) + 100;
    const g = (Math.abs(hash * 3) % 156) + 100;
    const b = (Math.abs(hash * 7) % 156) + 100;

    return {
        color: `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`,
        pattern: SUPPORTED_RELATIONSHIP_PATTERNS[Math.abs(hash) % SUPPORTED_RELATIONSHIP_PATTERNS.length],
    };
};

export const getRelationshipEdgeVisuals = (pattern: RelationshipPattern): RelationshipEdgeVisuals => {
    switch (pattern) {
        case 'dashed':
            return { animated: true, strokeDasharray: '6 4' };
        case 'dotted':
            return { animated: true, strokeDasharray: '1 7', strokeLinecap: 'round' };
        case 'long-dash':
            return { animated: true, strokeDasharray: '14 7' };
        case 'sparse-dash':
            return { animated: true, strokeDasharray: '4 9' };
        case 'dash-dot':
            return { animated: true, strokeDasharray: '10 4 2 4', strokeLinecap: 'round' };
        case 'solid':
        default:
            return { animated: false };
    }
};
