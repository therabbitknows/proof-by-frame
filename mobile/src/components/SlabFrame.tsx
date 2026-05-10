// SlabFrame.tsx
// The canonical "final proof = slab" visual treatment.
//
// Ported from proof-dapp-alpha/src/components/ui/SlabFrame.tsx — the
// historical pattern was to wrap the entire StatusScreen / Result flow
// in a SlabFrame so every submission view reads as if it's already
// presented inside a graded card slab. Gold 2px rim + inner background
// matching the app bg; rounded 30/28 corners evoke the rounded plastic
// of a PSA/BGS/CGC holder.
//
// Apply at the outermost level of ResultScreen (or any "final proof"
// surface) so the entire pager — header, pages, footer — sits inside
// the slab. Do NOT nest SlabFrames; one outer wrapper per surface.

import React from 'react';
import {View, StyleSheet} from 'react-native';
import {T} from '../constants/tokens';

interface SlabFrameProps {
  children: React.ReactNode;
}

export const SlabFrame: React.FC<SlabFrameProps> = ({children}) => (
  <View style={styles.outer}>
    <View style={styles.shell}>
      <View style={styles.inner}>{children}</View>
    </View>
  </View>
);

export default SlabFrame;

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    padding: 8,
    backgroundColor: T.bgApp,
  },
  shell: {
    flex: 1,
    backgroundColor: T.gold,
    borderRadius: 30,
    padding: 2,
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
    backgroundColor: T.bgApp,
    borderRadius: 28,
    overflow: 'hidden',
  },
});
