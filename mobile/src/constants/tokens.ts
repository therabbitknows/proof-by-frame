/**
 * PROOF by FRAME — Brand tokens (locked).
 * Gold + red only. Never purple (except Phantom wallet surfaces).
 * Dark text on gold — NEVER white on gold.
 *
 * This file is canonical. Any new color must be added here, not inline.
 * Matches the design-system doc dated 2026-04-19.
 */

export const T = {
  // Brand primaries
  gold:             '#E8C44A',  // primary — logo, CTAs, active states, gold frame
  red:              '#C8102E',  // accent — logo dot, destructive actions, Pristine grade
  amber:            '#E8A000',  // warning/pending ONLY — never decorative

  // Backgrounds
  bgApp:            '#0E0E0E',  // root app background
  bgSurface:        '#141414',  // cards, panels, modals
  bgInput:          '#161616',  // input fields, locked button backgrounds
  bgOverlay:        'rgba(0,0,0,0.72)',  // modal/bottom-sheet scrims

  // Borders
  border:           '#1F1F1F',  // default card and container borders
  borderStrong:     '#2A2A2A',  // emphasis borders, active input rings
  borderGold:       'rgba(232,196,74,0.25)',  // gold tint — inner frame, subtle
  borderGoldStrong: 'rgba(232,196,74,0.55)',  // gold tint — outer frame, emphasis

  // Text — four stops only
  textPrimary:      '#E0E0E0',  // headings, titles, primary content
  textSecondary:    '#8A8A8A',  // body copy, descriptions, labels
  textMuted:        '#666666',  // section labels, captions, sub-wordmarks
  textDisabled:     '#555555',  // locked CTAs, inactive nav, footer

  // Grade dots
  gradeRing:        '#484848',  // centering-mark rings in grade preview only
  gradeGold:        '#E8C44A',  // PSA 10, BGS 9.5 — Gem Mint
  gradeWhite:       '#F5F5F5',  // CGC 10 — Gem Mint
  gradeRed:         '#C8102E',  // TAG 10 — Pristine
  gradeGreen:       '#2A7A3B',  // Verified on public ledger / sealed

  // Status
  statusPending:    '#E8A000',  // alias for amber, semantic "pending"
  statusSuccess:    '#2A7A3B',  // alias for gradeGreen, semantic "success"
  statusError:      '#C8102E',  // alias for red, semantic "error"
};
