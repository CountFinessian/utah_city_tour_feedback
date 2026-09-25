import { Haptics, NotificationType, ImpactStyle } from "@capacitor/haptics";

/**
 * Triggers native iOS / Android haptic vibration feedback for successful actions (e.g. debrief submission).
 * Produces a crisp heavy impact thump followed by a satisfying 300ms vibration pulse.
 */
export async function triggerSubmitHaptic(): Promise<void> {
  // 1. Immediate crisp heavy physical impact
  try {
    await Haptics.impact({ style: ImpactStyle.Heavy });
  } catch {}

  // 2. Satisfying continuous vibration pulse (0.3s CoreHaptics / Taptic Engine)
  try {
    await Haptics.vibrate({ duration: 300 });
  } catch {
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {}
  }

  // 3. Web fallback for devices supporting navigator.vibrate
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate([150]);
    } catch {}
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
