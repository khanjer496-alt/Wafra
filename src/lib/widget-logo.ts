/** Wafra 1.0 widgets use letters, including snapshots saved by older builds. */
export type WidgetLogoId = string;
export const WIDGET_LOGO_IDS: readonly WidgetLogoId[] = [];
export function isWidgetLogoId(_value: unknown): _value is WidgetLogoId {
  return false;
}
export function widgetLogoIdFor(_title: string): WidgetLogoId | null {
  return null;
}
