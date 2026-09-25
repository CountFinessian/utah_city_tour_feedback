import { Haptics, NotificationType, ImpactStyle } from "@capacitor/haptics";

/**
 * Triggers native iOS / Android haptic vibration feedback for successful actions (e.g. debrief submission).
 * Falls back gracefully to standard web navigator.vibrate if running outside native Capacitor.
 */
export async function triggerSubmitHaptic(): Promise<void> {
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([40, 60, 40]);
      } catch {}
    }
  }
}

/**
 * Triggers native iOS / Android haptic vibration feedback for errors.
 */
export async function triggerErrorHaptic(): Promise<void> {
  try {
    await Haptics.notification({ type: NotificationType.Error });
  } catch {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch {}
    }
  }
}

/**
 * Triggers light tactile tap haptic feedback.
 */
export async function triggerTapHaptic(): Promise<void> {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(25);
      } catch {}
    }
  }
}
