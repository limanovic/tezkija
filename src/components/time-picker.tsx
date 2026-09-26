import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';

/**
 * A 24-hour time picker. Native: the OS dialog. Web: see time-picker.web.tsx.
 * Both report through the same event shape — 'set' with the date, or
 * 'dismissed' — so the delivery screens don't know which one they got.
 */
export type TimePickerEvent = { type: 'set' | 'dismissed' };

export type TimePickerProps = {
  value: Date;
  onChange: (event: TimePickerEvent, date?: Date) => void;
};

export function TimePicker({ value, onChange }: TimePickerProps) {
  return (
    <DateTimePicker
      value={value}
      mode="time"
      is24Hour
      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
      onChange={(event: DateTimePickerEvent, date?: Date) =>
        onChange({ type: event.type === 'set' ? 'set' : 'dismissed' }, date)
      }
    />
  );
}
