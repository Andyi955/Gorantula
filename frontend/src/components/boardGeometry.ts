export const BOARD_GRID_SIZE = 24;
export const NODE_FRAME_GRID_SIZE = BOARD_GRID_SIZE * 2;
export const MIN_NODE_WIDTH = 288;
export const MIN_NODE_HEIGHT = 192;

export const snapCoordinateToGrid = (value: number, gridSize = BOARD_GRID_SIZE) =>
    Math.round(value / gridSize) * gridSize;

export const snapNodeFrameSize = (value: number, minimum: number) =>
    Math.max(minimum, Math.ceil(value / NODE_FRAME_GRID_SIZE) * NODE_FRAME_GRID_SIZE);

export const normalizeNodeFrame = (width: number, height: number) => ({
    width: snapNodeFrameSize(width, MIN_NODE_WIDTH),
    height: snapNodeFrameSize(height, MIN_NODE_HEIGHT),
});

export const calculateNodeFrame = (summary: string, fullText: string, isExpanded: boolean) => {
    const content = isExpanded ? (fullText || summary) : summary;
    const charCount = content.length;

    let width = 320;
    let height = 180;

    const lines = Math.ceil(charCount / 40);
    const estimatedLines = Math.min(lines, isExpanded ? 30 : 8);

    height = Math.max(180, 100 + estimatedLines * 18);

    if (charCount > 300) {
        width = Math.min(500, 320 + Math.min(charCount - 300, 180));
    }

    return normalizeNodeFrame(width, height);
};
