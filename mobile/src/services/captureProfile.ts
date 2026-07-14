// A 12 MP source leaves ample OCR detail after the card-frame crop without
// forcing the Seeker to capture and repeatedly encode its maximum sensor size.
export const TARGET_PHOTO_RESOLUTION = {width: 4032, height: 3024} as const;
export const OUTPUT_JPEG_QUALITY = 0.9;

const CARD_RATIO = 2.5 / 3.5;
const CROP_WIDTH_FRAC = 0.72;

export function cardCropForSize(width: number, height: number) {
  let cropW = Math.ceil(width * CROP_WIDTH_FRAC);
  let cropH = Math.ceil(cropW / CARD_RATIO);
  if (cropH > height * 0.98) {
    cropH = Math.floor(height * 0.98);
    cropW = Math.ceil(cropH * CARD_RATIO);
  }
  cropW = Math.min(cropW, width);
  cropH = Math.min(cropH, height);

  const cropX = Math.max(
    0,
    Math.min(Math.floor((width - cropW) / 2), width - cropW),
  );
  const cropY = Math.max(
    0,
    Math.min(Math.floor((height - cropH) / 2), height - cropH),
  );

  return {originX: cropX, originY: cropY, width: cropW, height: cropH};
}
