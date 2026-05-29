import type { Node } from 'reactflow';

const MINIMAP_NODE_COLORS = {
    default: '#00f3ff',
    portal: '#d946ef',
    deepDive: '#10b981',
    imported: '#f59e0b',
    rabbitSupport: '#ff5b78',
} as const;

export const getMiniMapNodeColor = (node: Node) => {
    if (node.data?.origin === 'rabbit-hole' && node.data?.evidenceRole === 'supporting') {
        return MINIMAP_NODE_COLORS.rabbitSupport;
    }

    if (node.data?.portalKind === 'merged-child') {
        return MINIMAP_NODE_COLORS.portal;
    }

    if (node.data?.isDeepDiveSource) {
        return MINIMAP_NODE_COLORS.deepDive;
    }

    if (typeof node.data?.title === 'string' && (node.data.title.includes('[IMPORTED]') || node.id.startsWith('imported-'))) {
        return MINIMAP_NODE_COLORS.imported;
    }

    return MINIMAP_NODE_COLORS.default;
};
