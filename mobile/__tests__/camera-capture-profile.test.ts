import {
  JPEG_QUALITY_LADDER,
  TARGET_PHOTO_RESOLUTION,
  cardCropForSize,
  rotationForOrientation,
} from '../src/services/captureProfile';

describe('Seeker capture profile', () => {
  it('targets a bounded 12 MP source', () => {
    expect(TARGET_PHOTO_RESOLUTION.width * TARGET_PHOTO_RESOLUTION.height).toBe(
      12_192_768,
    );
  });

  it('retries JPEG quality in strictly descending order', () => {
    expect(JPEG_QUALITY_LADDER).toEqual([0.92, 0.9, 0.85, 0.82]);
    for (let index = 1; index < JPEG_QUALITY_LADDER.length; index += 1) {
      expect(JPEG_QUALITY_LADDER[index]).toBeLessThan(
        JPEG_QUALITY_LADDER[index - 1],
      );
    }
  });

  it('maps VisionCamera orientation values to clockwise rotation', () => {
    expect(rotationForOrientation('portrait')).toBe(0);
    expect(rotationForOrientation('landscape-right')).toBe(90);
    expect(rotationForOrientation('portrait-upside-down')).toBe(180);
    expect(rotationForOrientation('landscape-left')).toBe(270);
  });

  it('produces a centered standard-card crop inside the normalized bitmap', () => {
    const crop = cardCropForSize(3024, 4032);
    expect(crop.originX).toBeGreaterThanOrEqual(0);
    expect(crop.originY).toBeGreaterThanOrEqual(0);
    expect(crop.originX + crop.width).toBeLessThanOrEqual(3024);
    expect(crop.originY + crop.height).toBeLessThanOrEqual(4032);
    expect(crop.width / crop.height).toBeCloseTo(2.5 / 3.5, 2);
  });
});
