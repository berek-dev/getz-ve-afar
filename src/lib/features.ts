import { createContext, useContext } from 'react';
import type { Features } from './api.ts';

/** Optional server features (photo storage, AI drafts), reported by /api/me. */
export const FeaturesContext = createContext<Features>({ photos: false, ai: false });
export const useFeatures = () => useContext(FeaturesContext);
