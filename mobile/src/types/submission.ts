/**
 * PROOF Submission data models.
 *
 * Ported from the alpha reference
 * (proof-dapp-hackathon @ origin/reference/alpha-sanitized-clean,
 *  src/types/submission.ts).
 *
 * Type-only: runtime factories from the alpha file
 * (createEmptyNotes, generateSubmissionId, createEmptySubmission)
 * are intentionally excluded. They belong with state / storage
 * and will be introduced alongside those transplants.
 */

export type SubmissionState =
  | 'created'
  | 'description_added'
  | 'front_added'
  | 'back_added'
  | 'notes_added'
  | 'baselines_added'
  | 'pregrade_generated'
  | 'community_voting'
  | 'sealed'
  | 'proof_pending'
  | 'proof_received'
  | 'proof_result_received';

export interface Notes {
  corners: string;
  edges: string;
  surface: string;
  centering: string;
  other: string;
}

export interface Baseline {
  company: string;
  label: string;
  certNumber?: string;
}

export type CardSizeMode = 'sports' | 'tcg';

export type OverlayMode = 'simple' | 'grading';

export type CaptureMode = 'auto' | 'manual';

export type CaptureSource = 'in_app_camera' | 'image_library';

export type CaptureOrigin = 'live_capture' | 'library_upload';

export interface CaptureLayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureMetadata {
  capture_source: CaptureSource;
  capture_origin?: CaptureOrigin;
  capture_mode?: CaptureMode;
  overlay_mode?: OverlayMode;
  card_size_mode?: CardSizeMode;
  blur_score?: number;
  glare_score?: number;
  stability_score?: number;
  card_detected: boolean;
  readiness_hint?: string;
  image_width?: number;
  image_height?: number;
  aspect_ratio_delta?: number;
  frame_layout?: CaptureLayoutBounds;
  preview_layout?: CaptureLayoutBounds;
}

export interface Submission {
  id: string;
  description: string;
  /** Canonical card identity, preferably populated from OCR (backend
   *  `card_name` on the submission-status / upload-front response). Shown by
   *  the Vault + Submission screens as the human-readable label. */
  cardName?: string;
  cardType: string;
  frontImageUri: string;
  backImageUri: string;
  frontCaptureMetadata?: CaptureMetadata;
  backCaptureMetadata?: CaptureMetadata;
  notes: Notes;
  baselines: Baseline[];
  currentState: SubmissionState;
  status: 'draft' | 'submitted';
  createdAt: number;
  submittedAt?: string;
}
