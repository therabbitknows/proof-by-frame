import {
  OUTPUT_JPEG_QUALITY,
  TARGET_PHOTO_RESOLUTION,
  cardCropForSize,
} from '../src/services/captureProfile';

describe('Seeker capture profile', () => {
  it('targets a bounded 12 MP source', () => {
    expect(TARGET_PHOTO_RESOLUTION.width * TARGET_PHOTO_RESOLUTION.height).toBe(
      12_192_768,
    );
  });

  it('uses one quality setting instead of an encode-and-probe ladder', () => {
    expect(OUTPUT_JPEG_QUALITY).toBe(0.9);
  });

  it('produces a centered standard-card crop inside an oriented bitmap', () => {
    const crop = cardCropForSize(3024, 4032);
    expect(crop.originX).toBeGreaterThanOrEqual(0);
    expect(crop.originY).toBeGreaterThanOrEqual(0);
    expect(crop.originX + crop.width).toBeLessThanOrEqual(3024);
    expect(crop.originY + crop.height).toBeLessThanOrEqual(4032);
    expect(crop.width / crop.height).toBeCloseTo(2.5 / 3.5, 2);
  });

  it('keeps a landscape bitmap crop inside its own bounds', () => {
    const crop = cardCropForSize(4032, 3024);
    expect(crop.originX + crop.width).toBeLessThanOrEqual(4032);
    expect(crop.originY + crop.height).toBeLessThanOrEqual(3024);
    expect(crop.width / crop.height).toBeCloseTo(2.5 / 3.5, 2);
  });
});
