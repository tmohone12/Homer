import {z} from 'zod';
export const contextModeSchema=z.enum(['pinned','partial','searchable']);
