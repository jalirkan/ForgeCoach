/*
 * ForgeCoach — ui/review/samples.ts
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Sample logs that ship with an engine review report (public/samples/), so the
 * review screen can be shown without the engine. Kept tiny: the start page
 * imports it eagerly.
 */
export const SAMPLE_REVIEWS: Record<string, string> = {
  'human-auto-42': 'samples/human-auto-42.review.json',
};

export const hasSampleReview = (id: string | null | undefined): boolean => !!id && id in SAMPLE_REVIEWS;
