/**
 * MWA AppIdentity icon — embedded data URI of the canonical PROOF logo.
 *
 * Per the Mobile Wallet Adapter spec (github.com/solana-mobile/
 * mobile-wallet-adapter/blob/main/spec/spec.md), AppIdentity.icon must
 * be either a data URI or a relative path served from the same host as
 * AppIdentity.uri. Cross-host absolute URLs are non-conformant and were
 * silently rejected by Phantom 26.6.0 during the authorize handshake
 * (regression at 068ebab, recovered 2026-05-04). proofbyframe.com is
 * a Wix-hosted brand site that does not serve the icon at a stable
 * relative path, so a data URI is the right fix here — it travels with
 * the build, has no runtime fetch, and is brand-locked at compile time.
 *
 * Source asset: frame-brain/static/proof-icon.png (1225 B). Encoded
 * length: ~1.6 KB base64. To swap branding, replace the PNG, run
 * `base64 -i frame-brain/static/proof-icon.png` and replace the
 * literal below.
 */
export const APP_ICON_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAMAAABlApw1AAABMlBMVEUODg52ZSpzYirIEC5kViU4MRo5MhroxEq/oz+YgTOchTQxKxeXgDMyLRczLBg1LhgfHBIgHRLQsEO3nDzGDy2rkTlLQB43MBlJDhjCoz4XFRDkwUgpJBUvKhcyLBcUDg8mDhGiijWhiTa6njx5Zyp6aSq2nDtvXyhuXyh6aCt7aSuqkDi3DyrHqUAXDg8WDg9kDhwoJBUcGRKOeTAdGhK7nz0nDhFgDhx0YylHDhdlDx13ZSo2LxlLDhh4Ziu4DyqJdC9RRiC3DytTRyElIRQkIBTFDy1jDhwYDhBmDh2iDycdGxJxYSlyYSkeGxKgDyaNeTChDyccGhEVDg8TDQ6KdS9PRB+IdC+1DipSRiBQRSDIqUFUSCFfDhsnIxWNeDCMdzCkDyejDye8nz2PeTEmDhJCvhnQAAAACXBIWXMAAAsTAAALEwEAmpwYAAADPUlEQVR4nO2dZ1PbQBRFn7LeXDkxgbhhTDO99xoCAUKoKZSQ3tv//wuZVLCQZ2SvrfUm93xDlux3pLu7M571Q4QQQgghhBBCCCGEEEIIaUaK7det0F6sS/k7HZ2wRGfHK/P6n8EqW6b1b9utH3hrKNABYMK7Viv9QH/NF3s5AFNm9Rc7gZzB9QkgYXD5BIAHBteLrAO4Z0/gLoB2g+tFNADPnoAHQBtcTwHhEwAjBA5i4SxkANcBcCHTJglihBJNGqGzmxEZBAajnrsYm8CTBT8qaSAd+eSFhzEJfPUbI+CfxCOw6PtLNyIyAAxEPXfJ9xdjEejx/VQjBnHK93tiEWhpnEBL4BAFhE8AjJAWExghMEKaEfICt4ALWQVSXIlD4DQKTqNa4onQ3K0wxoCx0Bfmmm0QP06GkgEy4a88ai6BrmS1AsmuphJoTSa7b4cwAoyEHe9OJlubTaCtmlmojQIR4RMAI6SjpoURkhAYITBC+L8Xsnwul3daoBLOCPQuL/e6K3Bw+FkplT1am3ZTYGNT/Way4KLAfvZP/UplV9wT2LhUv1LZgmsC05OX61dq88AxgcPy+pWadUzgU1Dg1J5AX6KcoXR6OHAoMZ7JjF78lZenZSPg5yjolfzFGaOZzHjwPYbT6aHAob66CFRPTpaD9StVkh97uatHWxEoXRX4Zk2gz/UIebUM4qOgwLFjs9Ca69PozP3y+ienHROQQtko2LsjrgnIyiWDvXfinoAU/qboZeD+OyIgM7OnWaWyx/sz4qaAiJyXSudhx50RqIQzAnnXv1ZJuP7FVoIC4BMAIxQCB3FUOAuB64COK0Jub/bocn27jbi+4Umq3XL2/uo7pLhvNATuGwX3jWoxgRECI6QZIS9wC/gLjgqkuBKHwGkUnEa1mPBPRqjH9Z+knzWoKcAX35+PRUAWGtWW4UNcjTFOGiPwMa7GGCLzjWhNMn/1c9hnTtjhCc3ZnicyFACfABghqR2PEdKMEBgh+a8jtO562+ai3cbZOePG2b9al6/aaV2+WofW5fIcltkxFJAtu/W/MK1fZPuNvfKnXpvXLyK72s6/sNC7dSmfEEIIIYQQQgghhBBCCJE68x2Ix8YeaJCOOQAAAABJRU5ErkJggg==';
