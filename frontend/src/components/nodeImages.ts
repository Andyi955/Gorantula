export interface NodeImageAsset {
    id: string;
    path: string;
    sourceURL?: string;
    caption?: string;
    origin?: 'manual' | 'scraped';
    mimeType?: string;
    width?: number;
    height?: number;
}

export const nodeHasImages = (images: NodeImageAsset[] | undefined | null) =>
    Array.isArray(images) && images.length > 0;
