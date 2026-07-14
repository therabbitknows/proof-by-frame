import React, {useRef, useState, useCallback, useEffect, useMemo} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
  Image,
  ActivityIndicator,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCameraFormat,
} from 'react-native-vision-camera';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {evaluateSingleImageGuard, type CaptureGuardResult} from '../services/captureGuard';
import {
  OUTPUT_JPEG_QUALITY,
  TARGET_PHOTO_RESOLUTION,
  cardCropForSize,
} from '../services/captureProfile';
import {T} from '../constants/tokens';

// Card aspect 2.5 : 3.5 (standard TCG + sports card)
const CARD_RATIO = 2.5 / 3.5;
const WINDOW = Dimensions.get('window');
// Frame fills 82% of viewport width to better match industry standard card
// dimensions in the viewfinder. This provides a clear, large target for the
// user while still allowing for the default 2x zoom to bypass macro-lens
// switching issues on high-res sensors.
const FRAME_W = WINDOW.width * 0.82;
const FRAME_H = FRAME_W / CARD_RATIO;

// Hold-steady countdown in seconds — enforces a stable capture window.
const HOLD_SECONDS = 3;

type CaptureMode = 'front' | 'back';
type CaptureOrigin = 'live_capture' | 'library_upload';

interface Props {
  onCapture: (uri: string, face: CaptureMode, origin?: CaptureOrigin) => void;
  onCancel: () => void;
  captureMode: CaptureMode;
}

export const CameraScreen: React.FC<Props> = ({
  onCapture,
  onCancel,
  captureMode,
}) => {
  const {hasPermission, requestPermission} = useCameraPermission();
  // Pin to the primary wide-angle sensor. Listing telephoto first historically
  // let CameraX switch lenses mid-session and sometimes drop to the ultra-wide
  // / macro module at close distances, which produced soft focus + fisheye
  // distortion on the card corners. With wide-angle-only + default 2x digital
  // zoom below, the primary high-res sensor handles all capture at a safe
  // distance.
  const device = useCameraDevice('back', {
    physicalDevices: ['wide-angle-camera'],
  });

  // Bounded 12 MP is enough for OCR after the card crop and avoids the long
  // capture/encode stalls caused by selecting the sensor's maximum format.
  const format = useCameraFormat(device, [
    {photoResolution: TARGET_PHOTO_RESOLUTION},
  ]);

  const camera = useRef<Camera>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [zoom, setZoom] = useState<number | undefined>();
  const [countdown, setCountdown] = useState<number | null>(null);
  const [guardResult, setGuardResult] = useState<CaptureGuardResult | null>(null);
  const [isGuarding, setIsGuarding] = useState(false);
  // Review gate — after every capture we hold the image here until the user
  // confirms. Prevents the old two-tap slip where a bad front could auto-
  // advance into a back capture with no chance to redo it. `null` means the
  // camera is live; any value pauses the camera preview and shows the
  // RETAKE / LOOKS GOOD review UI.
  const [pendingReview, setPendingReview] = useState<
    {uri: string; origin: CaptureOrigin} | null
  >(null);

  // Resolve the absolute zoom value. We default the CAMERA to neutral (1x)
  // on mount if the state is undefined, which ensures that when the
  // useEffect kicks in, the component sees a transition (1x -> 2x) and
  // actually applies the zoom.
  const absoluteZoom = useMemo(() => {
    if (device) {
      const target = zoom ?? device.neutralZoom;
      return Math.min(Math.max(target, device.minZoom), device.maxZoom);
    }
    return 1;
  }, [device, zoom]);

  // Sync zoom state once device is ready. We use a small delay to ensure
  // the Camera component is fully mounted and receptive to prop changes.
  useEffect(() => {
    if (device && zoom === undefined) {
      const timer = setTimeout(() => {
        setZoom(device.neutralZoom * 2);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [device, zoom]);

  const runGuard = useCallback(async (uri: string) => {
    const startedAt = Date.now();
    setGuardResult(null);
    setIsGuarding(true);
    try {
      const res = await evaluateSingleImageGuard(uri);
      console.log('[PROOF][camera] side guard', res);
      setGuardResult(res);
    } catch (err) {
      console.log('[PROOF][camera] side guard error', err);
    } finally {
      setIsGuarding(false);
      console.log('[PROOF][camera][timing]', {
        stage: 'guard',
        durationMs: Date.now() - startedAt,
      });
    }
  }, []);

  const capture = useCallback(async () => {
    if (!camera.current || isCapturing) return;
    setIsCapturing(true);
    const captureStartedAt = Date.now();
    try {
      // Shutter fires immediately at countdown 0. The lens was already
      // settled by the pre-fire focus lock at T-1s.
      console.log('[PROOF][camera] photo profile', {
        photoQualityBalance: 'balanced',
        enableAutoStabilization: false,
        enableHdr: format?.supportsPhotoHdr ?? false,
      });

      const shutterStartedAt = Date.now();
      const photo = await camera.current.takePhoto({
        enableShutterSound: false,
      });
      const photoCapturedAt = Date.now();
      console.log('[PROOF][camera][timing]', {
        stage: 'takePhoto',
        durationMs: photoCapturedAt - shutterStartedAt,
      });

      // VisionCamera stores photo orientation in EXIF instead of rotating the
      // sensor buffer. Load once so Expo materializes that orientation, then
      // crop and save the same in-memory bitmap. This avoids both raw-sensor
      // dimension guesses and the old intermediate JPEG + quality ladder.
      const manipulated = await (async (): Promise<ImageManipulator.ImageResult> => {
        const context = ImageManipulator.ImageManipulator.manipulate(
          `file://${photo.path}`,
        );
        let oriented: ImageManipulator.ImageRef | null = null;
        let cropped: ImageManipulator.ImageRef | null = null;
        try {
          oriented = await context.renderAsync();
          const crop = cardCropForSize(oriented.width, oriented.height);

          console.log('[PROOF][camera] capture info', {
            sensorW: photo.width,
            sensorH: photo.height,
            orientation: photo.orientation,
            orientedW: oriented.width,
            orientedH: oriented.height,
            cropX: crop.originX,
            cropY: crop.originY,
            cropW: crop.width,
            cropH: crop.height,
          });

          context.crop(crop);
          cropped = await context.renderAsync();
          return await cropped.saveAsync({
            compress: OUTPUT_JPEG_QUALITY,
            format: ImageManipulator.SaveFormat.JPEG,
          });
        } finally {
          oriented?.release();
          cropped?.release();
          context.release();
        }
      })();

      // Stop in the review gate — user must tap LOOKS GOOD to advance.
      setPendingReview({uri: manipulated.uri, origin: 'live_capture'});
      console.log('[PROOF][camera][timing]', {
        stage: 'review_ready',
        durationMs: Date.now() - captureStartedAt,
        outputWidth: manipulated.width,
        outputHeight: manipulated.height,
        jpegQuality: OUTPUT_JPEG_QUALITY,
      });
      void runGuard(manipulated.uri);
    } catch (err: any) {
      console.log('[PROOF][camera] capture failed', err?.message);
      Alert.alert('Capture failed', err?.message || 'Please try again.');
    } finally {
      setIsCapturing(false);
      setCountdown(null);
    }
    // focusAtCenter intentionally omitted from deps: it's declared
    // below this hook (TDZ) and has stable identity (its own deps=[]),
    // so the closure captures the latest binding at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCapturing]);

  // Explicit focus + exposure metering at the frame center. Called once at
  // countdown start so the camera commits to a focus distance/exposure BEFORE
  // the 3-second hold — otherwise CONTROL_AF_MODE_CONTINUOUS_PICTURE keeps
  // hunting and the capture goes off mid-refocus. vision-camera's focus()
  // drives both AF and AE at the point.
  const focusAtCenter = useCallback(async () => {
    if (!camera.current) return;
    try {
      await camera.current.focus({
        x: WINDOW.width / 2,
        y: WINDOW.height / 2,
      });
    } catch {
      // Some devices (especially emulators) don't expose focus() — non-fatal.
    }
  }, []);

  // Tap the shutter → focus + meter at the card center → start 3-second
  // hold-steady countdown → auto-capture.
  const startCountdown = useCallback(() => {
    if (countdown !== null || isCapturing) return;
    void focusAtCenter();
    setCountdown(HOLD_SECONDS);
  }, [countdown, isCapturing, focusAtCenter]);

  // Tap the shutter again during countdown to cancel.
  const cancelCountdown = useCallback(() => {
    setCountdown(null);
  }, []);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      void capture();
      return;
    }
    // Pre-fire focus lock: trigger re-focus at T-1 second so the heavy 50MP
    // lens elements are settled and still by the time the shutter fires at 0.
    if (countdown === 1) {
      void focusAtCenter();
    }
    const timer = setTimeout(() => setCountdown(c => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, capture, focusAtCenter]);

  const pickFromLibrary = useCallback(async () => {
    Alert.alert(
      'Upload from library',
      'Library uploads cannot earn the PROOF seal of possession. Only live capture proves you had the card when it was submitted.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Upload anyway',
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              Alert.alert(
                'Permission required',
                'Grant photo library access to upload.',
              );
              return;
            }
            const res = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 1,
              allowsEditing: false,
            });
            if (res.canceled || !res.assets?.[0]?.uri) return;
            // Route library uploads through the same review gate so users
            // can still swap a mis-picked file before it advances.
            setPendingReview({uri: res.assets[0].uri, origin: 'library_upload'});
          },
        },
      ],
    );
  }, []);

  if (!hasPermission) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>Camera permission required</Text>
        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>GRANT PERMISSION</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.container}>
        <Text style={styles.permissionText}>No camera available</Text>
      </View>
    );
  }

  const countingDown = countdown !== null && countdown > 0;

  return (
    <View style={styles.container}>
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        format={format}
        isActive={pendingReview === null}
        photo={true}
        zoom={absoluteZoom}
        photoQualityBalance="balanced"
        outputOrientation="preview"
      />

      {/* Card alignment overlay */}
      <View style={styles.overlay}>
        <View style={styles.dimTop} />
        <View style={styles.middleRow}>
          <View style={styles.dimSide} />
          <View style={styles.cardWindow}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
            {/* Countdown inside the frame while active */}
            {countingDown && (
              <View pointerEvents="none" style={styles.countdownWrap}>
                <Text style={styles.countdownLabel}>HOLD STEADY</Text>
                <Text style={styles.countdownNumber}>{countdown}</Text>
              </View>
            )}
          </View>
          <View style={styles.dimSide} />
        </View>
        <View style={styles.dimBottom} />
      </View>

      {/* Header — two rows: (1) cancel + step index, (2) prominent face label.
          Previous header collapsed the face label into a small center-top
          string that users missed, making it easy to mistake a back-capture
          for a second front-capture. This layout makes the current face
          unambiguous at a glance and shows progress through the flow. */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onCancel}
          style={styles.cancelBtn}
          hitSlop={{top: 16, bottom: 16, left: 16, right: 16}}
          accessibilityRole="button"
          accessibilityLabel="Cancel capture"
          activeOpacity={0.6}>
          <Text style={styles.cancelText}>CANCEL</Text>
        </TouchableOpacity>
        <View style={styles.stepIndicator}>
          <View
            style={[
              styles.stepDot,
              captureMode === 'front' && styles.stepDotActive,
            ]}
          />
          <View style={styles.stepConnector} />
          <View
            style={[
              styles.stepDot,
              captureMode === 'back' && styles.stepDotActive,
            ]}
          />
        </View>
        <View style={styles.headerRight} />
      </View>

      {/* Giant face label directly under the step dots. High-contrast gold
          on a dim bar so it reads even when the camera preview is busy. */}
      <View style={styles.faceBanner}>
        <Text style={styles.faceBannerStep}>
          STEP {captureMode === 'front' ? '1' : '2'} OF 2
        </Text>
        <Text style={styles.faceBannerLabel}>
          {captureMode === 'front' ? 'CARD FRONT' : 'CARD BACK'}
        </Text>
        <Text style={styles.faceBannerHint}>
          {captureMode === 'front'
            ? 'Capture the front of the card'
            : 'Now flip and capture the back'}
        </Text>
      </View>

      {/* Zoom */}
      <View style={styles.zoomRow}>
        {([1, 2, 3] as const).map(mul => {
          // High-level UI sync: if zoom state hasn't landed yet, we default
          // the highlight to 2x to match the app's intended framing.
          // Once zoom is set, we compare against absoluteZoom.
          const isSelected = device
            ? (zoom === undefined ? mul === 2 : Math.abs(absoluteZoom - device.neutralZoom * mul) < 0.05)
            : mul === 2;
          return (
            <TouchableOpacity
              key={mul}
              style={[styles.zoomBtn, isSelected && styles.zoomBtnActive]}
              onPress={() => device && setZoom(device.neutralZoom * mul)}>
              <Text
                style={[
                  styles.zoomText,
                  isSelected && styles.zoomTextActive,
                ]}>
                {mul}x
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Hint above capture */}
      <Text style={styles.hint}>
        {countingDown
          ? 'Keep the card centered · auto-capture on 0'
          : 'Center card in frame · tap shutter to start 3-second hold'}
      </Text>

      {/* Capture row: library picker · shutter · spacer */}
      <View style={styles.captureRow}>
        <TouchableOpacity
          style={styles.sideBtn}
          onPress={pickFromLibrary}
          disabled={isCapturing || countingDown}>
          <Text style={styles.sideBtnText}>UPLOAD</Text>
          <Text style={styles.sideBtnSubtext}>from library</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.captureBtn,
            (isCapturing || countingDown) && styles.captureBtnActive,
          ]}
          onPress={countingDown ? cancelCountdown : startCountdown}
          disabled={isCapturing}>
          <View
            style={[
              styles.captureBtnInner,
              countingDown && styles.captureBtnInnerCounting,
            ]}
          />
        </TouchableOpacity>

        <View style={styles.sideBtn} />
      </View>

      <Text style={styles.disclaimerLine}>
        Live capture earns the PROOF seal. Library uploads cannot.
      </Text>

      {/* Review overlay — rendered on top of the camera when a capture is
          pending user confirmation. RETAKE resumes the live camera; LOOKS
          GOOD commits the photo and lets the wrapper advance the flow
          (front → back, or back → condition screen). */}
      {pendingReview && (
        <View style={styles.reviewOverlay}>
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewStep}>
              STEP {captureMode === 'front' ? '1' : '2'} OF 2 · REVIEW
            </Text>
            <Text style={styles.reviewFace}>
              {captureMode === 'front' ? 'CARD FRONT' : 'CARD BACK'}
            </Text>
            <Text style={styles.reviewSubtitle}>
              Check focus, framing, and glare. If anything looks off, retake.
            </Text>
          </View>

          <View style={styles.reviewImageWrap}>
            <Image
              source={{uri: pendingReview.uri}}
              style={styles.reviewImage}
              resizeMode="contain"
            />
          </View>

          <View style={styles.reviewActionRow}>
            <TouchableOpacity
              style={styles.retakeBtn}
              onPress={() => setPendingReview(null)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Retake photo">
              <Text style={styles.retakeBtnText}>RETAKE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.looksGoodBtn}
              disabled={isCapturing}
              onPress={() => {
                if (isGuarding) {
                  // User tapped confirm but guard is still running.
                  return;
                }
                if (guardResult && !guardResult.approved) {
                  Alert.alert(
                    'Retake recommended',
                    'The image appears blurry or low quality. Capture again for best grading results.',
                    [
                      {text: 'Retake', onPress: () => setPendingReview(null)},
                      {
                        text: 'Use anyway',
                        onPress: () => {
                          const captured = pendingReview;
                          setPendingReview(null);
                          onCapture(captured!.uri, captureMode, captured!.origin);
                        },
                      },
                    ],
                  );
                  return;
                }
                const captured = pendingReview;
                setPendingReview(null);
                onCapture(captured!.uri, captureMode, captured!.origin);
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={
                captureMode === 'front'
                  ? 'Use this, continue to back'
                  : 'Use this, continue to condition'
              }>
              <Text style={styles.looksGoodBtnText}>
                {isGuarding
                  ? 'SCANNING...'
                  : captureMode === 'front'
                  ? 'USE THIS · NEXT: BACK'
                  : 'USE THIS · CONTINUE'}
              </Text>
            </TouchableOpacity>
          </View>
          {/* Scanning Overlay — appears if confirm tapped while guard is pending */}
          {isGuarding && (
            <View style={styles.scanningOverlay}>
              <ActivityIndicator color={T.gold} size="large" />
              <Text style={styles.scanningText}>SCANNING QUALITY...</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  dimTop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.72)'},
  middleRow: {flexDirection: 'row', height: FRAME_H},
  dimSide: {flex: 1, backgroundColor: 'rgba(0,0,0,0.72)'},
  dimBottom: {
    flex: 1.4, // Shift window up slightly to clear zoom buttons
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  cardWindow: {
    width: FRAME_W,
    height: FRAME_H,
    borderWidth: 2, // 2px rim per SlabFrame pattern
    borderColor: T.gold,
    borderRadius: 16,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)', // Dark inner per SlabFrame pattern
  },
  corner: {position: 'absolute', width: 28, height: 28, borderColor: T.gold},
  cornerTL: {
    top: -2,
    left: -2,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 16,
  },
  cornerTR: {
    top: -2,
    right: -2,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 16,
  },
  cornerBL: {
    bottom: -2,
    left: -2,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 16,
  },
  cornerBR: {
    bottom: -2,
    right: -2,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 16,
  },
  countdownWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdownLabel: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 12,
    letterSpacing: 3,
    marginBottom: 12,
    fontWeight: '700',
  },
  countdownNumber: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 96,
    fontWeight: '900',
  },
  header: {
    position: 'absolute',
    top: 56,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 2,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    minHeight: 44,
    minWidth: 88,
    justifyContent: 'center',
  },
  cancelText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 2,
    fontWeight: '700',
  },
  stepIndicator: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  stepDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: T.gold,
    backgroundColor: 'transparent',
  },
  stepDotActive: {
    backgroundColor: T.gold,
  },
  stepConnector: {
    width: 28,
    height: 2,
    backgroundColor: T.gold,
    opacity: 0.45,
  },
  headerRight: {flex: 1},
  faceBanner: {
    position: 'absolute',
    top: 110,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    zIndex: 2,
  },
  faceBannerStep: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '700',
    marginBottom: 4,
  },
  faceBannerLabel: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 22,
    letterSpacing: 4,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 4,
  },
  faceBannerHint: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 6,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: {width: 0, height: 1},
    textShadowRadius: 3,
  },
  zoomRow: {
    position: 'absolute',
    bottom: 200,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    zIndex: 2,
  },
  zoomBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  zoomBtnActive: {
    borderColor: T.gold,
    backgroundColor: 'rgba(232,196,74,0.15)',
  },
  zoomText: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  zoomTextActive: {color: T.gold},
  hint: {
    position: 'absolute',
    bottom: 168,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1,
    zIndex: 2,
  },
  captureRow: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    zIndex: 2,
  },
  sideBtn: {
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  sideBtnText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
  sideBtnSubtext: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 8,
    letterSpacing: 1,
    marginTop: 2,
  },
  captureBtn: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 3,
    borderColor: T.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnActive: {
    borderColor: T.red,
  },
  captureBtnInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: T.gold,
  },
  captureBtnInnerCounting: {
    backgroundColor: T.red,
    width: 28,
    height: 28,
    borderRadius: 4,
  },
  disclaimerLine: {
    position: 'absolute',
    bottom: 28,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: T.textDisabled,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1,
    zIndex: 2,
  },
  permissionText: {
    color: T.textSecondary,
    textAlign: 'center',
    marginTop: 100,
    fontFamily: 'monospace',
  },
  permissionBtn: {
    margin: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: T.gold,
    borderRadius: 8,
    alignItems: 'center',
  },
  permissionBtnText: {
    color: T.gold,
    fontFamily: 'monospace',
    letterSpacing: 2,
    fontSize: 12,
  },
  // Review overlay — covers the entire camera UI while a capture is
  // pending confirmation. Full opaque background (not tint) so the live
  // camera preview can't bleed through and confuse the user.
  reviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: T.bgApp,
    zIndex: 10,
    paddingTop: 56,
    paddingBottom: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewHeader: {
    alignItems: 'center',
    paddingTop: 6,
  },
  reviewStep: {
    color: T.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 3,
    fontWeight: '700',
    marginBottom: 6,
  },
  reviewFace: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 22,
    letterSpacing: 4,
    fontWeight: '900',
  },
  reviewSubtitle: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1,
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 320,
  },
  reviewImageWrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  reviewImage: {
    width: '100%',
    aspectRatio: CARD_RATIO,
    borderRadius: 12,
    borderWidth: 2, // 2px gold rim
    borderColor: T.gold,
    backgroundColor: 'rgba(0,0,0,0.12)', // Dark inner
  },
  reviewActionRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 4,
  },
  scanningOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  scanningText: {
    color: T.gold,
    fontFamily: 'monospace',
    fontSize: 14,
    letterSpacing: 4,
    fontWeight: '700',
  },
  retakeBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retakeBtnText: {
    color: T.textSecondary,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
  looksGoodBtn: {
    flex: 2,
    paddingVertical: 16,
    borderRadius: 10,
    backgroundColor: T.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  looksGoodBtnText: {
    color: T.bgApp,
    fontFamily: 'monospace',
    fontSize: 13,
    letterSpacing: 3,
    fontWeight: '700',
  },
});
