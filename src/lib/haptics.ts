import { Haptics, NotificationType, ImpactStyle } from "@capacitor/haptics";

/**
 * Trigger a tactile success haptic vibration (native iOS UINotificationFeedbackGenerator).
 */
export async function triggerSubmitHaptic() {
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([25, 50, 25]);
      } catch {}
    }
  }
}

/**
 * Trigger a tactile error haptic vibration.
 */
export async function triggerErrorHaptic() {
  try {
    await Haptics.notification({ type: NotificationType.Error });
  } catch {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([60, 100, 60]);
      } catch {}
    }
  }
}

/**
 * Trigger a subtle light tap haptic.
 */
export async function triggerTapHaptic() {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(15);
      } catch {}
    }
  }
}
