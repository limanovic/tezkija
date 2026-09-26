import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleProp, Text, TextStyle, ViewStyle } from 'react-native';

/**
 * Stepper button that keeps firing while held — reaching 10 from 1 is
 * otherwise nine separate taps.
 */
export function StepButton({
  label,
  glyph,
  disabled,
  style,
  textStyle,
  onStep,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
  onStep: () => void;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The interval must call the *current* onStep: the one captured when the
  // hold began still sees the old count and would re-apply the same value.
  const step = useRef(onStep);
  step.current = onStep;
  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  return (
    <Pressable
      style={style}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      onPress={onStep}
      onLongPress={() => {
        stop();
        timer.current = setInterval(() => step.current(), 120);
      }}
      onPressOut={stop}
    >
      <Text style={textStyle}>{glyph}</Text>
    </Pressable>
  );
}
