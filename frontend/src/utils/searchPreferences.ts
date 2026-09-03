export const IMAGE_SCRAPING_PREFERENCE_KEY = 'gorantula_web_search_image_scraping_enabled';
export const DEEP_REASONING_PREFERENCE_KEY = 'gorantula_web_search_deep_reasoning_enabled';

export const readImageScrapingPreference = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.localStorage.getItem(IMAGE_SCRAPING_PREFERENCE_KEY) === 'true';
};

export const readDeepReasoningPreference = () => {
    if (typeof window === 'undefined') {
        return false;
    }

    return window.localStorage.getItem(DEEP_REASONING_PREFERENCE_KEY) === 'true';
};
