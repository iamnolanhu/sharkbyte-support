/**
 * Chat copy shared by the server (stream error text) and the client (error bubbles).
 * Kept free of server imports so client components can use it.
 */
export const PROVIDERS_DOWN_COPY = "Sammy's fins are tangled — every free model is busy. Try again in a minute.";

/** What visitors see while stored vectors and EMBEDDING_DIMS disagree (details go to the log and PostHog only). */
export const RETUNING_COPY = 'Sammy is being re-tuned — try again soon';
