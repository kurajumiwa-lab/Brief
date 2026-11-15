import { useCallback, useEffect, useRef, useState } from "react";

/**
 * THE CAMERA IS THE SCANNER.
 *
 * Browsers that expose `BarcodeDetector` decode the QR on the device, with no
 * upload, no OCR bill and no receipt image leaving the phone. Where that API is
 * missing (Firefox today, some older Android WebViews) the component falls back
 * to pasting the verification link or typing the few fields printed on the
 * receipt — it does not pretend the camera worked.
 *
 * Nothing here requests location. "In the shop" is measured by the clock on the
 * receipt, not by a permission prompt.
 */
export function useQrScanner({ onResult } = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(null);
  const resultRef = useRef(onResult);
  const [active, setActive] = useState(false);
  const [error, setError] = useState(null);

  resultRef.current = onResult;

  const supported =
    typeof window !== "undefined" &&
    typeof window.BarcodeDetector !== "undefined" &&
    Boolean(navigator?.mediaDevices?.getUserMedia);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    for (const track of stream?.getTracks?.() || []) track.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  }, []);

  const tick = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) return;
    if (video.readyState >= 2) {
      try {
        const codes = await detector.detect(video);
        const value = codes?.[0]?.rawValue;
        if (value) {
          resultRef.current?.(value);
          stop();
          return;
        }
      } catch {
        // A single bad frame is normal; keep looking.
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [stop]);

  const start = useCallback(async () => {
    setError(null);
    if (!supported) {
      setError("This browser cannot scan automatically. Paste the receipt link or type the details instead.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();
      }
      setActive(true);
      rafRef.current = requestAnimationFrame(tick);
      return true;
    } catch (err) {
      stop();
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      setError(
        denied
          ? "Camera permission was not given. You can still paste the receipt link below."
          : "The camera did not start. Paste the receipt link or type the details instead.",
      );
      return false;
    }
  }, [supported, stop, tick]);

  /** A photo of the QR is also on-device: the detector reads the bitmap. */
  const scanImage = useCallback(async (file) => {
    if (!supported || !file) return null;
    setError(null);
    try {
      const Detector = window.BarcodeDetector;
      const detector = new Detector({ formats: ["qr_code"] });
      const bitmap = await createImageBitmap(file);
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      return codes?.[0]?.rawValue || null;
    } catch {
      setError("That image could not be read. Try the camera again, or paste the link.");
      return null;
    }
  }, [supported]);

  useEffect(() => stop, [stop]);

  return { videoRef, start, stop, scanImage, active, error, supported };
}
