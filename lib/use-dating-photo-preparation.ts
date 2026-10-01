"use client";

import { useEffect, useRef, useState } from "react";
import { prepareDatingPhoto } from "@/lib/dating-photo-preparation";

export function useDatingPhotoPreparation(maxBytes: number) {
  const active = useRef(new Map<number, AbortController>());
  const mounted = useRef(true);
  const [pending, setPending] = useState<number[]>([]);
  const [errors, setErrors] = useState<string[]>(["", ""]);
  useEffect(() => {
    mounted.current = true;
    const requests = active.current;
    return () => {
      mounted.current = false;
      requests.forEach(controller => controller.abort());
      requests.clear();
    };
  }, []);

  function cancel(slot: number) {
    active.current.get(slot)?.abort();
    active.current.delete(slot);
    setPending([...active.current.keys()]);
    setErrors(current => current.map((error, index) => index === slot ? "" : error));
  }

  async function select(slot: number, file: File | null, commit: (file: File) => void, onError?: () => void) {
    // Cancelling the system picker must not clear an already selected photo.
    if (!file) return;
    active.current.get(slot)?.abort();
    const controller = new AbortController();
    active.current.set(slot, controller);
    setPending([...active.current.keys()]);
    setErrors(current => current.map((error, index) => index === slot ? "" : error));
    const isCurrent = () => mounted.current && active.current.get(slot) === controller;
    try {
      const prepared = await prepareDatingPhoto(file, maxBytes, controller.signal);
      if (isCurrent()) commit(prepared);
    } catch (error) {
      if (isCurrent() && !controller.signal.aborted) {
        setErrors(current => current.map((message, index) => index === slot
          ? (error instanceof Error ? error.message : "사진을 처리하지 못했어요. 다시 선택해 주세요.") : message));
        onError?.();
      }
    } finally {
      if (isCurrent()) {
        active.current.delete(slot);
        setPending([...active.current.keys()]);
      }
    }
  }
  return { select, cancel, errors, pending, busy: pending.length > 0, isProcessing: () => active.current.size > 0 };
}
