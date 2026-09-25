import { Capacitor } from "@capacitor/core";
import { Haptics, NotificationType, ImpactStyle } from "@capacitor/haptics";

/**
 * Triggers native iOS / Android haptic feedback for successful actions (e.g. debrief submission).
 * Uses UINotificationFeedbackGenerator Success + a medium impact — reliable on iOS Taptic Engine.
 * Avoids Haptics.vibrate(duration), whose CHHapticEngine can tear down before the pulse plays.
 */
export async function triggerSubmitHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([40, 60, 40]);
      } catch (err) {
        console.warn("[haptics] navigator.vibrate failed", err);
      }
    }
    return;
  }

  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch (err) {
    console.warn("[haptics] Success notification failed", err);
  }

  try {
    await Haptics.impact({ style: ImpactStyle.Medium });
  } catch (err) {
    console.warn("[haptics] Medium impact failed", err);
  }
}

/**
 * Triggers native iOS / Android haptic vibration feedback for errors.
 */
export async function triggerErrorHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch (err) {
        console.warn("[haptics] navigator.vibrate failed", err);
      }
    }
    return;
  }

  try {
    await Haptics.notification({ type: NotificationType.Error });
  } catch (err) {
    console.warn("[haptics] Error notification failed", err);
  }
}

/**
 * Triggers light tactile tap haptic feedback.
 */
export async function triggerTapHaptic(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(25);
      } catch (err) {
        console.warn("[haptics] navigator.vibrate failed", err);
      }
    }
    return;
  }

  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch (err) {
    console.warn("[haptics] Light impact failed", err);
  }
}
