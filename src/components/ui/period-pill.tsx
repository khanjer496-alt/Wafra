
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { type IconName } from '@/components/ui/icon';
import { SectionHeader as CanonicalSectionHeader } from '@/components/ui/section-header';

/** @deprecated Import ActionIconButton from ui/action-icon-button. */
export function IconButton({
  name,
  onPress,
  label,
}: {
  name: IconName;
  onPress: () => void;
  label: string;
}) {
  return <ActionIconButton icon={name} label={label} onPress={onPress} />;
}

/** @deprecated Import SectionHeader from ui/section-header. */
export function SectionHeader({
  title,
  right,
  onPressRight,
}: {
  title: string;
  right?: string;
  onPressRight?: () => void;
}) {
  if (right !== undefined && onPressRight) {
    return (
      <CanonicalSectionHeader title={title} action={{ label: right, onPress: onPressRight }} />
    );
  }
  if (right !== undefined) {
    return <CanonicalSectionHeader title={title} value={right} />;
  }
  return <CanonicalSectionHeader title={title} />;
}

