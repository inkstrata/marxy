// The startup and document-open code's name for the scheduler's yield (apps/desktop/src/scheduler/index.ts owns it).
import { yieldToMain } from '../scheduler/index.ts';

export const yieldToEventLoop = (): Promise<void> => yieldToMain('input');
