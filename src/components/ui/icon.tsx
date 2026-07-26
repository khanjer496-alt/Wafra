import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'home'
  | 'chart'
  | 'target'
  | 'wallet'
  | 'plus'
  | 'search'
  | 'trash'
  | 'close'
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'sliders'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-up-right'
  | 'arrow-down-right'
  | 'spark'
  | 'check'
  | 'cart'
  | 'dining'
  | 'car'
  | 'bolt'
  | 'phone'
  | 'bag'
  | 'heart'
  | 'cap'
  | 'plane'
  | 'play'
  | 'gift'
  | 'briefcase'
  | 'receipt'
  | 'bank'
  | 'cash'
  | 'mail'
  | 'lock'
  | 'calendar'
  | 'repeat'
  | 'alert'
  | 'diamond'
  | 'sun'
  | 'leaf'
  | 'scissors'
  | 'tools'
  | 'download'
  | 'upload'
  | 'fingerprint';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * Hand-rolled stroke icon set, 24x24 viewBox. No icon fonts, no emojis.
 *
 * 1.8 is the house weight — heavy enough to hold at 14px, light enough that a
 * list of glyphs reads as texture rather than as a row of buttons. The only
 * place it goes up is an active tab (2.1), where weight is doing the work that
 * a filled tile used to do.
 */
export function Icon({ name, size = 24, color = '#fff', strokeWidth = 1.8 }: IconProps) {
  const p = { stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'home' && (
        <>
          <Path {...p} d="M4 10.5 12 3.5 20 10.5" />
          <Path {...p} d="M6 9.5 V20 H18 V9.5" />
          <Path {...p} d="M10 20 V14.5 H14 V20" />
        </>
      )}
      {name === 'chart' && (
        <>
          <Path {...p} d="M4 20 V13" />
          <Path {...p} d="M10 20 V8" />
          <Path {...p} d="M16 20 V11" />
          <Path {...p} d="M22 20 V5" />
        </>
      )}
      {name === 'target' && (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Circle {...p} cx={12} cy={12} r={5} />
          <Circle cx={12} cy={12} r={1.6} fill={color} />
        </>
      )}
      {name === 'wallet' && (
        <>
          <Rect {...p} x={3} y={6} width={18} height={14} rx={3} />
          <Path {...p} d="M3 10 H21" />
          <Circle cx={17} cy={15} r={1.4} fill={color} />
        </>
      )}
      {name === 'plus' && (
        <>
          <Line {...p} x1={12} y1={5} x2={12} y2={19} />
          <Line {...p} x1={5} y1={12} x2={19} y2={12} />
        </>
      )}
      {name === 'search' && (
        <>
          <Circle {...p} cx={11} cy={11} r={7} />
          <Line {...p} x1={20} y1={20} x2={16} y2={16} />
        </>
      )}
      {name === 'trash' && (
        <>
          <Path {...p} d="M4 7 H20" />
          <Path {...p} d="M9 7 V5 a1.5 1.5 0 0 1 1.5 -1.5 h3 A1.5 1.5 0 0 1 15 5 V7" />
          <Path {...p} d="M6.5 7 L7.5 20 H16.5 L17.5 7" />
          <Line {...p} x1={10} y1={11} x2={10} y2={16} />
          <Line {...p} x1={14} y1={11} x2={14} y2={16} />
        </>
      )}
      {name === 'close' && (
        <>
          <Line {...p} x1={6} y1={6} x2={18} y2={18} />
          <Line {...p} x1={18} y1={6} x2={6} y2={18} />
        </>
      )}
      {name === 'chevron-right' && <Path {...p} d="M9 5 L16 12 L9 19" />}
      {name === 'chevron-left' && <Path {...p} d="M15 5 L8 12 L15 19" />}
      {name === 'chevron-down' && <Path {...p} d="M5 9 L12 16 L19 9" />}
      {name === 'sliders' && (
        <>
          <Path {...p} d="M4 7 H20 M4 12 H20 M4 17 H20" />
          <Path {...p} d="M9 5 V9 M15 10 V14 M7 15 V19" />
        </>
      )}
      {name === 'arrow-up' && (
        <>
          <Line {...p} x1={12} y1={19} x2={12} y2={6} />
          <Path {...p} d="M6.5 11 L12 5.5 L17.5 11" />
        </>
      )}
      {name === 'arrow-down' && (
        <>
          <Line {...p} x1={12} y1={5} x2={12} y2={18} />
          <Path {...p} d="M6.5 13 L12 18.5 L17.5 13" />
        </>
      )}
      {name === 'arrow-up-right' && (
        <>
          <Line {...p} x1={7} y1={17} x2={17} y2={7} />
          <Path {...p} d="M9 7 H17 V15" />
        </>
      )}
      {name === 'arrow-down-right' && (
        <>
          <Line {...p} x1={7} y1={7} x2={17} y2={17} />
          <Path {...p} d="M17 9 V17 H9" />
        </>
      )}
      {name === 'spark' && (
        <>
          <Path {...p} d="M12 3 L13.8 9.2 L20 11 L13.8 12.8 L12 19 L10.2 12.8 L4 11 L10.2 9.2 Z" />
          <Circle cx={19} cy={4.5} r={1.2} fill={color} />
        </>
      )}
      {name === 'check' && <Path {...p} d="M5 12.5 L10 17.5 L19 7" />}
      {name === 'cart' && (
        <>
          <Path {...p} d="M3.5 5 H6 l2.2 9.5 h9.6 L20 8 H7" />
          <Circle cx={9.5} cy={19} r={1.5} fill={color} />
          <Circle cx={16.8} cy={19} r={1.5} fill={color} />
        </>
      )}
      {name === 'dining' && (
        <>
          <Path {...p} d="M7 3.5 V8 a2.5 2.5 0 0 0 5 0 V3.5" />
          <Line {...p} x1={9.5} y1={8} x2={9.5} y2={20.5} />
          <Path {...p} d="M16.5 3.5 c2.4 2.6 2.4 6 0 8.4" />
          <Line {...p} x1={16.5} y1={3.5} x2={16.5} y2={20.5} />
        </>
      )}
      {name === 'car' && (
        <>
          <Path {...p} d="M4.5 14.5 6 9.5 a2 2 0 0 1 1.9 -1.5 h8.2 a2 2 0 0 1 1.9 1.5 l1.5 5" />
          <Path {...p} d="M4 14.5 H20 V18.5 H17.5 M4 14.5 V18.5 H6.5" />
          <Circle cx={8} cy={18.5} r={1.5} fill={color} />
          <Circle cx={16} cy={18.5} r={1.5} fill={color} />
        </>
      )}
      {name === 'bolt' && <Path {...p} d="M13 2.5 L5 13.5 h5.5 L9.5 21.5 18 10.5 h-5.5 L13 2.5 Z" />}
      {name === 'phone' && (
        <>
          <Rect {...p} x={7.5} y={3} width={9} height={18} rx={2.5} />
          <Line {...p} x1={10.5} y1={17.5} x2={13.5} y2={17.5} />
        </>
      )}
      {name === 'bag' && (
        <>
          <Path {...p} d="M6 8.5 H18 L17 20.5 H7 L6 8.5 Z" />
          <Path {...p} d="M9 8.5 V7 a3 3 0 0 1 6 0 v1.5" />
        </>
      )}
      {name === 'heart' && (
        <Path
          {...p}
          d="M12 20 C6.5 15.8 4 12.9 4 10 A4 4 0 0 1 12 7.8 4 4 0 0 1 20 10 c0 2.9 -2.5 5.8 -8 10 Z"
        />
      )}
      {name === 'cap' && (
        <>
          <Path {...p} d="M2.5 9.5 L12 4.5 21.5 9.5 12 14.5 Z" />
          <Path {...p} d="M6.5 12 V16.5 c0 2 11 2 11 0 V12" />
          <Line {...p} x1={21.5} y1={9.5} x2={21.5} y2={14} />
        </>
      )}
      {name === 'plane' && (
        <>
          <Path {...p} d="M21 3.5 L3 10.8 l6.6 2.2 2.2 6.9 Z" />
          <Line {...p} x1={21} y1={3.5} x2={9.6} y2={13} />
        </>
      )}
      {name === 'play' && (
        <>
          <Circle {...p} cx={12} cy={12} r={9} />
          <Path d="M10 8.6 L16 12 L10 15.4 Z" fill={color} />
        </>
      )}
      {name === 'gift' && (
        <>
          <Rect {...p} x={4.5} y={9} width={15} height={11.5} rx={1.5} />
          <Line {...p} x1={12} y1={9} x2={12} y2={20.5} />
          <Path {...p} d="M12 9 C8.5 9 7 5 9.8 4.4 12 4 12 7 12 9 Z" />
          <Path {...p} d="M12 9 C15.5 9 17 5 14.2 4.4 12 4 12 7 12 9 Z" />
        </>
      )}
      {name === 'briefcase' && (
        <>
          <Rect {...p} x={3.5} y={7.5} width={17} height={12.5} rx={2} />
          <Path {...p} d="M9 7.5 V6 a2 2 0 0 1 2 -2 h2 a2 2 0 0 1 2 2 v1.5" />
          <Path {...p} d="M3.5 12.5 H20.5" />
        </>
      )}
      {name === 'receipt' && (
        <>
          <Path {...p} d="M6.5 3.5 H17.5 V20.5 l-1.8 -1.4 -1.8 1.4 -1.9 -1.4 -1.9 1.4 -1.8 -1.4 -1.8 1.4 Z" />
          <Line {...p} x1={9.5} y1={8.5} x2={14.5} y2={8.5} />
          <Line {...p} x1={9.5} y1={12} x2={14.5} y2={12} />
        </>
      )}
      {name === 'bank' && (
        <>
          <Path {...p} d="M3.5 9 L12 4 20.5 9 H3.5 Z" />
          <Line {...p} x1={6} y1={12} x2={6} y2={17} />
          <Line {...p} x1={10} y1={12} x2={10} y2={17} />
          <Line {...p} x1={14} y1={12} x2={14} y2={17} />
          <Line {...p} x1={18} y1={12} x2={18} y2={17} />
          <Path {...p} d="M3.5 20 H20.5" />
        </>
      )}
      {name === 'cash' && (
        <>
          <Rect {...p} x={3} y={7} width={18} height={10.5} rx={2} />
          <Circle {...p} cx={12} cy={12.2} r={2.4} />
          <Line {...p} x1={6.2} y1={12.2} x2={6.2} y2={12.3} />
          <Line {...p} x1={17.8} y1={12.2} x2={17.8} y2={12.3} />
        </>
      )}
      {name === 'mail' && (
        <>
          <Rect {...p} x={3} y={5} width={18} height={14} rx={2} />
          <Path {...p} d="M3.5 7 L12 13 20.5 7" />
        </>
      )}
      {name === 'lock' && (
        <>
          <Rect {...p} x={5.5} y={10.5} width={13} height={9.5} rx={2} />
          <Path {...p} d="M8.5 10.5 V8 a3.5 3.5 0 0 1 7 0 v2.5" />
          <Circle cx={12} cy={15.2} r={1.4} fill={color} />
        </>
      )}
      {name === 'calendar' && (
        <>
          <Rect {...p} x={3.5} y={5} width={17} height={15.5} rx={2} />
          <Line {...p} x1={8} y1={3} x2={8} y2={7} />
          <Line {...p} x1={16} y1={3} x2={16} y2={7} />
          <Line {...p} x1={3.5} y1={10} x2={20.5} y2={10} />
        </>
      )}
      {name === 'repeat' && (
        <>
          <Path {...p} d="M4.5 12 a7.5 7.5 0 0 1 13 -5.1" />
          <Path {...p} d="M17.5 3.5 v3.6 h-3.6" />
          <Path {...p} d="M19.5 12 a7.5 7.5 0 0 1 -13 5.1" />
          <Path {...p} d="M6.5 20.5 v-3.6 h3.6" />
        </>
      )}
      {name === 'alert' && (
        <>
          <Path {...p} d="M12 3.5 L21.5 19.5 H2.5 Z" />
          <Line {...p} x1={12} y1={9.5} x2={12} y2={13.5} />
          <Circle cx={12} cy={16.5} r={1.2} fill={color} />
        </>
      )}
      {name === 'diamond' && (
        <>
          <Path {...p} d="M7.5 4 H16.5 L21 9 12 20.5 3 9 Z" />
          <Path {...p} d="M3 9 H21" />
          <Path {...p} d="M7.5 4 L12 20.5 L16.5 4" />
        </>
      )}
      {name === 'sun' && (
        <>
          <Circle {...p} cx={12} cy={12} r={4} />
          <Line {...p} x1={12} y1={2.5} x2={12} y2={5} />
          <Line {...p} x1={12} y1={19} x2={12} y2={21.5} />
          <Line {...p} x1={2.5} y1={12} x2={5} y2={12} />
          <Line {...p} x1={19} y1={12} x2={21.5} y2={12} />
          <Line {...p} x1={5.3} y1={5.3} x2={7} y2={7} />
          <Line {...p} x1={17} y1={17} x2={18.7} y2={18.7} />
          <Line {...p} x1={5.3} y1={18.7} x2={7} y2={17} />
          <Line {...p} x1={17} y1={7} x2={18.7} y2={5.3} />
        </>
      )}
      {name === 'leaf' && (
        <>
          <Path {...p} d="M6 19.5 C5.5 11 11 4.5 20 4 c0.8 9 -5 15 -14 15.5 Z" />
          <Path {...p} d="M6 19.5 C9 14 13 10 17.5 7" />
        </>
      )}
      {/* Personal care: a pair of scissors. Grooming is the one spend the
          whole category is recognized by. */}
      {name === 'scissors' && (
        <>
          <Circle {...p} cx={6.5} cy={17.5} r={2.5} />
          <Circle {...p} cx={6.5} cy={6.5} r={2.5} />
          <Line {...p} x1={8.6} y1={8} x2={19} y2={19.5} />
          <Line {...p} x1={8.6} y1={16} x2={19} y2={4.5} />
        </>
      )}
      {/* Home services: a spanner. Cleaning, repairs, the maid — work done to
          the home rather than rent paid for it. */}
      {name === 'tools' && (
        <>
          <Path
            {...p}
            d="M15.2 3.6 a5 5 0 0 0 -5.6 7.4 L3.6 17 a2 2 0 0 0 2.8 2.8 l6-6 a5 5 0 0 0 7.4 -5.6 l-3.1 3.1 -2.9 -0.6 -0.6 -2.9 Z"
          />
        </>
      )}
      {name === 'download' && (
        <>
          <Line {...p} x1={12} y1={4} x2={12} y2={14} />
          <Path {...p} d="M7.5 10 L12 14.5 16.5 10" />
          <Path {...p} d="M4.5 19.5 H19.5" />
        </>
      )}
      {name === 'upload' && (
        <>
          <Line {...p} x1={12} y1={14} x2={12} y2={4} />
          <Path {...p} d="M7.5 8 L12 3.5 16.5 8" />
          <Path {...p} d="M4.5 19.5 H19.5" />
        </>
      )}
      {/* Concentric ridges rather than a literal print: it has to stay legible
          at 38px inside the Android unlock target. */}
      {name === 'fingerprint' && (
        <>
          <Path {...p} d="M3.5 11.5 a8.5 8.5 0 0 1 17 0 v2" />
          <Path {...p} d="M6.8 12 a5.2 5.2 0 0 1 10.4 0 v3.4 q0 1.8 -0.5 3.4" />
          <Path {...p} d="M10 12.2 a2 2 0 0 1 4 0 v3.6 q0 2.4 -0.9 4.6" />
          <Path {...p} d="M6.9 17.5 q-0.6 1.9 -1.8 3.4" />
        </>
      )}
    </Svg>
  );
}
