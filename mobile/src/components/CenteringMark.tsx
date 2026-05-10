import React from 'react';
import Svg, {Rect, Line, Circle} from 'react-native-svg';
import {T} from '../constants/tokens';

interface Props {
  size?: number;
  primaryColor?: string;
  dotColor?: string;
}

export const CenteringMark: React.FC<Props> = ({
  size = 32,
  primaryColor = T.gold,
  dotColor = T.red,
}) => {
  const s = size;
  const c = s / 2;
  const sw = s * 0.052;
  const gap = s * 0.1;
  const outerW = s * 0.88;
  const outerH = s * 0.88;
  const crossInset = s * 0.06;
  const dotR = s * 0.076;
  const innerGap = dotR + s * 0.045;
  const rings = 3;

  return (
    <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      {Array.from({length: rings}).map((_, i) => {
        const inset = sw / 2 + i * (sw + gap);
        const w = outerW - inset * 2;
        const h = outerH - inset * 2;
        const x = (s - w) / 2;
        const y = (s - h) / 2;
        return (
          <Rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={Math.max(s * 0.04 - i * s * 0.012, 0)}
            stroke={primaryColor}
            strokeWidth={sw}
            fill="none"
            opacity={1 - i * 0.2}
          />
        );
      })}
      <Line
        x1={crossInset}
        y1={c}
        x2={c - innerGap}
        y2={c}
        stroke={primaryColor}
        strokeWidth={sw * 0.7}
        strokeLinecap="square"
      />
      <Line
        x1={c + innerGap}
        y1={c}
        x2={s - crossInset}
        y2={c}
        stroke={primaryColor}
        strokeWidth={sw * 0.7}
        strokeLinecap="square"
      />
      <Line
        x1={c}
        y1={crossInset}
        x2={c}
        y2={c - innerGap}
        stroke={primaryColor}
        strokeWidth={sw * 0.7}
        strokeLinecap="square"
      />
      <Line
        x1={c}
        y1={c + innerGap}
        x2={c}
        y2={s - crossInset}
        stroke={primaryColor}
        strokeWidth={sw * 0.7}
        strokeLinecap="square"
      />
      <Circle cx={c} cy={c} r={dotR} fill={dotColor} />
    </Svg>
  );
};
