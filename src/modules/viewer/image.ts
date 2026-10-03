import { exceedsImageDimensionLimits, readImageDimensions, type ImageDimensions } from "@/platform/files/image-metadata";

export const maximumImagePixels = 50_000_000;
export const maximumImageDimension = 32_768;

const viewerImageDimensionLimits = Object.freeze({
  maximumDimension: maximumImageDimension,
  maximumPixels: maximumImagePixels,
});

export { readImageDimensions };
export type { ImageDimensions };

export function exceedsSafeImageDimensions(dimensions: ImageDimensions) {
  return exceedsImageDimensionLimits(dimensions, viewerImageDimensionLimits);
}
